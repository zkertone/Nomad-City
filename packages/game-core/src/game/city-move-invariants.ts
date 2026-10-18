import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import type { BoardDefinition, ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState } from './types.js';
import { redExplorationOpeningRound } from './exploration-rules.js';
import { availableTargetInfluenceSlots } from './influence.js';

export function cityMoveProgressIssues(state: GameState, definition: GameDefinition, board: BoardDefinition): ValidationIssue[] {
  if (state.phase !== 'city-move' || !state.cityMove) return [];
  const move = state.cityMove;
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string): void => { issues.push({ code: 'CITY_MOVE_PROGRESS', path, message }); };
  if (!definition.players.some(player => player.id === move.actorId)) report('cityMove.actorId', 'Unknown moving player');
  if (move.status === 'ready') {
    if ([move.sourceNodeId, move.targetNodeId, move.routeId, move.cardId, move.resolvedChoiceId].some(id => id !== null)) report('cityMove', 'Ready grant cannot contain a performed move');
    return issues;
  }
  if (!move.sourceNodeId || !move.targetNodeId || !move.routeId) { report('cityMove', 'Performed move requires its source, target and chosen route'); return issues; }
  const route = Object.hasOwn(board.routes, move.routeId) ? board.routes[move.routeId] : undefined;
  const node = Object.hasOwn(board.resourceNodes, move.targetNodeId) ? board.resourceNodes[move.targetNodeId] : undefined;
  if (!route || !node || move.sourceNodeId === move.targetNodeId || !route.incidentNodeIds.includes(move.sourceNodeId) || !route.incidentNodeIds.includes(move.targetNodeId)) {
    report('cityMove.routeId', 'Movement must use a single route incident to both distinct endpoints'); return issues;
  }
  if (!state.board.resourceMarkerByNode[move.sourceNodeId]) report('cityMove.sourceNodeId', 'Source must already be explored');
  if (!Object.hasOwn(state.board.cityNodeByPlayer, move.actorId) || state.board.cityNodeByPlayer[move.actorId] !== move.targetNodeId) report('cityMove.targetNodeId', 'Moving city must now occupy the target');
  if (node.redRestricted && move.roundNumber < redExplorationOpeningRound(definition.players.length)) report('cityMove.roundNumber', 'Red target is not open');
  for (const slotId of [...route.influenceSlotIds, ...node.influenceSlotIds]) {
    const marker = state.board.influenceBySlot[slotId];
    if (marker && marker.ownerPlayerId !== move.actorId) report(slotId, 'Opposing influence must have been cleared before event resolution');
  }
  if (!state.board.resourceMarkerByNode[move.targetNodeId]) report('cityMove.targetNodeId', 'Moved-to node must be explored');
  if (move.cardId === null) {
    if (move.status === 'event-choice' || move.resolvedChoiceId !== null) report('cityMove.cardId', 'Already explored destination has no new event');
  } else {
    const card = FOUNDERS_EVENT_CATALOG.cards.find(card => card.id === move.cardId);
    if (!card || state.board.resourceMarkerByNode[move.targetNodeId]?.markerDefinitionId !== move.cardId) report('cityMove.cardId', 'New event must match the target marker');
    if (move.status === 'event-choice') {
      if (move.resolvedChoiceId !== null) report('cityMove.resolvedChoiceId', 'Pending event cannot already be resolved');
    } else if (!card?.choices.some(choice => choice.id === move.resolvedChoiceId)) report('cityMove.resolvedChoiceId', 'Resolved choice must belong to this event');
  }
  if (move.status === 'final-influence' && !availableTargetInfluenceSlots(state, board, move.actorId, move.targetNodeId).length) report('cityMove.status', 'Impossible final placement must complete automatically');
  return issues;
}
