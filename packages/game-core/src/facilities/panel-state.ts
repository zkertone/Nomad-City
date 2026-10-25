import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import type { DeepReadonly } from '../game/types.js';
import { FOUNDERS_FACILITY_PANEL, FOUNDERS_FACILITY_PANEL_HASH, getFacilityPanelOrthogonalNeighbors } from './panel-definition.js';
import { getFacilityStockForReference, getFacilityPhysicalCard } from './stock.js';
import type { FacilityModuleValidation } from './stock.js';
import { parseFacilitySupplyState, validateFacilitySupplyState } from './supply.js';

const identifier = z.string().min(1).refine(value => value.trim().length > 0, 'Blank identifier');
export const facilityPanelStateSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'), gameId: identifier, playerId: identifier,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  panelRef: z.strictObject({ definitionId: z.literal('founders-player-panel'), definitionVersion: z.literal('1.0.0'), contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
  placements: z.array(z.strictObject({ cellId: identifier, cardId: identifier })).min(1).max(12),
});
export type FacilityPanelState = DeepReadonly<z.infer<typeof facilityPanelStateSchema>>;
/** Positions are stored once. Supply keeps ownership, and cross-checking requires an exact owner/position match. */
export function validateFacilityPanelState(input: unknown, supplyInput: unknown): FacilityModuleValidation<FacilityPanelState> {
  const supply = validateFacilitySupplyState(supplyInput);
  if (!supply.success) return { success: false, issues: supply.issues.map(issue => `supply: ${issue}`) };
  const parsed = facilityPanelStateSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const state = parsed.data, issues: string[] = [];
  if (state.gameId !== supply.data.gameId) issues.push('Panel/supply game mismatch');
  if (state.panelRef.contentHash !== FOUNDERS_FACILITY_PANEL_HASH) issues.push('Wrong panel definition reference');
  const owner = supply.data.playerHoldings.find(row => row.playerId === state.playerId);
  if (!owner) issues.push('Unknown panel owner');
  const ownedIds = new Set(owner?.cardIds ?? []), cells = new Set(FOUNDERS_FACILITY_PANEL.cells.map(cell => cell.id));
  const cardDefinitions = new Map(getFacilityStockForReference(supply.data.stockRef).cards.map(card => [card.id, card]));
  const usedCells = new Set<string>(), usedCards = new Set<string>();
  for (const placement of state.placements) {
    if (!cells.has(placement.cellId)) issues.push(`Unknown panel cell: ${placement.cellId}`);
    if (usedCells.has(placement.cellId)) issues.push(`Occupied cell used twice: ${placement.cellId}`);
    if (usedCards.has(placement.cardId)) issues.push(`Card placed twice: ${placement.cardId}`);
    usedCells.add(placement.cellId); usedCards.add(placement.cardId);
    const card = cardDefinitions.get(placement.cardId);
    if (!card) issues.push(`Unknown physical card: ${placement.cardId}`);
    if (!ownedIds.has(placement.cardId)) issues.push(`Card not owned by panel owner: ${placement.cardId}`);
    if (card?.group === 'core-command-tower' && placement.cellId !== FOUNDERS_FACILITY_PANEL.initialCoreCellId) issues.push('Core tower moved from its initial cell');
  }
  const core = state.placements.find(row => row.cellId === FOUNDERS_FACILITY_PANEL.initialCoreCellId);
  if (!core || cardDefinitions.get(core.cardId)?.group !== 'core-command-tower') issues.push('Initial core cell needs the core tower');
  for (const id of ownedIds) if (!usedCards.has(id)) issues.push(`Owned card has no panel position: ${id}`);
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(state) };
}
export function parseFacilityPanelState(input: unknown, supplyInput: unknown): FacilityPanelState {
  const result = validateFacilityPanelState(input, supplyInput);
  if (!result.success) throw new Error(`Invalid facility panel state: ${result.issues.join('; ')}`);
  return result.data;
}
export function validateFacilityPanelSet(input: unknown, supplyInput: unknown): FacilityModuleValidation<readonly FacilityPanelState[]> {
  const supply = validateFacilitySupplyState(supplyInput);
  if (!supply.success) return { success: false, issues: supply.issues.map(issue => `supply: ${issue}`) };
  const parsed = z.array(z.unknown()).min(2).max(4).safeParse(input);
  if (!parsed.success) return { success: false, issues: ['Panel set must contain 2 to 4 panels'] };
  const panels: FacilityPanelState[] = [], issues: string[] = [];
  for (const [index, item] of parsed.data.entries()) {
    const result = validateFacilityPanelState(item, supply.data);
    if (result.success) panels.push(result.data);
    else issues.push(...result.issues.map(issue => `panels.${index}: ${issue}`));
  }
  const ids = panels.map(panel => panel.playerId);
  if (new Set(ids).size !== ids.length) issues.push('Duplicate player panel');
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(supply.data.playerHoldings.map(row => row.playerId).sort())) issues.push('Panel set must cover exactly the supply players');
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(panels) };
}
/** Setup only: cannot reset an existing constructed city by supplying non-initial holdings/zones. */
export function createInitialFacilityPanels(supplyInput: unknown): readonly FacilityPanelState[] {
  const supply = parseFacilitySupplyState(supplyInput);
  if (supply.revision !== 0 || supply.supply.length !== 6 || supply.drawPile.length !== (supply.stockRef.definitionId === 'project-base-facility-stock' ? 38 : 35) || supply.extensionReserve.length !== 3
    || supply.returnedToBox.length || supply.playerHoldings.some(row => row.cardIds.length !== 1)) throw new Error('Expected initial facility supply');
  return deepFreeze(supply.playerHoldings.map(owner => parseFacilityPanelState({
    schemaVersion: '1.0.0', gameId: supply.gameId, playerId: owner.playerId, revision: 0,
    panelRef: { definitionId: FOUNDERS_FACILITY_PANEL.definitionId, definitionVersion: FOUNDERS_FACILITY_PANEL.definitionVersion, contentHash: FOUNDERS_FACILITY_PANEL_HASH },
    placements: [{ cellId: FOUNDERS_FACILITY_PANEL.initialCoreCellId, cardId: owner.cardIds[0]! }],
  }, supply)));
}
export function getEmptyFacilityPanelCells(panelInput: unknown, supplyInput: unknown) {
  const panel = parseFacilityPanelState(panelInput, supplyInput), occupied = new Set(panel.placements.map(row => row.cellId));
  return deepFreeze(FOUNDERS_FACILITY_PANEL.cells.filter(cell => !occupied.has(cell.id)));
}
export function getOrthogonallyAdjacentPanelFacilities(panelInput: unknown, supplyInput: unknown, cellId: string) {
  const panel = parseFacilityPanelState(panelInput, supplyInput);
  const adjacent = new Set(getFacilityPanelOrthogonalNeighbors(cellId).map(cell => cell.id));
  return deepFreeze(panel.placements.filter(placement => adjacent.has(placement.cellId)).map(placement => {
    const card = getFacilityPhysicalCard(placement.cardId);
    return { ...placement, facilityId: card.facilityId, color: card.color };
  }));
}
const placementRequestSchema = z.strictObject({
  actorId: identifier, cardId: identifier, cellId: identifier,
  expectedPanelRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedSupplyRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  source: z.enum(['supply', 'draw-pile']).optional(),
});
export type FacilityPanelPlacementPreview =
  | { readonly status: 'position-unavailable'; readonly issues: readonly string[] }
  | { readonly status: 'position-available'; readonly placement: { readonly cellId: string; readonly cardId: string }; readonly source: 'supply' | 'extension-reserve' | 'draw-pile' };
/** Reference/position preflight only. It neither authorizes construction nor transfers/deducts/executes anything. */
export function previewFacilityPanelPlacement(panelInput: unknown, supplyInput: unknown, requestInput: unknown): FacilityPanelPlacementPreview {
  const parsed = placementRequestSchema.safeParse(requestInput);
  if (!parsed.success) return deepFreeze({ status: 'position-unavailable', issues: ['Invalid placement preview request'] });
  const validated = validateFacilityPanelState(panelInput, supplyInput);
  if (!validated.success) return deepFreeze({ status: 'position-unavailable', issues: validated.issues });
  const panel = validated.data, supply = parseFacilitySupplyState(supplyInput), request = parsed.data, issues: string[] = [];
  if (request.actorId !== panel.playerId) issues.push('Actor does not own this panel');
  if (request.expectedPanelRevision !== panel.revision) issues.push('Stale panel revision');
  if (request.expectedSupplyRevision !== supply.revision) issues.push('Stale supply revision');
  if (!FOUNDERS_FACILITY_PANEL.cells.some(cell => cell.id === request.cellId)) issues.push('Unknown target panel cell');
  else if (panel.placements.some(row => row.cellId === request.cellId)) issues.push('Target cell is occupied');
  const source = request.source === 'draw-pile' ? (supply.drawPile.includes(request.cardId) ? 'draw-pile' as const : null)
    : supply.supply.includes(request.cardId) ? 'supply' as const : supply.extensionReserve.includes(request.cardId) ? 'extension-reserve' as const : null;
  if (!source) issues.push('Candidate card is not in supply or extension reserve');
  if (issues.length || !source) return deepFreeze({ status: 'position-unavailable', issues });
  return deepFreeze({ status: 'position-available', placement: { cellId: request.cellId, cardId: request.cardId }, source });
}
