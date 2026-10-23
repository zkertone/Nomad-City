import { z } from 'zod';
import { loadFoundersBoard } from '../board/index.js';
import { slotIdSchema } from '../board/schema.js';
import { gameEntityIdSchema, gameStateSchema } from './schema.js';
import { getFoundersMapSide, parseGameState } from './state.js';
import { prepareActionWindow } from './action-window.js';
import type { OpenActionWindowOptions } from './action-window.js';
import { availableInfluenceSlots, emptyInfluenceSlots, dispatchSourceSlots } from './influence.js';
import type { GameDefinition, GameState } from './types.js';

export class InfluenceActionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'InfluenceActionError'; }
}
const reject = (code: string, message: string): never => { throw new InfluenceActionError(code, message); };
export type OpenInfluenceActionOptions = OpenActionWindowOptions;
export interface InfluenceActorContext { readonly authenticatedPlayerId: string }
const envelope = { gameId: gameEntityIdSchema, expectedVersion: z.number().int().nonnegative().safe() };
export const influencePlayerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('deploy-influence'), slotId: slotIdSchema }),
  z.strictObject({ ...envelope, type: z.literal('dispatch-influence'), sourceSlotId: slotIdSchema, targetSlotId: slotIdSchema }),
  z.strictObject({ ...envelope, type: z.literal('finish-dispatch') }),
]);
export type InfluencePlayerCommand = z.infer<typeof influencePlayerCommandSchema>;

function open(input: GameState, definition: GameDefinition, options: OpenInfluenceActionOptions, kind: 'deploy' | 'dispatch'): GameState {
  const prepared = prepareActionWindow(input, definition, options, reject);
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const actorId = prepared.options.actorId;
  const possible = kind === 'deploy' ? availableInfluenceSlots(prepared.position, board, actorId).length : dispatchSourceSlots(prepared.position, board, actorId).length;
  return parseGameState({ ...prepared.position, ...prepared.facilityFields, ...prepared.roundFields, schemaVersion: prepared.previousFormat === '1.7.0' ? '1.7.0' : prepared.previousFormat === '1.6.0' ? '1.6.0' : prepared.previousFormat === '1.5.0' ? '1.5.0' : '1.4.0', stateVersion: prepared.stateVersion, phase: 'influence-action',
    eventDecks: prepared.eventDecks, playerOrder: prepared.playerOrder,
    influenceAction: { kind, actorId, roundNumber: prepared.options.roundNumber, status: possible ? 'ready' : 'complete', operationsCompleted: 0 } }, definition);
}
/** Trusted one-major-action grant; round/role/quota authorization remains with the future caller. */
export function openDeploymentWindow(input: GameState, definition: GameDefinition, options: OpenInfluenceActionOptions): GameState {
  return open(input, definition, options, 'deploy');
}
export function openDispatchWindow(input: GameState, definition: GameDefinition, options: OpenInfluenceActionOptions): GameState {
  return open(input, definition, options, 'dispatch');
}

export function getDeploymentSlotIds(input: GameState, definition: GameDefinition, actorId: string): readonly string[] {
  const state = parseGameState(input, definition); const action = state.influenceAction;
  if (state.phase !== 'influence-action' || action?.kind !== 'deploy' || action.status !== 'ready' || action.actorId !== actorId) return Object.freeze([]);
  return Object.freeze(availableInfluenceSlots(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId));
}
export function getDispatchSourceSlotIds(input: GameState, definition: GameDefinition, actorId: string): readonly string[] {
  const state = parseGameState(input, definition); const action = state.influenceAction;
  if (state.phase !== 'influence-action' || action?.kind !== 'dispatch' || action.status !== 'ready' || action.actorId !== actorId) return Object.freeze([]);
  return Object.freeze(dispatchSourceSlots(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId));
}
export function getDispatchTargetSlotIds(input: GameState, definition: GameDefinition, actorId: string, sourceSlotId: string): readonly string[] {
  const state = parseGameState(input, definition); const action = state.influenceAction;
  if (state.phase !== 'influence-action' || action?.kind !== 'dispatch' || action.status !== 'ready' || action.actorId !== actorId ||
      !Object.hasOwn(state.board.influenceBySlot, sourceSlotId) || state.board.influenceBySlot[sourceSlotId]?.ownerPlayerId !== actorId) return Object.freeze([]);
  return Object.freeze(emptyInfluenceSlots(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId));
}

/** Pure state transition. Dispatch transfers the SAME marker and never takes from supply. */
export function applyInfluenceCommand(input: GameState, definition: GameDefinition, context: InfluenceActorContext, payload: unknown): GameState {
  const state = parseGameState(input, definition);
  const parsed = influencePlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data;
  if (command.gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong game');
  if (command.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const action = state.influenceAction;
  if (state.phase !== 'influence-action' || !action || action.status !== 'ready') return reject('ACTION_STAGE', 'No unfinished influence action');
  if (action.actorId !== context.authenticatedPlayerId) return reject('WRONG_ACTOR', 'Only the granted player may act');
  const next = gameStateSchema.parse(state); const progress = next.influenceAction!;
  switch (command.type) {
    case 'deploy-influence': {
      if (action.kind !== 'deploy') return reject('ACTION_KIND', 'Deployment cannot be used during dispatch');
      if (!getDeploymentSlotIds(state, definition, action.actorId).includes(command.slotId)) return reject('DEPLOY_SLOT', 'Choose an available placement slot');
      const markerId = next.markerSupplyByPlayer[action.actorId]!.shift()!;
      next.board.influenceBySlot[command.slotId] = { markerId, ownerPlayerId: action.actorId };
      progress.operationsCompleted = 1; progress.status = 'complete';
      break;
    }
    case 'dispatch-influence': {
      if (action.kind !== 'dispatch') return reject('ACTION_KIND', 'Dispatch cannot be used during deployment');
      if (!getDispatchSourceSlotIds(state, definition, action.actorId).includes(command.sourceSlotId)) return reject('DISPATCH_SOURCE', 'Choose one of your board influence markers');
      if (!getDispatchTargetSlotIds(state, definition, action.actorId, command.sourceSlotId).includes(command.targetSlotId)) return reject('DISPATCH_TARGET', 'Choose an empty legal destination');
      const marker = next.board.influenceBySlot[command.sourceSlotId]!;
      next.board.influenceBySlot[command.sourceSlotId] = null;
      next.board.influenceBySlot[command.targetSlotId] = marker;
      progress.operationsCompleted++;
      if (progress.operationsCompleted === 2 || !dispatchSourceSlots(next, loadFoundersBoard(getFoundersMapSide(definition.players.length)), action.actorId).length) progress.status = 'complete';
      break;
    }
    case 'finish-dispatch': {
      if (action.kind !== 'dispatch') return reject('ACTION_KIND', 'Only dispatch can finish before its maximum moves');
      progress.status = 'complete';
      break;
    }
  }
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  next.stateVersion = state.stateVersion + 1;
  return parseGameState(next, definition);
}
