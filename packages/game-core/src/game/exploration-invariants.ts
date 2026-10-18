import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import type { BoardDefinition, ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState } from './types.js';
import { eligibleBaseEventIds, finalExplorationSlots, redExplorationOpeningRound } from './exploration-rules.js';

export function explorationProgressIssues(state: GameState, definition: GameDefinition, board: BoardDefinition): ValidationIssue[] {
  if (state.phase !== 'exploration' || !state.exploration || !state.eventDecks) return [];
  const progress = state.exploration;
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string): void => { issues.push({ code: 'EXPLORATION_PROGRESS', path, message }); };
  if (JSON.stringify([...(state.playerOrder ?? [])].sort()) !== JSON.stringify(definition.players.map(player => player.id).sort())) {
    report('playerOrder', 'Preserved clockwise order must contain exactly the registered players');
  }
  if (!definition.players.some(player => player.id === progress.actorId)) report('exploration.actorId', 'Unknown action actor');
  for (const player of definition.players) {
    const city = state.board.cityNodeByPlayer[player.id];
    if (!city || !state.board.resourceMarkerByNode[city]) report(player.id, 'An action requires every city at an explored node');
  }
  for (const color of ['green', 'yellow', 'red'] as const) {
    const revealed = new Set(Object.values(state.board.resourceMarkerByNode).filter(marker => marker !== null).map(marker => marker!.markerDefinitionId));
    const expected = eligibleBaseEventIds(definition.players.length, color).filter(id => !revealed.has(id)).sort();
    if (JSON.stringify([...state.eventDecks[color]].sort()) !== JSON.stringify(expected)) report(`eventDecks.${color}`, 'Deck must be exactly the eligible unconsumed cards');
  }
  if (progress.status === 'ready') {
    if (progress.targetNodeId !== null || progress.cardId !== null || progress.resolvedChoiceId !== null) report('exploration', 'Ready action cannot contain a revealed target');
    return issues;
  }
  if (!progress.targetNodeId || !progress.cardId) { report('exploration', 'Started exploration requires its target/card'); return issues; }
  if (!Object.hasOwn(board.resourceNodes, progress.targetNodeId)) { report('exploration.targetNodeId', 'Unknown target'); return issues; }
  const marker = state.board.resourceMarkerByNode[progress.targetNodeId];
  if (marker?.markerDefinitionId !== progress.cardId) report('exploration.cardId', 'Pending card must match the target marker');
  if (board.resourceNodes[progress.targetNodeId]!.redRestricted && progress.roundNumber < redExplorationOpeningRound(definition.players.length)) {
    report('exploration.roundNumber', 'Red target is not open');
  }
  const card = FOUNDERS_EVENT_CATALOG.cards.find(card => card.id === progress.cardId);
  if (!card) { report('exploration.cardId', 'Unknown base event'); return issues; }
  if (progress.status === 'event-choice') {
    if (progress.resolvedChoiceId !== null) report('exploration.resolvedChoiceId', 'Event choice has not been resolved');
  } else if (!card.choices.some(choice => choice.id === progress.resolvedChoiceId)) {
    report('exploration.resolvedChoiceId', 'Resolved choice must belong to this event');
  }
  if (progress.status === 'final-influence' && !finalExplorationSlots(state, board, progress.actorId, progress.targetNodeId).length) {
    report('exploration.status', 'Impossible final placement must be completed automatically');
  }
  return issues;
}
