import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { getCityPattern } from '../patterns/catalog.js';
import { gameStateSchema } from './schema.js';
import { parseGameState } from './state.js';
import { getBaseScoringPreview } from './scoring.js';
import type { BaseScoringPreview } from './scoring.js';
import type { ValidationIssue } from '../board/types.js';
import type { DeepReadonly, GameDefinition, GameState, GamePosition } from './types.js';

export const FINAL_SCORING_SOURCE = deepFreeze({
  rulebookSha256: '6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42',
  printedPages: [10, 12, 23], minimumInputSnapshot: '1.16.0', finalSnapshot: '1.17.0',
});
export class FinalScoringError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'FinalScoringError'; }
}
const reject = (code: string, message: string): never => { throw new FinalScoringError(code, message); };
const optionsSchema = z.strictObject({ expectedVersion: z.number().int().nonnegative().safe() });
export type FinalizeBaseGameOptions = DeepReadonly<z.infer<typeof optionsSchema>>;

function cleanupComplete(state: GameState): boolean {
  const flow = state.roundFlow;
  return state.phase === 'round-control' && flow?.stage === 'finished' && flow.roundNumber === 8
    && !flow.majorActionOpened && flow.completedMajorAction === null && flow.startingPlayerOverride === null
    && flow.rolesByPlayer.every(role => role.placed === null && role.used === null)
    && !state.cityPatternMajorActions?.length && state.cityPatternContinuation === null
    && state.cityPatterns?.usedSpecialActions.length === 0
    && state.cityPatterns.useTracks.every(track => {
      try { const pattern = getCityPattern(track.patternId); return pattern.level !== 1 || track.remainingUses === pattern.useCapacity; }
      catch { return false; }
    });
}
/** Shared position only: do not recursively call getGamePosition/parseGameState during validation. */
function positionWithScores(state: GameState, definition: GameDefinition, scores?: Readonly<Record<string, number>>): GamePosition {
  return { gameId: state.gameId, board: state.board, markerSupplyByPlayer: state.markerSupplyByPlayer,
    ...(state.patternMarkers ? { patternMarkers: state.patternMarkers } : {}),
    players: Object.fromEntries(definition.players.map(({ id }) => [id, { ...state.players[id]!, score: scores ? scores[id]! : state.players[id]!.score }])),
  };
}
/** Only the before-scores are persisted as a settlement receipt; live score remains authoritative. */
export function finalScoringIssues(state: GameState, definition: GameDefinition): ValidationIssue[] {
  if (!state.finalScoring) return [];
  const receipt = state.finalScoring, issues: ValidationIssue[] = [];
  const report = (message: string) => issues.push({ code: 'FINAL_SCORING_STATE', path: 'finalScoring', message });
  if (!cleanupComplete(state)) { report('Final scoring requires all eight rounds and completed cleanup'); return issues; }
  if (receipt.sourceStateVersion !== state.stateVersion - 1) report('Final scoring must be the single next version after its source snapshot');
  const ids = definition.players.map(p => p.id).sort();
  if (JSON.stringify(Object.keys(receipt.scoreBeforeByPlayer).sort()) !== JSON.stringify(ids)) { report('Before-scores must cover exactly the registered players'); return issues; }
  try {
    const preview = getBaseScoringPreview(positionWithScores(state, definition, receipt.scoreBeforeByPlayer), definition);
    for (const id of ids) if (state.players[id]!.score !== preview.players[id]!.totalPoints) report('Committed score must equal its before-score plus the exact region and resource awards');
  } catch { report('Final scoring components must be valid and safely representable'); }
  return issues;
}

/** Trusted server transition AFTER finishManagedRound on round eight; no client supplies scores or winners. */
export function finalizeBaseGame(input: GameState, definition: GameDefinition, rawOptions: FinalizeBaseGameOptions): GameState {
  const state = parseGameState(input, definition), checked = optionsSchema.safeParse(rawOptions);
  if (!checked.success) return reject('OPTIONS_SCHEMA', checked.error.message);
  if (checked.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.finalScoring) return reject('ALREADY_FINALIZED', 'Final scores have already been committed');
  if (state.schemaVersion !== '1.16.0') return reject('FINALIZATION_FORMAT', 'Finalize an explicit project-base 1.16.0 snapshot; legacy snapshots retain their original meaning');
  if (!cleanupComplete(state)) return reject('FINAL_CLEANUP_PENDING', 'Finish all eight rounds, harvest, delayed removals and pattern cleanup before scoring');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  let preview: BaseScoringPreview;
  try { preview = getBaseScoringPreview(positionWithScores(state, definition), definition); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SCORE_OVERFLOW') return reject('SCORE_OVERFLOW', 'Final score exceeds the safe integer range');
    throw error;
  }
  const next = gameStateSchema.parse(state);
  next.finalScoring = { schemaVersion: '1.0.0', sourceSnapshotVersion: '1.16.0', sourceStateVersion: state.stateVersion,
    scoreBeforeByPlayer: Object.fromEntries(definition.players.map(({ id }) => [id, state.players[id]!.score])) };
  for (const { id } of definition.players) next.players[id]!.score = preview.players[id]!.totalPoints;
  next.schemaVersion = '1.17.0'; next.stateVersion++;
  return parseGameState(next, definition);
}

export interface FinalScoringResult {
  readonly schemaVersion: '1.0.0'; readonly gameId: string; readonly stateVersion: number;
  readonly status: 'finished'; readonly completedRounds: 8; readonly sourceStateVersion: number;
  readonly players: BaseScoringPreview['players']; readonly regions: BaseScoringPreview['regions'];
  readonly winnerPlayerIds: readonly string[]; readonly resolvedBy: BaseScoringPreview['resolvedBy'];
  /** Descending score/voucher/pure groups; players within a tied group share the same result. */
  readonly rankingGroups: readonly (readonly string[])[];
}
/** Public allowlist: no private hands, draw order, marker identities or server setup options. */
export function getFinalScoringResult(input: GameState, definition: GameDefinition): DeepReadonly<FinalScoringResult> {
  const state = parseGameState(input, definition);
  if (state.schemaVersion !== '1.17.0' || !state.finalScoring) return reject('FINALIZATION_PENDING', 'Final scores have not been committed');
  const receipt = state.finalScoring, preview = getBaseScoringPreview(positionWithScores(state, definition, receipt.scoreBeforeByPlayer), definition);
  const fields = ['totalPoints', 'remainingVouchers', 'remainingPureOriginium'] as const;
  const compare = (a: string, b: string) => {
    for (const key of fields) { const av = preview.players[a]![key], bv = preview.players[b]![key]; if (av !== bv) return av > bv ? -1 : 1; }
    return 0;
  };
  const sorted = definition.players.map(p => p.id).sort(compare), groups: string[][] = [];
  for (const id of sorted) {
    const previous = groups.at(-1);
    if (previous && compare(previous[0]!, id) === 0) previous.push(id); else groups.push([id]);
  }
  return deepFreeze({ schemaVersion: '1.0.0', gameId: state.gameId, stateVersion: state.stateVersion, status: 'finished', completedRounds: 8,
    sourceStateVersion: receipt.sourceStateVersion, players: preview.players, regions: preview.regions,
    winnerPlayerIds: preview.leadingPlayerIds, resolvedBy: preview.resolvedBy, rankingGroups: groups });
}
