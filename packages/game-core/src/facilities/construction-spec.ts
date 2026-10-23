import { deepFreeze } from '../board/hash.js';
import { FOUNDERS_FACILITY_FACES, getFoundersFacilityFace } from './faces.js';
import { FOUNDERS_FACILITY_STOCK, getFoundersPhysicalFacilityCard } from './stock.js';

// Pin the executable interpretation independently: new card text must be reviewed before these handlers run against it.
export const FACILITY_CONSTRUCTION_SOURCE_HASH = 'sha256:840edd051e9c8a97377a0419cf64d663b35d68a2fcd861b5f288560ac6ab614e';
export class FacilityConstructionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'FacilityConstructionError'; }
}
export const rejectFacilityConstruction = (code: string, message: string): never => { throw new FacilityConstructionError(code, message); };
export type SupportedFacilityEntry =
  | { readonly kind: 'none' }
  | { readonly kind: 'warehouse' }
  | { readonly kind: 'logistics' | 'free-city-move' | 'copy-entry' | 'starting-player' | 'extra-construction' }
  | { readonly kind: 'remove-two-influence' }
  | { readonly kind: 'replace-or-remove-influence' }
  | { readonly kind: 'sell-resources' }
  | { readonly kind: 'gain'; readonly asset: 'orirock' | 'originium' | 'iron'; readonly amount: number }
  | { readonly kind: 'choose-five-resources' }
  | { readonly kind: 'core-neighbor-vouchers' };
const supported = deepFreeze([
  { facilityId: 'FAC-016', entry: { kind: 'extra-construction' } },
  { facilityId: 'FAC-015', entry: { kind: 'starting-player' } },
  { facilityId: 'FAC-014', entry: { kind: 'copy-entry' } },
  { facilityId: 'FAC-007', entry: { kind: 'free-city-move' } },
  { facilityId: 'FAC-004', entry: { kind: 'logistics' } },
  { facilityId: 'FAC-001', entry: { kind: 'warehouse' } },
  { facilityId: 'FAC-002', entry: { kind: 'remove-two-influence' } },
  { facilityId: 'FAC-003', entry: { kind: 'replace-or-remove-influence' } },
  { facilityId: 'FAC-005', entry: { kind: 'core-neighbor-vouchers' } },
  { facilityId: 'FAC-006', entry: { kind: 'sell-resources' } },
  { facilityId: 'FAC-008', entry: { kind: 'choose-five-resources' } },
  { facilityId: 'FAC-009', entry: { kind: 'none' } },
  { facilityId: 'FAC-010', entry: { kind: 'gain', asset: 'iron', amount: 4 } },
  { facilityId: 'FAC-011', entry: { kind: 'gain', asset: 'originium', amount: 6 } },
  { facilityId: 'FAC-012', entry: { kind: 'gain', asset: 'orirock', amount: 7 } },
  { facilityId: 'FAC-013', entry: { kind: 'none' } },
] as const);
/** Card type + pictured color only. No fee/effect is inferred for unpictured color variants. */
export function getFacilityConstructionSpec(cardId: string) {
  if (FOUNDERS_FACILITY_FACES.contentHash !== FACILITY_CONSTRUCTION_SOURCE_HASH) return rejectFacilityConstruction('CARD_SOURCE_VERSION', 'Executable facility interpretation needs review for this text version');
  let card;
  try { card = getFoundersPhysicalFacilityCard(cardId); }
  catch { return rejectFacilityConstruction('CARD_REFERENCE', 'Unknown physical facility card'); }
  if (card.group !== 'ordinary') return rejectFacilityConstruction('CARD_SOURCE', 'Core/extension cards cannot use ordinary construction');
  const face = getFoundersFacilityFace(card.facilityId);
  if (card.color !== face.observedColor) return rejectFacilityConstruction('UNCONFIRMED_COLOR_VARIANT', 'No matching pictured color cost/effect is confirmed');
  const handler = supported.find(row => row.facilityId === card.facilityId);
  if (!handler) return rejectFacilityConstruction('UNSUPPORTED_ENTRY_EFFECT', 'This facility needs an entry handler before construction can run');
  if (face.constructionCost.kind !== 'printed-alternatives') return rejectFacilityConstruction('COST_NOT_CONFIRMED', 'No ordinary printed construction cost');
  return deepFreeze({ card, face, printedCost: face.constructionCost, entry: handler.entry as SupportedFacilityEntry });
}
export function getFacilityConstructionSupport() {
  return deepFreeze({
    supportedFacilityIds: supported.map(row => row.facilityId).sort(),
    supportedPhysicalCardIds: FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary'
      && supported.some(row => row.facilityId === card.facilityId)
      && getFoundersFacilityFace(card.facilityId).observedColor === card.color).map(card => card.id),
    supportedExtensionPhysicalCardIds: FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'extension-hub' && card.color === getFoundersFacilityFace(card.facilityId).observedColor).map(card => card.id),
    unconfirmedPhysicalCardIds: FOUNDERS_FACILITY_STOCK.cards.filter(card => card.color !== getFoundersFacilityFace(card.facilityId).observedColor).map(card => card.id),
    picturedOrdinaryTypesImplemented: true, nestedEntriesMinimumSnapshotVersion: '1.12.0',
    warehouseMinimumSnapshotVersion: '1.11.0', sourceHash: FACILITY_CONSTRUCTION_SOURCE_HASH, allFacilitiesImplemented: false as const,
  });
}
