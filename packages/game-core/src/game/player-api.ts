import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { FacilityConstructionError } from '../facilities/construction-spec.js';
import { parseGameState } from './state.js';
import { gameEntityIdSchema } from './schema.js';
import { gameViewerContextSchema } from './views.js';
import type { GameViewerContext } from './views.js';
import { applyEntryCommand, entryPlayerCommandSchema, EntryCommandError } from './entry.js';
import { applyRoundCommand, roundPlayerCommandSchema, RoundFlowError } from './round.js';
import { applyExplorationCommand, explorationPlayerCommandSchema, ExplorationCommandError } from './exploration.js';
import { applyCityMoveCommand, cityMovePlayerCommandSchema, CityMoveCommandError } from './city-move.js';
import { applyInfluenceCommand, influencePlayerCommandSchema, InfluenceActionError } from './influence-actions.js';
import { applyHarvestCommand, harvestPlayerCommandSchema, HarvestError } from './harvest.js';
import { applyConstructionCommand, constructionPlayerCommandSchema } from './construction.js';
import { applyBaseRoleCommand, baseRolePlayerCommandSchema, BaseRoleEffectError } from './role-effects.js';
import { applyRoleCleanupCommand, roleCleanupCommandSchema, RoleCleanupError } from './liskarm.js';
import { applyWarehouseEntryCommand, warehouseEntryPlayerCommandSchema, WarehouseEntryError } from './warehouse.js';
import { applyNestedFacilityEntryCommand, nestedFacilityEntryCommandSchema, FacilityEntryError } from './facility-entries.js';
import { applyCityPatternCommand, cityPatternPlayerCommandSchema, CityPatternActionError } from './city-pattern-actions.js';
import { applyCityPatternContinuationCommand, cityPatternContinuationCommandSchema, CityPatternContinuationError } from './city-pattern-continuations.js';
import { EventSettlementError } from './settlement.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';

export const GAME_PLAYER_API_VERSION = '1.0.0' as const;
const envelope = { apiVersion: z.literal(GAME_PLAYER_API_VERSION), requestId: gameEntityIdSchema };
/** Explicit channels disambiguate identical exploration/movement steps owned by different parents. */
export const gamePlayerRequestSchema = z.discriminatedUnion('channel', [
  z.strictObject({ ...envelope, channel: z.literal('entry'), command: entryPlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('round'), command: roundPlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('exploration'), command: explorationPlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('city-move'), command: cityMovePlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('influence'), command: influencePlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('harvest'), command: harvestPlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('construction'), command: constructionPlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('role'), command: baseRolePlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('role-cleanup'), command: roleCleanupCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('warehouse-entry'), command: warehouseEntryPlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('facility-entry'), command: nestedFacilityEntryCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('city-pattern'), command: cityPatternPlayerCommandSchema }),
  z.strictObject({ ...envelope, channel: z.literal('pattern-continuation'), command: cityPatternContinuationCommandSchema }),
]);
export type GamePlayerRequest = DeepReadonly<z.infer<typeof gamePlayerRequestSchema>>;
export const gamePlayerReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ apiVersion: z.literal(GAME_PLAYER_API_VERSION), requestId: gameEntityIdSchema,
    ok: z.literal(true), gameId: gameEntityIdSchema, stateVersion: z.number().int().nonnegative().safe() }),
  z.strictObject({ apiVersion: z.literal(GAME_PLAYER_API_VERSION), requestId: gameEntityIdSchema.nullable(), ok: z.literal(false),
    error: z.strictObject({ code: z.enum(['NOT_A_MEMBER', 'INVALID_REQUEST', 'WRONG_GAME', 'STALE_VERSION', 'GAME_FINISHED', 'RULE_REJECTED']),
      ruleCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(100).optional() }) }),
]);
export type GamePlayerReply = DeepReadonly<z.infer<typeof gamePlayerReplySchema>>;
export type GamePlayerExecution = DeepReadonly<
  | { status: 'accepted'; state: GameState; reply: Extract<GamePlayerReply, { ok: true }> }
  | { status: 'rejected'; reply: Extract<GamePlayerReply, { ok: false }> }
>;
type FailureCode = Extract<GamePlayerReply, { ok: false }>['error']['code'];
function refused(requestId: string | null, code: FailureCode, ruleCode?: string): GamePlayerExecution {
  return deepFreeze({ status: 'rejected', reply: { apiVersion: GAME_PLAYER_API_VERSION, requestId, ok: false,
    error: { code, ...(ruleCode ? { ruleCode } : {}) } } });
}
function route(state: GameState, definition: GameDefinition, context: GameViewerContext, request: GamePlayerRequest): GameState {
  switch (request.channel) {
    case 'entry': return applyEntryCommand(state, definition, context, request.command);
    case 'round': return applyRoundCommand(state, definition, context, request.command);
    case 'exploration': return applyExplorationCommand(state, definition, context, request.command);
    case 'city-move': return applyCityMoveCommand(state, definition, context, request.command);
    case 'influence': return applyInfluenceCommand(state, definition, context, request.command);
    case 'harvest': return applyHarvestCommand(state, definition, context, request.command);
    case 'construction': return applyConstructionCommand(state, definition, context, request.command);
    case 'role': return applyBaseRoleCommand(state, definition, context, request.command);
    case 'role-cleanup': return applyRoleCleanupCommand(state, definition, context, request.command);
    case 'warehouse-entry': return applyWarehouseEntryCommand(state, definition, context, request.command);
    case 'facility-entry': return applyNestedFacilityEntryCommand(state, definition, context, request.command);
    case 'city-pattern': return applyCityPatternCommand(state, definition, context, request.command);
    case 'pattern-continuation': return applyCityPatternContinuationCommand(state, definition, context, request.command);
  }
}
/** Server-only pure execution. Persist with CAS before emitting reply; never serialize this whole result. */
export function executeGamePlayerRequest(input: GameState, definition: GameDefinition, context: GameViewerContext, payload: unknown): GamePlayerExecution {
  const member = gameViewerContextSchema.safeParse(context);
  if (!member.success || !definition.players.some(p => p.id === member.data.authenticatedPlayerId)) return refused(null, 'NOT_A_MEMBER');
  const checked = gamePlayerRequestSchema.safeParse(payload);
  if (!checked.success) return refused(null, 'INVALID_REQUEST');
  const request = checked.data, command = request.command;
  const state = parseGameState(input, definition);
  if (command.gameId !== state.gameId) return refused(request.requestId, 'WRONG_GAME');
  if (command.expectedVersion !== state.stateVersion) return refused(request.requestId, 'STALE_VERSION');
  if (state.finalScoring) return refused(request.requestId, 'GAME_FINISHED');
  let next: GameState;
  try { next = route(state, definition, member.data, request); }
  catch (error) {
    // Raw messages can contain state/card details. Unexpected faults remain server exceptions.
    if (error instanceof EntryCommandError || error instanceof RoundFlowError || error instanceof ExplorationCommandError
      || error instanceof CityMoveCommandError || error instanceof InfluenceActionError || error instanceof HarvestError
      || error instanceof FacilityConstructionError || error instanceof BaseRoleEffectError || error instanceof RoleCleanupError
      || error instanceof WarehouseEntryError || error instanceof FacilityEntryError || error instanceof CityPatternActionError
      || error instanceof CityPatternContinuationError || error instanceof EventSettlementError) {
      return refused(request.requestId, 'RULE_REJECTED', error.code);
    }
    throw error;
  }
  if (next.stateVersion !== state.stateVersion + 1) throw new Error('Player command must advance exactly one authoritative version');
  return deepFreeze({ status: 'accepted', state: next, reply: { apiVersion: GAME_PLAYER_API_VERSION,
    requestId: request.requestId, ok: true, gameId: next.gameId, stateVersion: next.stateVersion } });
}
