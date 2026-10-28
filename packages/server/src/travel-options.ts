import { z } from 'zod';
import {
  deepFreeze, gameEntityIdSchema, explorationPathStepSchema, getRoundTurn,
  loadFoundersBoard, getFoundersMapSide, getRoutesForNode, getNodesForRoute, areNodesDirectlyConnected,
  getExplorationTollQuote, ExplorationCommandError,
  getCityMoveOptions, getCityMoveFinalSlotIds, getExplorationFinalSlotIds,
  getPendingExplorationChoiceRequirements, getPendingCityMoveChoiceRequirements, getFoundersEventCard,
} from '@nomad-city-online/game-core';
import type { EventChoice, EventSettlementChoice, ExplorationTollQuote } from '@nomad-city-online/game-core';
import type { RoomSnapshot } from './room-state.js';
import { automaticProgress } from './automatic-lifecycle.js';
import { actionPermission } from './action-permission.js';
import type { ActionPermission } from './action-permission.js';

export interface TravelEvent {
  readonly cardId: string; readonly title: string; readonly description: string;
  readonly choices: readonly {
    readonly id: string; readonly narration: string; readonly cost: EventChoice['cost']; readonly effects: EventChoice['effects'];
    readonly variants: readonly (ActionPermission & { readonly choice: EventSettlementChoice })[];
  }[];
}
export interface TravelOptions {
  readonly kind: 'explore' | 'city-move';
  readonly status: 'ready' | 'event-choice' | 'final-influence' | 'complete';
  readonly targetNodeId: string | null;
  readonly moves: readonly (ActionPermission & { readonly nodeId: string; readonly routeId: string })[];
  readonly finalSlotIds: readonly string[];
  readonly event: TravelEvent | null;
}
/** Only the currently revealed card; executable variants use original settlement semantics. */
export function getTravelOptions(snapshot: RoomSnapshot, actorId: string): TravelOptions | null {
  const { state, definition } = snapshot;
  const kind = state.phase === 'exploration' ? 'explore' : state.phase === 'city-move' ? 'city-move' : null;
  const progress = kind === 'explore' ? state.exploration : kind === 'city-move' ? state.cityMove : null;
  if (!kind || !progress || progress.actorId !== actorId || state.cityPatternContinuation) return null;
  const channel = kind === 'explore' ? 'exploration' : 'city-move';
  const eventType = kind === 'explore' ? 'choose-exploration-event' : 'choose-city-move-event';
  const finalType = kind === 'explore' ? 'place-exploration-influence' : 'place-city-move-influence';
  let event: TravelEvent | null = null;
  if (progress.status === 'event-choice') {
    const card = getFoundersEventCard(progress.cardId!);
    event = { cardId: card.id, title: card.title, description: card.description,
      choices: card.choices.map(choice => {
        const req = (kind === 'explore' ? getPendingExplorationChoiceRequirements : getPendingCityMoveChoiceRequirements)(
          state, definition, actorId, choice.id);
        const payments: EventSettlementChoice[] = req.legalInfluenceSlotIds.length
          ? req.legalInfluenceSlotIds.map(influenceSlotId => ({ choiceId: choice.id, influenceSlotId,
            ...(req.requiresCostDecision ? { costDecision: 'pay' as const } : {}) }))
          : [{ choiceId: choice.id, ...(req.requiresCostDecision ? { costDecision: 'pay' as const } : {}) }];
        if (req.requiresCostDecision) payments.push({ choiceId: choice.id, costDecision: 'decline' });
        return { id: choice.id, narration: choice.narration, cost: choice.cost,
          effects: choice.effects.map(effect => ({ ...effect })),
          variants: payments.map(payment => ({ choice: payment,
            ...actionPermission(snapshot, actorId, channel, { type: eventType, choice: payment }) })) };
      }) };
  }
  const finals = (kind === 'explore' ? getExplorationFinalSlotIds : getCityMoveFinalSlotIds)(state, definition, actorId);
  return { kind, status: progress.status, targetNodeId: progress.targetNodeId, event,
    moves: kind === 'city-move' ? getCityMoveOptions(state, definition, actorId).map(move => ({ ...move,
      ...actionPermission(snapshot, actorId, channel, { type: 'move-city', ...move }) })) : [],
    finalSlotIds: finals.filter(slotId => actionPermission(snapshot, actorId, channel, { type: finalType, slotId }).legal) };
}

export const explorationRouteRequestSchema = z.strictObject({
  roomId: gameEntityIdSchema, gameId: gameEntityIdSchema,
  expectedVersion: z.number().int().nonnegative().safe(),
  path: z.array(explorationPathStepSchema).max(22).readonly(),
});
export type ExplorationRouteRequest = z.infer<typeof explorationRouteRequestSchema>;
export type ExplorationRouteResult =
  | { readonly status: 'ready'; readonly roomId: string; readonly gameId: string; readonly stateVersion: number;
      readonly options: null | {
        readonly path: ExplorationRouteRequest['path']; readonly currentNodeId: string;
        readonly nextSteps: readonly { readonly routeId: string; readonly toNodeId: string }[];
        readonly quote: ExplorationTollQuote | null;
        readonly execution: ActionPermission;
      } }
  | { readonly status: 'unavailable'; readonly error: { readonly code: 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' | 'INVALID_MESSAGE' } };

/** Draft geometry is navigation only. The original quote/reducer owns target, fee and execution legality. */
export function getRoomExplorationRoute(snapshot: RoomSnapshot, actorId: string, request: ExplorationRouteRequest): ExplorationRouteResult {
  const { state, definition } = snapshot;
  let options: Extract<ExplorationRouteResult, { status: 'ready' }>['options'] = null;
  if (request.gameId === state.gameId && request.expectedVersion === state.stateVersion &&
      automaticProgress(snapshot)?.status !== 'pending' && state.roundFlow?.stage === 'player-actions' &&
      getRoundTurn(state, definition).actorId === actorId && !state.cityPatternContinuation && state.phase === 'exploration' && state.exploration?.status === 'ready') {
    const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
    let current = state.board.cityNodeByPlayer[actorId]!, connected = true;
    for (const step of request.path) {
      if (!areNodesDirectlyConnected(board, current, step.toNodeId, step.routeId)) { connected = false; break; }
      current = step.toNodeId;
    }
    let quote: ExplorationTollQuote | null = null;
    let execution: ActionPermission = { legal: false, blockedBy: connected ? 'PATH_REQUIRED' : 'PATH_CONNECTION' };
    if (connected && request.path.length) {
      try {
        quote = getExplorationTollQuote(state, definition, actorId, current, request.path);
        execution = actionPermission(snapshot, actorId, 'exploration', { type: 'explore', nodeId: current, path: request.path });
      } catch (error) {
        if (!(error instanceof ExplorationCommandError)) throw error;
        execution = { legal: false, blockedBy: error.code };
      }
    }
    options = { path: request.path.map(step => ({ ...step })), currentNodeId: current, quote, execution,
      nextSteps: connected && request.path.length < 22 ? getRoutesForNode(board, current).flatMap(route =>
        getNodesForRoute(board, route.id).filter(node => node.id !== current)
          .map(node => ({ routeId: route.id, toNodeId: node.id }))) : [] };
  }
  return deepFreeze({ status: 'ready', roomId: snapshot.roomId, gameId: state.gameId, stateVersion: state.stateVersion, options });
}
