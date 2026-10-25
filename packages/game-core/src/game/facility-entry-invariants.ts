import { loadFoundersBoard } from '../board/index.js';
import type { ValidationIssue } from '../board/types.js';
import { getFacilityPhysicalCard } from '../facilities/stock.js';
import { getFoundersMapSide } from './state.js';
import { facilityEntrySpec, copyEntryTargets, extraConstructionOptions } from './facility-entry-rules.js';
import { affordableWarehouseTargets } from './warehouse-rules.js';
import { cityMoveProgressIssuesFor } from './city-move-invariants.js';
import { explorationProgressIssuesFor } from './exploration-invariants.js';
import type { GameDefinition, GameState } from './types.js';

/** Local continuation provenance and real action semantics; no extra ownership or economic ledger. */
export function nestedFacilityEntryIssues(state: GameState, definition: GameDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (message: string) => issues.push({ code: 'FACILITY_ENTRY', path: 'construction.entryStack', message });
  for (const holding of state.facilities?.supply.playerHoldings ?? []) for (const id of holding.cardIds) {
    try {
      const card = getFacilityPhysicalCard(id);
      if (card.group === 'core-command-tower') continue;
      const kind = facilityEntrySpec(id).entry.kind;
      if ((card.group === 'extension-hub' || ['logistics', 'free-city-move', 'copy-entry', 'starting-player', 'extra-construction'].includes(kind)) && !['1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion)) report('Built nested facility requires format 1.12.0');
    } catch { /* Existing physical/pictured validators report unsupported references. */ }
  }
  const override = state.roundFlow?.startingPlayerOverride;
  if (override) {
    const panel = state.facilities?.panels.find(row => row.playerId === override.playerId);
    let council = false; try { council = getFacilityPhysicalCard(override.cardId).facilityId === 'FAC-015'; } catch { /* report below */ }
    if (!panel?.placements.some(row => row.cardId === override.cardId) || !council || !['player-actions', 'harvest', 'cleanup'].includes(state.roundFlow!.stage)) report('Starting-player override must name an owned council in the current active round');
  }
  const action = state.construction, stack = action?.entryStack;
  if (!action || stack === undefined) return issues;
  if (action.warehouseEntry !== undefined) report('Only one continuation representation may own the construction');
  if (!['1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) || (action.status === 'entry-pending') !== (stack.length > 0)) report('Stack and parent completion must agree in format 1.12.0');
  if (!stack.length) return issues;
  if (stack[0]!.kind !== 'entry' || stack[0]!.sourceCardId !== action.builtCardId) report('Root entry must belong to the facility constructed by this action');
  const panel = state.facilities?.panels.find(row => row.playerId === action.actorId);
  if (!panel) { report('Unknown entry actor/panel'); return issues; }
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const seen = new Set<string>();
  for (const [index, frame] of stack.entries()) {
    if (!panel.placements.some(row => row.cardId === frame.sourceCardId)) { report('Every source must be owned and placed on the acting player panel'); continue; }
    let spec; try { spec = facilityEntrySpec(frame.sourceCardId); } catch { report('Entry source needs a confirmed executable face'); continue; }
    if (frame.kind === 'entry') {
      if (seen.has(frame.sourceCardId)) report('An entry cannot recursively copy/rebuild itself');
      seen.add(frame.sourceCardId);
      if ((frame.status === 'waiting') !== (index < stack.length - 1)) report('Waiting entries require exactly their unfinished child');
      if (frame.status === 'choice') {
        if (['none', 'gain', 'core-neighbor-vouchers', 'starting-player', 'free-city-move'].includes(spec.entry.kind)) report('Deterministic entries must advance automatically');
        if (spec.entry.kind === 'copy-entry' && !copyEntryTargets(state, action.actorId, frame.sourceCardId).length) report('Impossible copy must advance automatically');
        if (spec.entry.kind === 'extra-construction') {
          const options = extraConstructionOptions(state, definition, action.actorId);
          if (!options.choices.length && !options.unresolvedCardIds.length) report('Impossible extra construction must advance automatically');
        }
      }
    } else {
      if (index !== stack.length - 1 || frame.progress.actorId !== action.actorId || frame.progress.roundNumber !== action.roundNumber) report('Child action must be the active leaf of the same actor and round');
      if (frame.kind === 'exploration') {
        if (spec.entry.kind !== 'warehouse' || frame.progress.status === 'complete') report('Only an unfinished warehouse exploration may remain');
        if (frame.progress.status === 'ready' && !affordableWarehouseTargets(state, board, action.actorId, action.roundNumber, definition.players.length).length) report('An impossible warehouse exploration must advance automatically');
        issues.push(...explorationProgressIssuesFor(state, frame.progress, definition, board));
      } else {
        if (spec.entry.kind !== 'free-city-move') report('Only the power-system entry grants free city movement');
        issues.push(...cityMoveProgressIssuesFor(state, frame.progress, definition, board));
        if (frame.progress.status === 'complete' && (!state.markerSupplyByPlayer[action.actorId]?.length || !board.routes[frame.progress.routeId!]?.influenceSlotIds.some(id => state.board.influenceBySlot[id] === null))) report('Impossible extra route placement must advance automatically');
      }
    }
    if (index > 0) {
      const parent = stack[index - 1]!;
      let allowed = false;
      if (parent.kind === 'entry' && parent.status === 'waiting') {
        try {
          const kind = facilityEntrySpec(parent.sourceCardId).entry.kind;
          if (kind === 'copy-entry') allowed = frame.kind === 'entry' && copyEntryTargets(state, action.actorId, parent.sourceCardId).includes(frame.sourceCardId);
          else if (kind === 'extra-construction') allowed = frame.kind === 'entry' && frame.sourceCardId !== parent.sourceCardId && getFacilityPhysicalCard(frame.sourceCardId).group === 'ordinary';
          else if (kind === 'warehouse') allowed = frame.kind === 'exploration' && frame.sourceCardId === parent.sourceCardId;
          else if (kind === 'free-city-move') allowed = frame.kind === 'city-move' && frame.sourceCardId === parent.sourceCardId;
        } catch { /* Invalid parent already reported. */ }
      }
      if (!allowed) report('Each child must have the exact construction/copy/action authority of its parent');
    }
  }
  return issues;
}
