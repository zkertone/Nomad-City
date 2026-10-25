import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { slotIdSchema } from '../board/schema.js';
import { gameEntityIdSchema, gameStateSchema } from './schema.js';
import { parseGameState } from './state.js';
import { getRoundTurn } from './round.js';
import { ownBoardInfluenceSlotIds, pendingLiskarmPlayers, returnBoardInfluence } from './liskarm-rules.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';

export class RoleCleanupError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'RoleCleanupError'; }
}
const reject = (code: string, message: string): never => { throw new RoleCleanupError(code, message); };
const version = z.number().int().nonnegative().safe();
const optionsSchema = z.strictObject({ expectedVersion: version });
type Options = DeepReadonly<z.infer<typeof optionsSchema>>;
function checkedOptions(state: GameState, input: Options) {
  const result = optionsSchema.safeParse(input);
  if (!result.success) return reject('OPTIONS_SCHEMA', result.error.message);
  if (result.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
}
/** Explicit upgrade preserving all existing role-use/discard history; older formats use the prior upgrade first. */
export function enableLiskarmEffects(input: GameState, definition: GameDefinition, options: Options): GameState {
  const state = parseGameState(input, definition); checkedOptions(state, options);
  if (state.schemaVersion !== '1.8.0') return reject('ROLE_FORMAT', 'Upgrade a validated 1.8.0 snapshot exactly once');
  return parseGameState({ ...state, schemaVersion: '1.9.0', stateVersion: state.stateVersion + 1 }, definition);
}
/** Trusted cleanup entry AFTER simultaneous harvest, automatically skipping only impossible removals. */
export function openManagedCleanup(input: GameState, definition: GameDefinition, options: Options): GameState {
  const state = parseGameState(input, definition); checkedOptions(state, options);
  if (!['1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0'].includes(state.schemaVersion)) return reject('ROLE_FORMAT', 'Explicit role cleanup requires format 1.9.0');
  if (state.phase !== 'harvest' || state.harvest?.status !== 'complete' || state.roundFlow!.stage !== 'harvest') return reject('HARVEST_PENDING', 'Finish every harvest plan before cleanup');
  const next = gameStateSchema.parse(state);
  for (const playerId of pendingLiskarmPlayers(state)) if (!ownBoardInfluenceSlotIds(state, playerId).length) next.roundFlow!.rolesByPlayer.find(role => role.playerId === playerId)!.used!.cleanupResolved = true;
  next.phase = 'round-control'; delete next.harvest; next.roundFlow!.stage = 'cleanup'; next.stateVersion++;
  return parseGameState(next, definition);
}
/** Public board targets; returning options is not authorization to resolve another player's effect. */
export function getRoleCleanupOptions(input: GameState, definition: GameDefinition, playerId: string): readonly string[] {
  const state = parseGameState(input, definition);
  if (state.roundFlow?.stage !== 'cleanup' || getRoundTurn(state, definition).actorId !== playerId) return Object.freeze([]);
  return deepFreeze(ownBoardInfluenceSlotIds(state, playerId));
}
export const roleCleanupCommandSchema = z.strictObject({ type: z.literal('resolve-role-cleanup'), gameId: gameEntityIdSchema,
  expectedVersion: version, slotId: slotIdSchema,
});
export type RoleCleanupCommand = DeepReadonly<z.infer<typeof roleCleanupCommandSchema>>;
export function applyRoleCleanupCommand(input: GameState, definition: GameDefinition, context: { readonly authenticatedPlayerId: string }, payload: unknown): GameState {
  const state = parseGameState(input, definition), parsed = roleCleanupCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data;
  if (command.gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong cleanup game');
  if (command.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (!['1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0'].includes(state.schemaVersion) || state.roundFlow!.stage !== 'cleanup') return reject('CLEANUP_STAGE', 'No open role cleanup');
  const actorId = getRoundTurn(state, definition).actorId;
  if (!actorId || actorId !== context.authenticatedPlayerId) return reject('WRONG_ACTOR', 'Only the next cleanup effect owner may choose');
  if (!getRoleCleanupOptions(state, definition, actorId).includes(command.slotId)) return reject('CLEANUP_TARGET', 'Choose any ONE of your current board influence markers');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  const next = gameStateSchema.parse(state);
  returnBoardInfluence(next, command.slotId);
  next.roundFlow!.rolesByPlayer.find(role => role.playerId === actorId)!.used!.cleanupResolved = true;
  next.stateVersion++;
  return parseGameState(next, definition);
}
