/** Confirmed physical quantities only; not a complete deck or player setup rule. */
export const FOUNDERS_FACILITY_COPY_COUNT_CONFIRMATIONS = Object.freeze([
  Object.freeze({ facilityId: 'FAC-CORE-COMMAND-TOWER', facilityName: '核心指挥塔', physicalCopyCount: 4,
    sourceRef: 'user-2026-10-22-core-command-tower-copies' } as const),
]);
/** Unknown quantities remain null, rather than silently defaulting to one. */
export function getConfirmedFacilityCopyCount(facilityName: string): number | null {
  return FOUNDERS_FACILITY_COPY_COUNT_CONFIRMATIONS.find(fact => fact.facilityName === facilityName)?.physicalCopyCount ?? null;
}
