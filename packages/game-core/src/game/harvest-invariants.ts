import type { BoardDefinition, ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState } from './types.js';
import { quoteHarvest } from './harvest-rules.js';

export function harvestIssues(state: GameState, definition: GameDefinition, board: BoardDefinition): ValidationIssue[] {
  if (state.phase !== 'harvest' || !state.harvest) return [];
  const issues: ValidationIssue[] = [];
  const report = (message: string): void => { issues.push({ code: 'HARVEST_PROGRESS', path: 'harvest', message }); };
  const plans = state.harvest.plansByPlayer;
  if (Object.keys(plans).length !== definition.players.length || definition.players.some(player => !Object.hasOwn(plans, player.id))) {
    report('Plans must have exactly the registered player IDs'); return issues;
  }
  const allSubmitted = Object.values(plans).every(plan => plan !== null);
  if ((state.harvest.status === 'complete') !== allSubmitted) report('The last submitted plan settles the phase; planning must have a missing plan');
  for (const player of definition.players) {
    const plan = plans[player.id];
    if (plan) {
      try { quoteHarvest(state, board, player.id, plan, state.harvest.status === 'planning'); }
      catch (error) { report(`${player.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return issues;
}
