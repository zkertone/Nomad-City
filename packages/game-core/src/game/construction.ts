import { z } from 'zod';
import { gameEntityIdSchema } from './schema.js';
import { getGamePosition, parseGameState } from './state.js';
import { actionWindowOptionsSchema, prepareActionWindow } from './action-window.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';
import { createFoundersFacilitySupply } from '../facilities/supply.js';
import { createInitialFacilityPanels } from '../facilities/panel-state.js';
import { facilityConstructionCommandSchema, getFacilityConstructionQuote, settleFacilityConstruction } from '../facilities/construction.js';
import { rejectFacilityConstruction as reject } from '../facilities/construction-spec.js';

const windowOptionsSchema = actionWindowOptionsSchema.extend({ facilityDeckOrder: z.array(z.string().min(1)).length(41).optional() });
export type OpenConstructionWindowOptions = DeepReadonly<z.infer<typeof windowOptionsSchema>>;
export interface ConstructionActorContext { readonly authenticatedPlayerId: string }
export const constructionPlayerCommandSchema = facilityConstructionCommandSchema.extend({
  type: z.literal('construct-facility'), gameId: gameEntityIdSchema,
  expectedVersion: z.number().int().nonnegative().safe(),
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
  return parseGameState({ ...prepared.position, facilities, ...prepared.roundFields, schemaVersion: prepared.previousFormat === '1.9.0' ? '1.9.0' : prepared.previousFormat === '1.8.0' ? '1.8.0' : prepared.previousFormat === '1.7.0' ? '1.7.0' : '1.6.0', stateVersion: prepared.stateVersion,
    phase: 'construction', eventDecks: prepared.eventDecks, playerOrder: prepared.playerOrder,
    construction: { actorId: options.actorId, roundNumber: options.roundNumber, status: 'ready', constructionsCompleted: 0, builtCardId: null },
  }, definition);
}

function prepare(input: GameState, definition: GameDefinition, context: ConstructionActorContext, payload: unknown) {
  const state = parseGameState(input, definition);
  const parsed = constructionPlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const { type: _type, gameId, expectedVersion, ...command } = parsed.data;
  if (gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong construction game');
  if (expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const action = state.construction;
  if (state.phase !== 'construction' || !action || action.status !== 'ready') return reject('ACTION_STAGE', 'No unused construction grant');
  if (action.actorId !== context.authenticatedPlayerId) return reject('WRONG_ACTOR', 'Only the granted player may construct');
  const panel = state.facilities!.panels.find(row => row.playerId === action.actorId)!;
  return { state, command, bundle: { position: getGamePosition(state, definition), ...state.facilities! },
    internalContext: { gameId: state.gameId, actorId: action.actorId, expectedSupplyRevision: state.facilities!.supply.revision, expectedPanelRevision: panel.revision } };
}
/** Read-only advisory quote; a subsequent command always recomputes costs and checks the current version. */
export function getConstructionQuote(input: GameState, definition: GameDefinition, context: ConstructionActorContext, payload: unknown) {
  const p = prepare(input, definition, context, payload);
  return getFacilityConstructionQuote(p.bundle, definition, p.internalContext, p.command);
}
/** Return one immutable authoritative snapshot; errors leave input, grant and every ledger unchanged. */
export function applyConstructionCommand(input: GameState, definition: GameDefinition, context: ConstructionActorContext, payload: unknown): GameState {
  const p = prepare(input, definition, context, payload);
  if (p.state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  const settled = settleFacilityConstruction(p.bundle, definition, p.internalContext, p.command);
  return parseGameState({ ...p.state, ...settled.state.position,
    facilities: { supply: settled.state.supply, panels: settled.state.panels },
    construction: { ...p.state.construction!, status: 'complete', constructionsCompleted: 1, builtCardId: p.command.cardId },
    stateVersion: p.state.stateVersion + 1,
  }, definition);
}
