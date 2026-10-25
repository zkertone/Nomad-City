import { nestedFacilityEntryIssues } from './facility-entry-invariants.js';
import { loadFoundersBoard } from '../board/index.js';
import { getFoundersMapSide } from './state.js';
import { explorationProgressIssuesFor } from './exploration-invariants.js';
import { affordableWarehouseTargets } from './warehouse-rules.js';
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
      gameId: state.gameId, board: state.board, players: state.players, markerSupplyByPlayer: state.markerSupplyByPlayer, ...(state.patternMarkers ? { patternMarkers: state.patternMarkers } : {}),
    }, ...state.facilities }, definition);
    if (!checked.success) { for (const message of checked.issues) report('facilities', message); return issues; }
  }
  for (const holding of state.facilities?.supply.playerHoldings ?? []) for (const id of holding.cardIds) {
    try { if (getFacilityConstructionSpec(id).entry.kind === 'warehouse' && !['1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0'].includes(state.schemaVersion)) report('facilities', 'Built warehouse requires format 1.11.0'); } catch { /* Other invalid/unsupported cards are checked by their existing validators. */ }
  }
  issues.push(...nestedFacilityEntryIssues(state, definition));
  const action = state.construction;
  if (state.phase !== 'construction' || !action) return issues;
  if (!definition.players.some(player => player.id === action.actorId)) report('construction.actorId', 'Unknown granted player');
  if (action.status === 'ready') {
    if (action.warehouseEntry !== undefined || action.entryStack !== undefined) report('construction', 'Ready construction cannot have an entry history');
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
  const entry = action.warehouseEntry;
  if (action.status === 'entry-pending' && !entry && !action.entryStack?.length) report('construction', 'Pending construction needs a real warehouse continuation');
  if (entry && definition.players.some(player => player.id === action.actorId)) {
    const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
    let warehouse = false; try { warehouse = action.builtCardId !== null && getFacilityConstructionSpec(action.builtCardId).entry.kind === 'warehouse'; } catch { /* Already reported. */ }
    if (!warehouse) report('construction.warehouseEntry', 'Only a built warehouse may own this continuation');
    const done = entry.status === 'complete' || entry.status === 'skipped';
    if ((action.status === 'complete') !== done) report('construction.status', 'Construction completes only after its nested entry');
    if (entry.kind === 'warehouse-choice' || entry.status === 'branch-choice') {
      if (entry.kind !== 'warehouse-choice' || entry.status !== 'branch-choice' || entry.targetNodeId !== null || entry.cardId !== null || entry.resolvedChoiceId !== null || action.status !== 'entry-pending') report('construction.warehouseEntry', 'Branch choice must precede all entry execution with empty exploration fields');
    } else if (entry.status === 'skipped') {
      if (entry.targetNodeId !== null || entry.cardId !== null || entry.resolvedChoiceId !== null || affordableWarehouseTargets(state, board, action.actorId, action.roundNumber, definition.players.length).length) report('construction.warehouseEntry', 'Skip only an actually impossible exploration without any draw');
    } else issues.push(...explorationProgressIssuesFor(state, { actorId: action.actorId, roundNumber: action.roundNumber, status: entry.status, targetNodeId: entry.targetNodeId, cardId: entry.cardId, resolvedChoiceId: entry.resolvedChoiceId }, definition, board));
  }
  return issues;
}
