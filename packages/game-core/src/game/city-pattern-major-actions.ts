import { z } from 'zod';
import { gameStateSchema } from './schema.js';
import { parseGameState } from './state.js';
import type { GameDefinition, GameState } from './types.js';
import type { ValidationIssue } from '../board/types.js';
import { getCityPatternActionSupport } from './city-pattern-rules.js';

type Mutable = z.infer<typeof gameStateSchema>;
export type OrdinaryMajorAction = 'deploy' | 'dispatch' | 'explore' | 'city-move' | 'construct';
export class PatternMajorActionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PatternMajorActionError'; }
}
const reject = (code: string, message: string): never => { throw new PatternMajorActionError(code, message); };
/** Explicit additive capability upgrade; existing effects and unfinished ordinary actions are preserved. */
export function enableCityPatternMajorActions(input: GameState, definition: GameDefinition, options: { readonly expectedVersion: number }): GameState {
  const state = parseGameState(input, definition), checked = z.strictObject({ expectedVersion: z.number().int().nonnegative().safe() }).safeParse(options);
  if (!checked.success) return reject('OPTIONS_SCHEMA', checked.error.message);
  if (checked.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.schemaVersion !== '1.14.0') return reject('PATTERN_FORMAT', 'Upgrade a validated 1.14.0 snapshot exactly once');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return parseGameState({ ...state, schemaVersion: '1.15.0', stateVersion: state.stateVersion + 1, cityPatternMajorActions: [] }, definition);
}
export const patternMajorActionReady = (state: GameState): boolean => !!state.cityPatternMajorActions?.length && state.cityPatternMajorActions.at(-1)!.activeAction === null;
export function patternSpecialAllowed(state: GameState): boolean {
  const top = state.cityPatternMajorActions?.at(-1);
  return !top || (top.patternId === 'PAT-003' && top.activeAction === null);
}
export function bothRoleModesAllowed(state: GameState, actorId: string, turnIndex: number): boolean {
  return state.playerOrder?.[0] === actorId || (['1.15.0', '1.16.0'].includes(state.schemaVersion) && !!state.cityPatterns?.usedSpecialActions.some(use => use.playerId === actorId && use.patternId === 'PAT-010' && use.turnIndex === turnIndex));
}
export function markPatternSpecialChild(next: Mutable, patternId: string): void {
  const top = next.cityPatternMajorActions?.at(-1);
  if (top) { top.activeAction = 'special'; top.activePatternId = patternId; }
}
export function beginPatternMajorActions(next: Mutable, patternId: 'PAT-003' | 'PAT-008' | 'PAT-010'): void {
  next.cityPatternMajorActions!.push({ patternId, remainingActions: patternId === 'PAT-003' ? 2 : 1, activeAction: null, activePatternId: null });
  next.roundFlow!.completedMajorAction = null;
}
/** Called only after the scheduled player has completed the entire active child, including all nested effects. */
export function finishPatternMajorAction(next: Mutable): void {
  delete next.exploration; delete next.cityMove; delete next.influenceAction; delete next.construction;
  next.phase = 'round-control'; next.roundFlow!.completedMajorAction = null;
  const frames = next.cityPatternMajorActions!;
  while (frames.length) {
    const frame = frames.at(-1)!;
    if (frame.remainingActions > 1) { frame.remainingActions--; frame.activeAction = null; frame.activePatternId = null; return; }
    frames.pop(); // A completed nested sequence consumes exactly one action of its industrial parent.
  }
  next.roundFlow!.completedMajorAction = 'special';
}

/** Authority/progress checks; frames carry no duplicate balances, board positions, role cards or action history. */
export function patternMajorActionIssues(state: GameState, definition: GameDefinition): ValidationIssue[] {
  const frames = state.cityPatternMajorActions;
  if (!frames?.length) return [];
  const issues: ValidationIssue[] = [], flow = state.roundFlow!, actorId = state.playerOrder?.[flow.turnIndex % definition.players.length];
  const report = (message: string) => issues.push({ code: 'PATTERN_MAJOR_ACTION', path: 'cityPatternMajorActions', message });
  if (flow.stage !== 'player-actions' || !flow.majorActionOpened || !actorId || !definition.players.some(p => p.id === actorId)) { report('Frames require the scheduled player and consumed outer major-action quota'); return issues; }
  const usedHere = (patternId: string) => state.cityPatterns?.usedSpecialActions.some(u => u.playerId === actorId && u.patternId === patternId && u.turnIndex === flow.turnIndex);
  const ids = new Set<string>();
  for (const [index, frame] of frames.entries()) {
    if (ids.has(frame.patternId) || !usedHere(frame.patternId) || !state.cityPatterns?.publicPatternIds.includes(frame.patternId)) report('Each frame requires its distinct real public-pattern activation in this exact turn');
    ids.add(frame.patternId);
    if (frame.patternId !== 'PAT-003' && (frame.remainingActions !== 1 || frame.activeAction === 'special')) report('Commercial/command actions grant one non-special action only');
    if ((frame.activeAction === 'special') !== (frame.activePatternId !== null)) report('Only a special child references a pattern');
    if (index < frames.length - 1) {
      if (frame.patternId !== 'PAT-003' || frame.activeAction !== 'special' || frame.activePatternId !== frames[index + 1]!.patternId) report('Only industrial extra actions can own a nested special sequence');
    }
  }
  const top = frames.at(-1)!;
  if (top.activeAction === null) {
    if (flow.completedMajorAction !== null || (state.phase !== 'round-control' && state.cityPatternContinuation?.kind !== 'declaration-build')) report('Ready extra action has no performed child');
    if (state.cityPatternContinuation && state.cityPatternContinuation.kind !== 'declaration-build') report('A ready extra action cannot contain a different unfinished special');
  } else if (top.activeAction === 'special') {
    if (!top.activePatternId || !usedHere(top.activePatternId) || !getCityPatternActionSupport(state.schemaVersion).specialActionPatternIds.includes(top.activePatternId) || ['PAT-003', 'PAT-008', 'PAT-010'].includes(top.activePatternId)) report('A leaf special child needs its actual non-sequence activation');
    const pending = state.cityPatternContinuation;
    if (pending && pending.kind !== 'declaration-build') {
      if (pending.patternId !== top.activePatternId || flow.completedMajorAction !== null) report('Pending special must match its active child');
    } else if (flow.completedMajorAction !== 'special') report('Finished special child must retain its actual completion');
  } else {
    if (flow.completedMajorAction != null) {
      if (flow.completedMajorAction !== top.activeAction) report('Retired child action must match its consumed extra-action slot');
    } else {
      const kind = state.phase === 'influence-action' ? state.influenceAction?.kind : state.phase === 'construction' ? 'construct' : state.phase === 'city-move' ? 'city-move' : state.phase === 'exploration' ? 'explore' : null;
      if (kind !== top.activeAction || state.cityPatternContinuation) report('Active ordinary child must use its unique granted progress');
    }
  }
  return issues;
}
