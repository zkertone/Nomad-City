import type { ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState } from './types.js';
import { validateFacilityConstructionPosition } from '../facilities/construction.js';
import { getFacilityConstructionSpec } from '../facilities/construction-spec.js';

/** One persisted balance/ownership/placement ledger, including while another action is active. */
export function constructionIssues(state: GameState, definition: GameDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string) => { issues.push({ code: 'CONSTRUCTION_STATE', path, message }); };
  if (state.facilities) {
    const checked = validateFacilityConstructionPosition({ position: {
      gameId: state.gameId, board: state.board, players: state.players, markerSupplyByPlayer: state.markerSupplyByPlayer,
    }, ...state.facilities }, definition);
    if (!checked.success) for (const message of checked.issues) report('facilities', message);
  }
  const action = state.construction;
  if (state.phase !== 'construction' || !action) return issues;
  if (!definition.players.some(player => player.id === action.actorId)) report('construction.actorId', 'Unknown granted player');
  if (action.status === 'ready') {
    if (action.constructionsCompleted !== 0 || action.builtCardId !== null) report('construction', 'Ready window has no completed construction');
    if (state.facilities?.panels.find(panel => panel.playerId === action.actorId)?.placements.length === 12) report('construction', 'Ready construction needs an empty panel cell');
  } else {
    if (action.constructionsCompleted !== 1 || action.builtCardId === null) report('construction', 'Completed window consumes exactly one construction');
    if (!state.facilities?.panels.find(panel => panel.playerId === action.actorId)?.placements.some(row => row.cardId === action.builtCardId)) report('construction.builtCardId', 'Completed facility must be on the granted player panel');
    if (action.builtCardId !== null) {
      try { getFacilityConstructionSpec(action.builtCardId); }
      catch { report('construction.builtCardId', 'Completed ordinary construction needs a supported pictured facility'); }
    }
  }
  return issues;
}
