import { z } from 'zod';
import {
  deepFreeze, gameEntityIdSchema, explorationPathStepSchema, getRoundTurn,
  loadFoundersBoard, getFoundersMapSide, getRoutesForNode, getNodesForRoute, areNodesDirectlyConnected,
  quoteExplorationStep, ExplorationCommandError,
  getNestedFacilityEntryOptions, getPendingFacilityEventRequirements, getPendingWarehouseEventRequirements, getWarehouseEntryFinalSlotIds,
  getCityMoveOptions, getCityMoveFinalSlotIds, getExplorationFinalSlotIds,
  getPendingExplorationChoiceRequirements, getPendingCityMoveChoiceRequirements, getFoundersEventCard,
} from '@nomad-city-online/game-core';
import type { EventChoice, EventSettlementChoice, ExplorationTollQuote, ExplorationProgress } from '@nomad-city-online/game-core';
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
  readonly channel: 'exploration' | 'city-move' | 'facility-entry' | 'warehouse-entry';
  readonly cityMoveCost: 0 | 3;
  readonly status: 'ready' | 'event-choice' | 'final-influence' | 'complete';
  readonly targetNodeId: string | null;
  readonly moves: readonly (ActionPermission & { readonly nodeId: string; readonly routeId: string })[];
  readonly finalSlotIds: readonly string[];
  readonly event: TravelEvent | null;
}
/** Current authoritative travel owner, including persisted construction children. */
export function getTravelContext(snapshot: RoomSnapshot, actorId: string) {
  const { state, definition } = snapshot;
  if (state.cityPatternContinuation) return null;
  if (state.phase === 'exploration' && state.exploration?.actorId === actorId)
    return { kind: 'explore' as const, channel: 'exploration' as const, progress: state.exploration,
      moves: [], finals: getExplorationFinalSlotIds(state, definition, actorId), requirements: getPendingExplorationChoiceRequirements };
  if (state.phase === 'city-move' && state.cityMove?.actorId === actorId)
    return { kind: 'city-move' as const, channel: 'city-move' as const, progress: state.cityMove,
      moves: getCityMoveOptions(state, definition, actorId), finals: getCityMoveFinalSlotIds(state, definition, actorId), requirements: getPendingCityMoveChoiceRequirements };
  const action = state.construction;
  if (state.phase !== 'construction' || action?.actorId !== actorId || action.status !== 'entry-pending') return null;
  const frame = action.entryStack?.at(-1);
  if (frame && frame.kind !== 'entry') {
    const options = getNestedFacilityEntryOptions(state, definition, actorId);
    return { kind: frame.kind === 'exploration' ? 'explore' as const : 'city-move' as const,
      channel: 'facility-entry' as const, progress: frame.progress,
      moves: 'moveOptions' in options ? options.moveOptions : [], finals: 'finalSlotIds' in options ? options.finalSlotIds : [], requirements: getPendingFacilityEventRequirements };
  }
  const warehouse = action.warehouseEntry;
  if (!warehouse || warehouse.status === 'skipped') return null;
  const progress: ExplorationProgress = { actorId, roundNumber: action.roundNumber,
    status: warehouse.status === 'branch-choice' ? 'ready' : warehouse.status,
    targetNodeId: warehouse.targetNodeId, cardId: warehouse.cardId, resolvedChoiceId: warehouse.resolvedChoiceId };
  return { kind: 'explore' as const, channel: 'warehouse-entry' as const, progress,
    moves: [], finals: warehouse.status === 'final-influence' ? getWarehouseEntryFinalSlotIds(state, definition, actorId) : [], requirements: getPendingWarehouseEventRequirements };
}
export function travelExplorationCommand(channel: NonNullable<ReturnType<typeof getTravelContext>>['channel'], nodeId: string, path: ExplorationRouteRequest['path']) {
  return channel === 'warehouse-entry'
    ? { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' }, warehouseExploration: { nodeId, path } }
    : { type: 'explore', nodeId, path };
}
/** Only the currently revealed card; executable variants use original settlement semantics. */
export function getTravelOptions(snapshot: RoomSnapshot, actorId: string): TravelOptions | null {
  const { state, definition } = snapshot, context = getTravelContext(snapshot, actorId);
  if (!context) return null;
  const { kind, channel, progress } = context;
  const eventType = kind === 'explore' ? 'choose-exploration-event' : 'choose-city-move-event';
  const finalType = kind === 'explore' ? 'place-exploration-influence' : 'place-city-move-influence';
  let event: TravelEvent | null = null;
  if (progress.status === 'event-choice') {
    const card = getFoundersEventCard(progress.cardId!);
    event = { cardId: card.id, title: card.title, description: card.description,
      choices: card.choices.map(choice => {
        const req = context.requirements(
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
  const finals = context.finals;
  return { kind, channel, cityMoveCost: channel === 'facility-entry' ? 0 : 3, status: progress.status, targetNodeId: progress.targetNodeId, event,
    moves: kind === 'city-move' ? context.moves.map(move => ({ ...move,
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
  const context = getTravelContext(snapshot, actorId);
  let options: Extract<ExplorationRouteResult, { status: 'ready' }>['options'] = null;
  if (request.gameId === state.gameId && request.expectedVersion === state.stateVersion &&
      automaticProgress(snapshot)?.status !== 'pending' && state.roundFlow?.stage === 'player-actions' &&
      getRoundTurn(state, definition).actorId === actorId && context?.kind === 'explore' && context.progress.status === 'ready') {
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
        quote = quoteExplorationStep(state, definition, context.progress, current, request.path, (code, message): never => { throw new ExplorationCommandError(code, message); });
        execution = actionPermission(snapshot, actorId, context.channel, travelExplorationCommand(context.channel, current, request.path));
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
