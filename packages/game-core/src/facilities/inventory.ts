import { deepFreeze } from '../board/hash.js';
import { FOUNDERS_FACILITY_COLOR_COUNTS } from './catalog.js';

/** Source confirmations preserve user statements even when aggregate counts conflict. */
export const FOUNDERS_FACILITY_COPY_COUNT_CONFIRMATIONS = Object.freeze([
  Object.freeze({ facilityId: 'FAC-CORE-COMMAND-TOWER', facilityName: '核心指挥塔', physicalCopyCount: 4,
    sourceRef: 'user-2026-10-22-core-command-tower-copies' } as const),
]);
/** User-reported quantities, NOT authority to initialize an official deck. */
export function getConfirmedFacilityCopyCount(facilityName: string): number | null {
  const direct = FOUNDERS_FACILITY_COPY_COUNT_CONFIRMATIONS.find(fact => fact.facilityName === facilityName);
  if (direct) return direct.physicalCopyCount;
  const record = FOUNDERS_FACILITY_COLOR_COUNTS.facilities.find(facility => facility.name === facilityName);
  return record ? Object.values(record.copyCountsByColor).reduce((sum, count) => sum + count, 0) : null;
}
export const FOUNDERS_FACILITY_COLOR_CONFIRMATIONS = Object.freeze([
  Object.freeze({ facilityId: 'FAC-CORE-COMMAND-TOWER', facilityName: '核心指挥塔', color: 'rainbow',
    sourceRef: 'user-2026-10-22-core-command-tower-color' } as const),
]);
/** Printed p01 component list, separate from the user's inventory observations. */
export const FOUNDERS_RULEBOOK_FACILITY_TOTALS = Object.freeze({ ordinary: 41, coreCommandTower: 4, extensionHub: 3, total: 48,
  sourceRef: 'rules-20230803-p01' } as const);

/** p15/p16 and the card's E mark identify enterprise offices; the user confirms O identifies the Infected DLC. */
export const FOUNDERS_FACILITY_EDITION_EVIDENCE = deepFreeze([
  { facilityId: 'FAC-020', marker: 'E', classification: 'enterprise', sourceRefs: ['card-image-3', 'rules-20230803-p15-p16', 'user-2026-10-22-e-enterprise-o-infected'] },
  { facilityId: 'FAC-017', marker: 'O', classification: 'infected', sourceRefs: ['card-image-1', 'user-2026-10-22-e-enterprise-o-infected'] },
  { facilityId: 'FAC-019', marker: 'O', classification: 'infected', sourceRefs: ['card-image-3', 'user-2026-10-22-e-enterprise-o-infected'] },
] as const);
export const FOUNDERS_RULEBOOK_ENTERPRISE_FACILITY_TOTAL = Object.freeze({ count: 3, sourceRef: 'rules-20230803-p15-p16' } as const);

/** Inventory quantities only, not facility effects, geometry or an action executor. */
export type FacilityEdition = 'base' | 'enterprise' | 'infected';
export function getFacilityCopyCountRecords(edition: FacilityEdition = 'base') {
  if (!['base', 'enterprise', 'infected'].includes(edition)) throw new RangeError(`Unknown facility edition: ${edition}`);
  const records = FOUNDERS_FACILITY_COLOR_COUNTS.facilities.map(record => {
    const evidence = FOUNDERS_FACILITY_EDITION_EVIDENCE.find(row => row.facilityId === record.id);
    return { ...record, edition: (evidence?.classification ?? 'base') as FacilityEdition };
  });
  records.push({ id: 'FAC-CORE-COMMAND-TOWER', name: '核心指挥塔', copyCountsByColor: { red: 0, blue: 0, yellow: 0, rainbow: 4 }, edition: 'base' });
  return deepFreeze(records.filter(record => record.edition === edition));
}
/** Counts are reconciled; a playable deck still requires complete facility definitions. */
export function getFacilityInventoryReconciliation() {
  const sum = (edition: FacilityEdition) => getFacilityCopyCountRecords(edition).reduce((total, record) => total + Object.values(record.copyCountsByColor).reduce((a, b) => a + b, 0), 0);
  const base = sum('base'), enterprise = sum('enterprise'), infected = sum('infected');
  const coreCommandTower = getConfirmedFacilityCopyCount('核心指挥塔')!;
  const extensionHub = getConfirmedFacilityCopyCount('延伸枢纽')!;
  const baseOrdinary = base - coreCommandTower - extensionHub;
  const countsByColor = { red: 0, blue: 0, yellow: 0, rainbow: 0 };
  for (const edition of ['base', 'enterprise', 'infected'] as const) {
    for (const record of getFacilityCopyCountRecords(edition)) {
      for (const color of ['red', 'blue', 'yellow', 'rainbow'] as const) countsByColor[color] += record.copyCountsByColor[color];
    }
  }
  const totalsReconciled = base === FOUNDERS_RULEBOOK_FACILITY_TOTALS.total && baseOrdinary === FOUNDERS_RULEBOOK_FACILITY_TOTALS.ordinary &&
    coreCommandTower === FOUNDERS_RULEBOOK_FACILITY_TOTALS.coreCommandTower && extensionHub === FOUNDERS_RULEBOOK_FACILITY_TOTALS.extensionHub &&
    enterprise === FOUNDERS_RULEBOOK_ENTERPRISE_FACILITY_TOTAL.count;
  return deepFreeze({ interpretation: 'physical-copies-by-color-and-edition' as const,
    status: totalsReconciled ? 'counts-reconciled' as const : 'unreconciled' as const,
    reported: { base, enterprise, infected, total: base + enterprise + infected },
    baseBreakdown: { ordinary: baseOrdinary, coreCommandTower, extensionHub },
    rules: { base: FOUNDERS_RULEBOOK_FACILITY_TOTALS.total, enterpriseAddition: FOUNDERS_RULEBOOK_ENTERPRISE_FACILITY_TOTAL.count },
    countsByColor, totalsReconciled, readyForDeckSetup: false as const });
}
