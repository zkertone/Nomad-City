import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { loadFoundersBoard } from '../board/index.js';
import { gameEntityIdSchema, gameStateSchema, explorationProgressSchema } from './schema.js';
import { getFoundersMapSide, getGamePosition, parseGameState } from './state.js';
import { resourceNodeIdSchema } from '../board/schema.js';
import { facilityEntryChoiceSchema, settleFacilityBoardOrSaleEntry } from '../facilities/entry-effects.js';
import { beginWarehouseExploration } from './warehouse-rules.js';
import { explorationPathStepSchema, explorationPlayerCommandSchema, resolveExplorationStep } from './exploration-engine.js';
import { finalExplorationSlots } from './exploration-rules.js';
import { getEventChoiceRequirements } from './settlement.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';

export class WarehouseEntryError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'WarehouseEntryError'; }
}
const reject = (code: string, message: string): never => { throw new WarehouseEntryError(code, message); };
const optionsSchema = z.strictObject({ expectedVersion: z.number().int().nonnegative().safe() });
export function enableWarehouseEntries(input: GameState, definition: GameDefinition, rawOptions: DeepReadonly<z.infer<typeof optionsSchema>>): GameState {
  const state = parseGameState(input, definition), checked = optionsSchema.safeParse(rawOptions);
  if (!checked.success) return reject('OPTIONS_SCHEMA', checked.error.message);
  if (checked.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.schemaVersion !== '1.10.0') return reject('WAREHOUSE_FORMAT', 'Upgrade a validated 1.10.0 snapshot exactly once');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return parseGameState({ ...state, schemaVersion: '1.11.0', stateVersion: state.stateVersion + 1 }, definition);
}
function pending(input: GameState, definition: GameDefinition, actorId: string) {
  const state = parseGameState(input, definition), action = state.construction;
  if (state.schemaVersion !== '1.11.0' || state.phase !== 'construction' || action?.status !== 'entry-pending' || !action.warehouseEntry) return reject('ENTRY_STAGE', 'No pending warehouse exploration');
  if (action.actorId !== actorId) return reject('WRONG_ACTOR', 'Only the construction owner resolves this entry');
  return { state, action, entry: action.warehouseEntry };
}
export function getWarehouseEntryFinalSlotIds(input: GameState, definition: GameDefinition, actorId: string): readonly string[] {
  const p = pending(input, definition, actorId);
  return p.entry.status === 'final-influence' ? deepFreeze(finalExplorationSlots(p.state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, p.entry.targetNodeId!)) : Object.freeze([]);
}
export function getPendingWarehouseEventRequirements(input: GameState, definition: GameDefinition, actorId: string, choiceId: string) {
  const p = pending(input, definition, actorId);
  if (p.entry.status !== 'event-choice') return reject('ENTRY_STAGE', 'No warehouse event choice remains');
  return getEventChoiceRequirements(getGamePosition(p.state, definition), definition, { gameId: p.state.gameId, actorId, nodeId: p.entry.targetNodeId!, cardId: p.entry.cardId! }, choiceId);
}
export const warehouseEntryPlayerCommandSchema = z.discriminatedUnion('type', [...explorationPlayerCommandSchema.options,
  z.strictObject({ type: z.literal('choose-warehouse-entry'), gameId: gameEntityIdSchema, expectedVersion: z.number().int().nonnegative().safe(),
    entryChoice: facilityEntryChoiceSchema, warehouseExploration: z.strictObject({ nodeId: resourceNodeIdSchema, path: z.array(explorationPathStepSchema).min(1).max(22) }).optional() }),
]);
export function applyWarehouseEntryCommand(input: GameState, definition: GameDefinition, context: { readonly authenticatedPlayerId: string }, payload: unknown): GameState {
  const state = parseGameState(input, definition), checked = warehouseEntryPlayerCommandSchema.safeParse(payload);
  if (!checked.success) return reject('COMMAND_SCHEMA', checked.error.message);
  const command = checked.data;
  if (command.gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong warehouse game');
  if (command.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const p = pending(state, definition, context.authenticatedPlayerId);
  if (command.type === 'choose-warehouse-entry') {
    if (p.entry.kind !== 'warehouse-choice' || p.entry.status !== 'branch-choice') return reject('ENTRY_STAGE', 'This entry branch has already been chosen');
    if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
    const next = gameStateSchema.parse(state), choice = command.entryChoice;
    if (choice.kind === 'warehouse-explore') beginWarehouseExploration(next, definition, command.warehouseExploration, reject);
    else if (choice.kind === 'warehouse-influence') {
      if (command.warehouseExploration !== undefined) return reject('ENTRY_CHOICE', 'Influence branch has no exploration data');
      settleFacilityBoardOrSaleEntry(next, loadFoundersBoard(getFoundersMapSide(definition.players.length)), p.action.actorId, choice, reject);
      next.construction!.status = 'complete'; delete next.construction!.warehouseEntry;
    } else return reject('ENTRY_CHOICE', 'Choose a complete warehouse branch');
    next.stateVersion++; return parseGameState(next, definition);
  }
  if (p.entry.kind === 'warehouse-choice') return reject('ENTRY_STAGE', 'Choose the warehouse entry branch before its exploration');
  if (command.type === 'explore') return reject('ENTRY_STAGE', 'Warehouse initial exploration was already committed with construction');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  const next = gameStateSchema.parse(state), action = next.construction!;
  const progress = explorationProgressSchema.parse({ actorId: action.actorId, roundNumber: action.roundNumber, status: p.entry.status,
    targetNodeId: p.entry.targetNodeId, cardId: p.entry.cardId, resolvedChoiceId: p.entry.resolvedChoiceId });
  resolveExplorationStep(next, definition, progress, command, reject);
  if (progress.status === 'ready') return reject('ENTRY_STAGE', 'Continuation cannot restart exploration');
  action.warehouseEntry = { kind: 'warehouse-exploration', status: progress.status, targetNodeId: progress.targetNodeId, cardId: progress.cardId, resolvedChoiceId: progress.resolvedChoiceId };
  if (progress.status === 'complete') action.status = 'complete';
  next.stateVersion++;
  return parseGameState(next, definition);
}
