import type { ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState } from './types.js';
import { eligibleBaseEventIds } from './exploration-rules.js';

export function actionPositionIssues(state: GameState, definition: GameDefinition): ValidationIssue[] {
  if (state.phase === 'entry' || !state.eventDecks) return [];
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string): void => { issues.push({ code: 'ACTION_POSITION', path, message }); };
  if (JSON.stringify([...(state.playerOrder ?? [])].sort()) !== JSON.stringify(definition.players.map(player => player.id).sort())) {
    report('playerOrder', 'Preserved clockwise order must contain exactly the registered players');
  }
  for (const player of definition.players) {
    const city = state.board.cityNodeByPlayer[player.id];
    if (!city || !state.board.resourceMarkerByNode[city]) report(player.id, 'An action requires every city at an explored node');
  }
  const revealed = new Set(Object.values(state.board.resourceMarkerByNode).filter(marker => marker !== null).map(marker => marker!.markerDefinitionId));
  for (const color of ['green', 'yellow', 'red'] as const) {
    const expected = eligibleBaseEventIds(definition.players.length, color).filter(id => !revealed.has(id)).sort();
    if (JSON.stringify([...state.eventDecks[color]].sort()) !== JSON.stringify(expected)) report(`eventDecks.${color}`, 'Deck must be exactly the eligible unconsumed cards');
  }
  return issues;
}
