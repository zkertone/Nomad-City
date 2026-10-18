import type { BoardDefinition, ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState } from './types.js';
import { availableInfluenceSlots, dispatchSourceSlots } from './influence.js';

export function influenceActionIssues(state: GameState, definition: GameDefinition, board: BoardDefinition): ValidationIssue[] {
  if (state.phase !== 'influence-action' || !state.influenceAction) return [];
  const action = state.influenceAction;
  const issues: ValidationIssue[] = [];
  const report = (message: string): void => { issues.push({ code: 'INFLUENCE_ACTION', path: 'influenceAction', message }); };
  if (!definition.players.some(player => player.id === action.actorId)) { report('Unknown granted player'); return issues; }
  if (action.kind === 'deploy') {
    if (action.operationsCompleted > 1 || (action.status === 'ready' && action.operationsCompleted !== 0)) report('Deployment permits exactly one placement when possible');
    const available = availableInfluenceSlots(state, board, action.actorId).length;
    if ((action.status === 'ready' && !available) || (action.status === 'complete' && action.operationsCompleted === 0 && available)) report('Impossible deployment completes automatically; possible deployment requires a choice');
  } else if (action.status === 'ready' && (action.operationsCompleted >= 2 || !dispatchSourceSlots(state, board, action.actorId).length)) {
    report('Dispatch is ready only before two moves and with an executable move');
  }
  return issues;
}
