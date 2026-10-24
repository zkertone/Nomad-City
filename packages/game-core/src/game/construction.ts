import { z } from 'zod';
import { advanceCityPatternContinuation } from './city-pattern-continuations.js';
import { getFoundersPhysicalFacilityCard } from '../facilities/stock.js';
import { beginNestedFacilityEntry } from './facility-entries.js';
import { loadFoundersBoard } from '../board/index.js';
import { resourceNodeIdSchema } from '../board/schema.js';
import { explorationPathStepSchema } from './exploration-engine.js';
import { affordableWarehouseTargets, beginWarehouseExploration } from './warehouse-rules.js';
import { gameEntityIdSchema, gameStateSchema } from './schema.js';
import { getGamePosition, parseGameState, getFoundersMapSide } from './state.js';
import { actionWindowOptionsSchema, prepareActionWindow } from './action-window.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';
import { createFoundersFacilitySupply } from '../facilities/supply.js';
import { createInitialFacilityPanels } from '../facilities/panel-state.js';
import { facilityConstructionCommandSchema, getFacilityConstructionQuote, beginFacilityConstruction } from '../facilities/construction.js';
import { getFacilityConstructionSpec, rejectFacilityConstruction as reject } from '../facilities/construction-spec.js';

const windowOptionsSchema = actionWindowOptionsSchema.extend({ facilityDeckOrder: z.array(z.string().min(1)).length(41).optional() });
export type OpenConstructionWindowOptions = DeepReadonly<z.infer<typeof windowOptionsSchema>>;
export interface ConstructionActorContext { readonly authenticatedPlayerId: string }
export const constructionPlayerCommandSchema = facilityConstructionCommandSchema.extend({
  type: z.literal('construct-facility'), gameId: gameEntityIdSchema,
  expectedVersion: z.number().int().nonnegative().safe(),
  warehouseExploration: z.strictObject({ nodeId: resourceNodeIdSchema, path: z.array(explorationPathStepSchema).min(1).max(22) }).optional(),
});
export type ConstructionPlayerCommand = DeepReadonly<z.infer<typeof constructionPlayerCommandSchema>>;

/**
 * TRUSTED grant of ONE ordinary, base-price construction. Role, round order and major-action
 * scheduling remain external, exactly as for exploration/deployment. Never expose this to players.
 * Explicit initial facilityDeckOrder initializes known-new facilities once; never infer a legacy history.
 */
export function openConstructionWindow(input: GameState, definition: GameDefinition, rawOptions: OpenConstructionWindowOptions): GameState {
  const parsed = windowOptionsSchema.safeParse(rawOptions);
  if (!parsed.success) return reject('WINDOW_SCHEMA', parsed.error.message);
  const { facilityDeckOrder, ...options } = parsed.data;
  const prepared = prepareActionWindow(input, definition, options, reject);
  let facilities = prepared.facilityFields.facilities;
  if (facilities && facilityDeckOrder !== undefined) return reject('FACILITY_RESET', 'Existing facility cards cannot be reinitialized');
  if (!facilities) {
    if (!facilityDeckOrder) return reject('FACILITY_SETUP_REQUIRED', 'Trusted caller must explicitly initialize the new facility deck');
    try {
      const supply = createFoundersFacilitySupply({ gameId: definition.gameId, playerIds: definition.players.map(player => player.id), deckOrder: facilityDeckOrder });
      facilities = { supply, panels: createInitialFacilityPanels(supply) };
    } catch (error) { return reject('FACILITY_SETUP_INVALID', error instanceof Error ? error.message : String(error)); }
  }
  if (facilities.panels.find(panel => panel.playerId === options.actorId)!.placements.length === 12) return reject('NO_EMPTY_CELL', 'Construction requires an empty panel cell');
  return parseGameState({ ...prepared.position, facilities, ...prepared.roundFields, schemaVersion: prepared.previousFormat === '1.14.0' ? '1.14.0' : prepared.previousFormat === '1.13.0' ? '1.13.0' : prepared.previousFormat === '1.12.0' ? '1.12.0' : prepared.previousFormat === '1.11.0' ? '1.11.0' : prepared.previousFormat === '1.10.0' ? '1.10.0' : prepared.previousFormat === '1.9.0' ? '1.9.0' : prepared.previousFormat === '1.8.0' ? '1.8.0' : prepared.previousFormat === '1.7.0' ? '1.7.0' : '1.6.0', stateVersion: prepared.stateVersion,
    phase: 'construction', eventDecks: prepared.eventDecks, playerOrder: prepared.playerOrder,
    construction: { actorId: options.actorId, roundNumber: options.roundNumber, status: 'ready', constructionsCompleted: 0, builtCardId: null },
  }, definition);
}

function prepare(input: GameState, definition: GameDefinition, context: ConstructionActorContext, payload: unknown) {
  const state = parseGameState(input, definition);
  const parsed = constructionPlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const { type: _type, gameId, expectedVersion, warehouseExploration, ...command } = parsed.data;
  if (gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong construction game');
  if (expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const action = state.construction;
  if (state.phase !== 'construction' || !action || action.status !== 'ready') return reject('ACTION_STAGE', 'No unused construction grant');
  if (action.actorId !== context.authenticatedPlayerId) return reject('WRONG_ACTOR', 'Only the granted player may construct');
  const panel = state.facilities!.panels.find(row => row.playerId === action.actorId)!;
  if (state.cityPatternContinuation?.kind === 'declaration-build' && getFoundersPhysicalFacilityCard(command.cardId).color === 'rainbow') return reject('PATTERN_CONSTRUCTION_COLOR', 'This declaration only constructs non-rainbow facilities');
  return { state, command, warehouseExploration, bundle: { position: getGamePosition(state, definition), ...state.facilities! },
    internalContext: { gameId: state.gameId, actorId: action.actorId, expectedSupplyRevision: state.facilities!.supply.revision, expectedPanelRevision: panel.revision,
      ...(state.cityPatternContinuation?.kind === 'deck-build' ? { source: 'draw-pile' as const } : {}) } };
}
/** Read-only advisory quote; a subsequent command always recomputes costs and checks the current version. */
export function getConstructionQuote(input: GameState, definition: GameDefinition, context: ConstructionActorContext, payload: unknown) {
  const p = prepare(input, definition, context, payload);
  requireEntryFormat(p.state, p.command.cardId);
  if (p.command.entryChoice?.kind === 'deferred-entry' && !['1.12.0', '1.13.0', '1.14.0'].includes(p.state.schemaVersion)) return reject('FACILITY_FORMAT', 'Deferred facility entry requires format 1.12.0');
  const quote = getFacilityConstructionQuote(p.bundle, definition, p.internalContext, p.command);
  if (getFacilityConstructionSpec(p.command.cardId).entry.kind !== 'warehouse') return quote;
  if (!['1.11.0', '1.12.0', '1.13.0', '1.14.0'].includes(p.state.schemaVersion)) return reject('WAREHOUSE_FORMAT', 'Explicitly enable warehouse entries in 1.11.0');
  const afterPayment = gameStateSchema.parse(p.state);
  if (quote.canPay) for (const cost of quote.costs) afterPayment.players[p.state.construction!.actorId]!.balances[cost.asset] -= cost.amount;
  const warehouseExplorationTargets = quote.canPay ? affordableWarehouseTargets(afterPayment, loadFoundersBoard(getFoundersMapSide(definition.players.length)), p.state.construction!.actorId, p.state.construction!.roundNumber, definition.players.length) : [];
  return Object.freeze({ ...quote, warehouseExplorationTargets: Object.freeze(warehouseExplorationTargets.map(target => Object.freeze(target))) });
}
/** Return one immutable authoritative snapshot; errors leave input, grant and every ledger unchanged. */
export function applyConstructionCommand(input: GameState, definition: GameDefinition, context: ConstructionActorContext, payload: unknown): GameState {
  const p = prepare(input, definition, context, payload);
  if (p.state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  const spec = getFacilityConstructionSpec(p.command.cardId);
  requireEntryFormat(p.state, p.command.cardId);
  if (p.command.entryChoice?.kind === 'deferred-entry' && !['1.12.0', '1.13.0', '1.14.0'].includes(p.state.schemaVersion)) return reject('FACILITY_FORMAT', 'Deferred facility entry requires format 1.12.0');
  if (spec.entry.kind === 'warehouse' && !['1.11.0', '1.12.0', '1.13.0', '1.14.0'].includes(p.state.schemaVersion)) return reject('WAREHOUSE_FORMAT', 'Explicitly enable warehouse entries in 1.11.0');
  const explores = p.command.entryChoice?.kind === 'warehouse-explore';
  if (p.warehouseExploration !== undefined && !explores) return reject('ENTRY_CHOICE', 'An initial exploration belongs only to the warehouse explore branch');
  const settled = beginFacilityConstruction(p.bundle, definition, p.internalContext, p.command);
  const next = gameStateSchema.parse({ ...p.state, ...settled.state.position,
    facilities: { supply: settled.state.supply, panels: settled.state.panels },
    construction: { ...p.state.construction!, status: 'complete', constructionsCompleted: 1, builtCardId: p.command.cardId },
    stateVersion: p.state.stateVersion + 1,
  });
  if (settled.pendingEntry === 'facility-entry') beginNestedFacilityEntry(next, definition, p.command.cardId);
  else if (settled.pendingEntry === 'warehouse-choice') {
    next.construction!.status = 'entry-pending';
    next.construction!.warehouseEntry = { kind: 'warehouse-choice', status: 'branch-choice', targetNodeId: null, cardId: null, resolvedChoiceId: null };
  } else if (settled.pendingEntry) beginWarehouseExploration(next, definition, p.warehouseExploration, reject);
  advanceCityPatternContinuation(next, definition);
  return parseGameState(next, definition);
}

function requireEntryFormat(state: GameState, cardId: string): void {
  if (['logistics', 'free-city-move', 'copy-entry', 'starting-player', 'extra-construction'].includes(getFacilityConstructionSpec(cardId).entry.kind) && !['1.12.0', '1.13.0', '1.14.0'].includes(state.schemaVersion)) return reject('FACILITY_FORMAT', 'Explicitly enable nested facility entries in format 1.12.0');
}
