import { loadFoundersBoard } from '../board/index.js';
import { getFoundersPhysicalFacilityCard } from '../facilities/stock.js';
import { getFoundersFacilityFace } from '../facilities/faces.js';
import { getFacilityConstructionSpec } from '../facilities/construction-spec.js';
import { getFacilityConstructionQuote } from '../facilities/construction.js';
import { getEmptyFacilityPanelCells, getOrthogonallyAdjacentPanelFacilities } from '../facilities/panel-state.js';
import { getFoundersMapSide } from './state.js';
import type { GameDefinition, GameState } from './types.js';

export function facilityEntrySpec(cardId: string) {
  const card = getFoundersPhysicalFacilityCard(cardId), face = getFoundersFacilityFace(card.facilityId);
  if (card.group === 'extension-hub') return { card, face, entry: { kind: 'none' as const } };
  return getFacilityConstructionSpec(cardId);
}
export const boardFor = (definition: GameDefinition) => loadFoundersBoard(getFoundersMapSide(definition.players.length));
export const panelFor = (state: GameState, actor: string) => state.facilities!.panels.find(panel => panel.playerId === actor)!;
export function copyEntryTargets(state: GameState, actor: string, source: string): readonly string[] {
  const panel = panelFor(state, actor), cell = panel.placements.find(row => row.cardId === source)?.cellId;
  if (!cell) return [];
  // The card restricts colour and orthogonal adjacency, not a second payment or printed points.
  return getOrthogonallyAdjacentPanelFacilities(panel, state.facilities!.supply, cell).filter(row => row.color !== 'rainbow').map(row => row.cardId);
}
export function extraConstructionOptions(state: GameState, definition: GameDefinition, actor: string) {
  const panel = panelFor(state, actor), empty = getEmptyFacilityPanelCells(panel, state.facilities!.supply);
  const choices: { cardId: string; paymentMode: 'resources' | 'vouchers' }[] = [], unresolvedCardIds: string[] = [];
  if (!empty.length) return { choices, unresolvedCardIds };
  for (const cardId of state.facilities!.supply.supply) {
    try { getFacilityConstructionSpec(cardId); } catch { unresolvedCardIds.push(cardId); continue; }
    for (const paymentMode of ['resources', 'vouchers'] as const) {
      try {
        const quote = getFacilityConstructionQuote({ position: { gameId: state.gameId, board: state.board, players: state.players, markerSupplyByPlayer: state.markerSupplyByPlayer, ...(state.patternMarkers ? { patternMarkers: state.patternMarkers } : {}) }, ...state.facilities! }, definition,
          { gameId: state.gameId, actorId: actor, expectedSupplyRevision: state.facilities!.supply.revision, expectedPanelRevision: panel.revision }, { cardId, cellId: empty[0]!.id, paymentMode });
        if (quote.canPay) choices.push({ cardId, paymentMode });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'UNIQUE_FACILITY')) unresolvedCardIds.push(cardId);
      }
    }
  }
  return { choices, unresolvedCardIds: [...new Set(unresolvedCardIds)] };
}
