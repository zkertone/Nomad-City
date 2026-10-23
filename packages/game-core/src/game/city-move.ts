import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { loadFoundersBoard } from '../board/index.js';
import { resourceNodeIdSchema, routeIdSchema, slotIdSchema } from '../board/schema.js';
import { getFoundersEventCard } from '../events/index.js';
import { gameEntityIdSchema, gamePositionSchema, gameStateSchema } from './schema.js';
import { getFoundersMapSide, getGamePosition, parseGameState } from './state.js';
import { prepareActionWindow } from './action-window.js';
import type { OpenActionWindowOptions } from './action-window.js';
import { redExplorationOpeningRound } from './exploration-rules.js';
import { availableTargetInfluenceSlots, clearOpposingCityMoveInfluence } from './influence.js';
import { eventSettlementChoiceSchema, getEventChoiceRequirements, settleEventChoice, EventSettlementError } from './settlement.js';
import type { GameDefinition, GameState } from './types.js';

export class CityMoveCommandError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CityMoveCommandError'; }
}
const reject = (code: string, message: string): never => { throw new CityMoveCommandError(code, message); };
export type OpenCityMoveWindowOptions = OpenActionWindowOptions;
const envelope = { gameId: gameEntityIdSchema, expectedVersion: z.number().int().nonnegative().safe() };
export const cityMovePlayerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('move-city'), nodeId: resourceNodeIdSchema, routeId: routeIdSchema }),
  z.strictObject({ ...envelope, type: z.literal('choose-city-move-event'), choice: eventSettlementChoiceSchema }),
  z.strictObject({ ...envelope, type: z.literal('place-city-move-influence'), slotId: slotIdSchema }),
]);
export type CityMovePlayerCommand = z.infer<typeof cityMovePlayerCommandSchema>;
export interface CityMoveActorContext { readonly authenticatedPlayerId: string }
export interface CityMoveOption { readonly nodeId: string; readonly routeId: string }

/** Trusted single-action grant. Full round/role/major-action authorization remains the caller's job. */
export function openCityMoveWindow(input: GameState, definition: GameDefinition, options: OpenCityMoveWindowOptions): GameState {
  const prepared = prepareActionWindow(input, definition, options, reject);
  return parseGameState({ ...prepared.position, ...prepared.facilityFields, ...prepared.roundFields, schemaVersion: prepared.previousFormat === '1.11.0' ? '1.11.0' : prepared.previousFormat === '1.10.0' ? '1.10.0' : prepared.previousFormat === '1.9.0' ? '1.9.0' : prepared.previousFormat === '1.8.0' ? '1.8.0' : prepared.previousFormat === '1.7.0' ? '1.7.0' : prepared.previousFormat === '1.6.0' ? '1.6.0' : prepared.previousFormat === '1.5.0' ? '1.5.0' : prepared.previousFormat === '1.4.0' ? '1.4.0' : '1.3.0', stateVersion: prepared.stateVersion,
    phase: 'city-move', eventDecks: prepared.eventDecks, playerOrder: prepared.playerOrder,
    cityMove: { actorId: prepared.options.actorId, roundNumber: prepared.options.roundNumber, status: 'ready',
      sourceNodeId: null, targetNodeId: null, routeId: null, cardId: null, resolvedChoiceId: null } }, definition);
}

/** Every option retains its chosen route identity, even when another route joins the same endpoints. */
export function getCityMoveOptions(input: GameState, definition: GameDefinition, actorId: string): readonly CityMoveOption[] {
  const state = parseGameState(input, definition); const move = state.cityMove;
  if (state.phase !== 'city-move' || move?.status !== 'ready' || move.actorId !== actorId || state.players[actorId]!.balances.originium < 3) return Object.freeze([]);
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const source = state.board.cityNodeByPlayer[actorId]!;
  const options: CityMoveOption[] = [];
  for (const route of Object.values(board.routes)) {
    if (!route.incidentNodeIds.includes(source)) continue;
    for (const nodeId of route.incidentNodeIds) {
      if (nodeId === source || Object.entries(state.board.cityNodeByPlayer).some(([other, city]) => other !== actorId && city === nodeId)) continue;
      if (board.resourceNodes[nodeId]!.redRestricted && move.roundNumber < redExplorationOpeningRound(definition.players.length)) continue;
      options.push({ nodeId, routeId: route.id });
    }
  }
  return deepFreeze(options);
}
export function getCityMoveFinalSlotIds(input: GameState, definition: GameDefinition, actorId: string): readonly string[] {
  const state = parseGameState(input, definition); const move = state.cityMove;
  if (state.phase !== 'city-move' || move?.status !== 'final-influence' || move.actorId !== actorId) return Object.freeze([]);
  return Object.freeze(availableTargetInfluenceSlots(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, move.targetNodeId!));
}
export function getPendingCityMoveChoiceRequirements(input: GameState, definition: GameDefinition, actorId: string, choiceId: string) {
  const state = parseGameState(input, definition); const move = state.cityMove;
  if (state.phase !== 'city-move' || move?.status !== 'event-choice') return reject('ACTION_STAGE', 'No city-move event choice is pending');
  if (move.actorId !== actorId) return reject('WRONG_ACTOR', 'Only the moving player may query the event');
  return getEventChoiceRequirements(getGamePosition(state, definition), definition,
    { gameId: state.gameId, actorId, nodeId: move.targetNodeId!, cardId: move.cardId! }, choiceId);
}

function nextVersion(version: number): number {
  if (version === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return version + 1;
}
/** Pure authoritative reducer: source, payment, clearing range and drawn card are server-derived. */
export function applyCityMoveCommand(input: GameState, definition: GameDefinition, context: CityMoveActorContext, payload: unknown): GameState {
  const current = parseGameState(input, definition);
  const parsed = cityMovePlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data;
  if (command.gameId !== current.gameId) return reject('GAME_REFERENCE', 'Wrong game');
  if (command.expectedVersion !== current.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const move = current.cityMove;
  if (current.phase !== 'city-move' || !move || move.status === 'complete') return reject('ACTION_STAGE', 'No unfinished city-move grant');
  if (move.actorId !== context.authenticatedPlayerId) return reject('WRONG_ACTOR', 'Only the granted actor may move');
  const next = gameStateSchema.parse(current); const progress = next.cityMove!;
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  switch (command.type) {
    case 'move-city': {
      if (move.status !== 'ready') return reject('ACTION_STAGE', 'City has already moved');
      if (next.players[move.actorId]!.balances.originium < 3) return reject('CANNOT_PAY', 'City movement requires 3 originium before any event');
      if (!getCityMoveOptions(current, definition, move.actorId).some(option => option.nodeId === command.nodeId && option.routeId === command.routeId)) return reject('MOVE_TARGET', 'Choose a free, open destination on the specified single route');
      const node = board.resourceNodes[command.nodeId]!;
      const unexplored = next.board.resourceMarkerByNode[command.nodeId] === null;
      const cardId = unexplored ? next.eventDecks![node.eventDeckColor][0] : null;
      if (unexplored && !cardId) return reject('EVENT_DECK', 'No eligible event remains');
      next.players[move.actorId]!.balances.originium -= 3;
      progress.sourceNodeId = next.board.cityNodeByPlayer[move.actorId]!;
      next.board.cityNodeByPlayer[move.actorId] = command.nodeId;
      clearOpposingCityMoveInfluence(next, board, move.actorId, command.routeId, command.nodeId);
      progress.targetNodeId = command.nodeId; progress.routeId = command.routeId;
      if (cardId) {
        const card = getFoundersEventCard(cardId);
        next.eventDecks![node.eventDeckColor].shift();
        next.board.resourceMarkerByNode[command.nodeId] = { markerDefinitionId: card.id, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
        progress.cardId = card.id; progress.status = 'event-choice';
      } else progress.status = availableTargetInfluenceSlots(next, board, move.actorId, command.nodeId).length ? 'final-influence' : 'complete';
      break;
    }
    case 'choose-city-move-event': {
      if (move.status !== 'event-choice') return reject('ACTION_STAGE', 'No new event to resolve');
      try {
        const settled = settleEventChoice(getGamePosition(current, definition), definition,
          { gameId: current.gameId, actorId: move.actorId, nodeId: move.targetNodeId!, cardId: move.cardId! }, command.choice);
        Object.assign(next, gamePositionSchema.parse(settled.position));
      } catch (error) {
        if (error instanceof EventSettlementError) return reject(error.code, error.message);
        throw error;
      }
      progress.resolvedChoiceId = command.choice.choiceId;
      progress.status = availableTargetInfluenceSlots(next, board, move.actorId, move.targetNodeId!).length ? 'final-influence' : 'complete';
      break;
    }
    case 'place-city-move-influence': {
      if (move.status !== 'final-influence') return reject('ACTION_STAGE', 'No final influence is pending');
      if (!getCityMoveFinalSlotIds(current, definition, move.actorId).includes(command.slotId)) return reject('FINAL_SLOT', 'Final placement must be at the new city node');
      const markerId = next.markerSupplyByPlayer[move.actorId]!.shift()!;
      next.board.influenceBySlot[command.slotId] = { markerId, ownerPlayerId: move.actorId };
      progress.status = 'complete';
      break;
    }
  }
  next.stateVersion = nextVersion(current.stateVersion);
  return parseGameState(next, definition);
}
