import { describe, expect, it } from 'vitest';
import {
  FOUNDERS_FACILITY_COLOR_COUNTS, FOUNDERS_FACILITY_COLOR_COUNTS_HASH,
  FOUNDERS_FACILITY_COPY_COUNT_CONFIRMATIONS, getConfirmedFacilityCopyCount,
  FOUNDERS_FACILITY_COLOR_CONFIRMATIONS, getFacilityInventoryReconciliation, FOUNDERS_FACILITY_EDITION_EVIDENCE, getFacilityCopyCountRecords,
  validateFoundersFacilityColorCounts, parseFoundersFacilityColorCounts, getFoundersFacilityColorCountRecord,
  facilityColorCountsCatalogSchema, computeFacilityColorCountsHash, canonicalFacilityColorCountsContent,
} from './index.js';

// Independent transcription of the user's 2026-10-22 message; the user clarified these are physical COPY quantities, not cells or costs.
const confirmed = [
  ['载具仓库', 3, 0, 0, 0], ['护航调度中心', 2, 0, 0, 0], ['佣兵指挥部', 3, 0, 0, 0],
  ['物流枢纽', 0, 2, 0, 0], ['城市化区域', 0, 3, 0, 0], ['贸易街区', 0, 3, 0, 0],
  ['高性能动力系统', 0, 0, 2, 0], ['开采电铲', 0, 0, 3, 0], ['城邦工业区', 0, 0, 3, 0],
  ['异铁冶炼厂', 1, 1, 0, 0], ['源石精炼厂', 0, 1, 1, 0], ['固源岩提纯厂', 1, 0, 1, 0],
  ['城邦行政区', 0, 0, 0, 3], ['附属能源设施', 0, 0, 0, 3], ['联邦理事处', 0, 0, 0, 3],
  ['简陋工程营', 0, 0, 0, 2], ['临时聚居点', 0, 0, 0, 3],
  ['延伸枢纽', 1, 1, 1, 0], ['罗德岛办事处', 1, 1, 1, 0], ['企业办事处', 1, 1, 1, 0],
] as const;
const copy = () => facilityColorCountsCatalogSchema.parse(FOUNDERS_FACILITY_COLOR_COUNTS);

describe('reported facility copies by color', () => {
  it.each(confirmed)('preserves %s exactly', (name, red, blue, yellow, rainbow) => {
    const record = FOUNDERS_FACILITY_COLOR_COUNTS.facilities.find(item => item.name === name)!;
    expect(record).toBeDefined(); expect(record.copyCountsByColor).toEqual({ red, blue, yellow, rainbow });
    expect(getFoundersFacilityColorCountRecord(record.id)).toBe(record);
  });
  it('contains exactly the submitted 20 names with unique stable project IDs', () => {
    expect(FOUNDERS_FACILITY_COLOR_COUNTS.facilities.map(item => item.name).sort()).toEqual(confirmed.map(row => row[0]).sort());
    expect(new Set(FOUNDERS_FACILITY_COLOR_COUNTS.facilities.map(item => item.id)).size).toBe(20);
    expect(FOUNDERS_FACILITY_COLOR_COUNTS.verificationStatus).toBe('user-confirmed-copy-counts-and-editions');
  });
  it('preserves the separate reported color-variant quantities without rewriting the mismatch', () => {
    const sum = { red: 0, blue: 0, yellow: 0, rainbow: 0 };
    for (const facility of FOUNDERS_FACILITY_COLOR_COUNTS.facilities) {
      for (const color of ['red', 'blue', 'yellow', 'rainbow'] as const) sum[color] += facility.copyCountsByColor[color];
    }
    expect(sum).toEqual({ red: 13, blue: 13, yellow: 13, rainbow: 14 });
    expect(Object.values(sum).reduce((a, b) => a + b, 0)).toBe(53);
  });
  it('retains the extension hub color data without mixing in its newly supplied printed score', () => {
    const record = getFoundersFacilityColorCountRecord('FAC-018');
    expect(record.name).toBe('延伸枢纽'); expect(Object.keys(record).sort()).toEqual(['copyCountsByColor', 'id', 'name']);
    expect(FOUNDERS_FACILITY_COLOR_COUNTS.facilities.some(item => item.name === '核心指挥塔')).toBe(false);
  });
  it.each(['constructor', 'toString', '__proto__', 'FAC-000', 'FAC-021'])('rejects unknown project ID %s', id => {
    expect(() => getFoundersFacilityColorCountRecord(id)).toThrow(RangeError);
  });
});

describe('strict runtime validation and pinned content', () => {
  it('loads the pinned content and survives JSON round trips', () => {
    const result = validateFoundersFacilityColorCounts(JSON.parse(JSON.stringify(FOUNDERS_FACILITY_COLOR_COUNTS)));
    expect(result.success).toBe(true); expect(parseFoundersFacilityColorCounts(FOUNDERS_FACILITY_COLOR_COUNTS)).toEqual(FOUNDERS_FACILITY_COLOR_COUNTS);
    expect(computeFacilityColorCountsHash(FOUNDERS_FACILITY_COLOR_COUNTS)).toBe(FOUNDERS_FACILITY_COLOR_COUNTS_HASH);
  });
  it('detects a changed copy count even if the claimed hash is recomputed', () => {
    const data = copy(); data.facilities[0]!.copyCountsByColor.red = 2;
    expect(validateFoundersFacilityColorCounts(data).success).toBe(false);
    data.contentHash = computeFacilityColorCountsHash(data);
    const result = validateFoundersFacilityColorCounts(data); expect(result.success).toBe(false);
    if (!result.success) expect(result.issues).toContain('Facility color counts differ from user-reported baseline');
  });
  it('detects a changed name with unchanged quantities', () => {
    const data = copy(); data.facilities[0]!.name = '另一个设施'; data.contentHash = computeFacilityColorCountsHash(data);
    expect(validateFoundersFacilityColorCounts(data).success).toBe(false);
  });
  it('treats catalog entry order and object key order as nonsemantic', () => {
    const original = copy(), reordered = copy(); reordered.facilities.reverse();
    const rebuilt = { contentHash: reordered.contentHash, facilities: reordered.facilities.map(row => ({
      name: row.name, copyCountsByColor: { rainbow: row.copyCountsByColor.rainbow, yellow: row.copyCountsByColor.yellow, blue: row.copyCountsByColor.blue, red: row.copyCountsByColor.red }, id: row.id,
    })), sourceRefs: reordered.sourceRefs, verificationStatus: reordered.verificationStatus, catalogId: reordered.catalogId, schemaVersion: reordered.schemaVersion, scope: reordered.scope };
    expect(canonicalFacilityColorCountsContent(rebuilt)).toBe(canonicalFacilityColorCountsContent(original));
    expect(validateFoundersFacilityColorCounts(rebuilt).success).toBe(true);
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid color count %s', amount => {
    const data = copy(); data.facilities[0]!.copyCountsByColor.red = amount;
    expect(validateFoundersFacilityColorCounts(data).success).toBe(false);
  });
  it.each(['id', 'name'] as const)('rejects duplicate %s independently of the checksum', key => {
    const data = copy(); data.facilities[1]![key] = data.facilities[0]![key]; data.contentHash = computeFacilityColorCountsHash(data);
    expect(facilityColorCountsCatalogSchema.safeParse(data).success).toBe(false);
  });
  it.each(['cost', 'score', 'effect', 'footprint', 'cardImage'])('rejects unconfirmed field %s', field => {
    const data = copy(); const row = { ...data.facilities[0], [field]: 0 }; data.facilities[0] = row as typeof data.facilities[number];
    expect(validateFoundersFacilityColorCounts(data).success).toBe(false);
  });
  it('rejects missing/extra entries, empty counts, wrong version/source/status and a false hash', () => {
    const missing = copy(); missing.facilities.pop(); expect(validateFoundersFacilityColorCounts(missing).success).toBe(false);
    const extra = copy(); extra.facilities.push(extra.facilities[0]!); expect(validateFoundersFacilityColorCounts(extra).success).toBe(false);
    const zero = copy(); zero.facilities[0]!.copyCountsByColor = { red: 0, blue: 0, yellow: 0, rainbow: 0 }; expect(validateFoundersFacilityColorCounts(zero).success).toBe(false);
    expect(validateFoundersFacilityColorCounts({ ...copy(), schemaVersion: '3.0.0' }).success).toBe(false);
    expect(validateFoundersFacilityColorCounts({ ...copy(), sourceRefs: ['guessed-from-photo'] }).success).toBe(false);
    expect(validateFoundersFacilityColorCounts({ ...copy(), verificationStatus: 'fully-implemented' }).success).toBe(false);
    const badHash = copy(); badHash.contentHash = `sha256:${'0'.repeat(64)}`; expect(validateFoundersFacilityColorCounts(badHash).success).toBe(false);
    expect(() => parseFoundersFacilityColorCounts(badHash)).toThrow(/hash mismatch/);
  });
  it('deeply freezes validated copies while preserving editable caller data', () => {
    const data = copy(), before = structuredClone(data), result = parseFoundersFacilityColorCounts(data);
    const visit = (value: unknown): void => { if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(visit); } };
    visit(result); expect(data).toEqual(before); expect(Object.isFrozen(data)).toBe(false);
    visit(FOUNDERS_FACILITY_COLOR_COUNTS);
  });
});


describe('independent confirmed physical quantity', () => {
  it('preserves the four core command tower copies independently of the original batch', () => {
    expect(getConfirmedFacilityCopyCount('核心指挥塔')).toBe(4);
    expect(FOUNDERS_FACILITY_COPY_COUNT_CONFIRMATIONS).toEqual([{ facilityId: 'FAC-CORE-COMMAND-TOWER', facilityName: '核心指挥塔', physicalCopyCount: 4, sourceRef: 'user-2026-10-22-core-command-tower-copies' }]);
    expect(Object.isFrozen(FOUNDERS_FACILITY_COPY_COUNT_CONFIRMATIONS)).toBe(true);
    expect(Object.isFrozen(FOUNDERS_FACILITY_COPY_COUNT_CONFIRMATIONS[0])).toBe(true);
  });
  it('uses the supplied quantities and keeps only unlisted facility quantities unknown', () => {
    expect(getConfirmedFacilityCopyCount('载具仓库')).toBe(3);
    expect(getConfirmedFacilityCopyCount('异铁冶炼厂')).toBe(2);
    expect(getConfirmedFacilityCopyCount('物流枢纽')).toBe(2);
    expect(getConfirmedFacilityCopyCount('延伸枢纽')).toBe(3);
    expect(getConfirmedFacilityCopyCount('constructor')).toBeNull(); expect(getConfirmedFacilityCopyCount('toString')).toBeNull();
  });
});


it('records core command tower rainbow identity and four physical copies without a cell-count field', () => {
  expect(FOUNDERS_FACILITY_COLOR_CONFIRMATIONS).toEqual([{ facilityId: 'FAC-CORE-COMMAND-TOWER', facilityName: '核心指挥塔', color: 'rainbow', sourceRef: 'user-2026-10-22-core-command-tower-color' }]);
  expect(getConfirmedFacilityCopyCount('核心指挥塔')).toBe(4);
  expect(FOUNDERS_FACILITY_COLOR_COUNTS.facilities).toHaveLength(20);
  expect(Object.isFrozen(FOUNDERS_FACILITY_COLOR_CONFIRMATIONS[0])).toBe(true);
});


it('reconciles the 57 physical cards as base 48, enterprise 3 and Infected DLC 6', () => {
  const result = getFacilityInventoryReconciliation();
  expect(result.reported).toEqual({ base: 48, enterprise: 3, infected: 6, total: 57 });
  expect(result.baseBreakdown).toEqual({ ordinary: 41, coreCommandTower: 4, extensionHub: 3 });
  expect(result.rules).toEqual({ base: 48, enterpriseAddition: 3 });
  expect(result.countsByColor).toEqual({ red: 13, blue: 13, yellow: 13, rainbow: 18 });
  expect(result.status).toBe('counts-reconciled'); expect(result.totalsReconciled).toBe(true);
  expect(result.readyForDeckSetup).toBe(false); expect(Object.isFrozen(result.reported)).toBe(true);
});
it('identifies E enterprise offices and O Infected DLC facilities from the supplied clarification', () => {
  expect(FOUNDERS_FACILITY_EDITION_EVIDENCE.find(row => row.facilityId === 'FAC-020')).toMatchObject({ marker: 'E', classification: 'enterprise' });
  expect(FOUNDERS_FACILITY_EDITION_EVIDENCE.filter(row => row.classification === 'infected').map(row => row.facilityId)).toEqual(['FAC-017', 'FAC-019']);
  expect(FOUNDERS_FACILITY_COLOR_COUNTS.scope).toBe('mixed-edition-inventory-report');
});
it('defaults to base quantities and excludes both expansions while retaining the mixed source report', () => {
  const records = getFacilityCopyCountRecords();
  expect(records.map(row => row.name)).not.toEqual(expect.arrayContaining(['企业办事处', '临时聚居点', '罗德岛办事处']));
  for (const name of ['企业办事处', '临时聚居点', '罗德岛办事处']) expect(records.some(row => row.name === name)).toBe(false);
  expect(records).toHaveLength(18);
  expect(records.reduce((total, row) => total + Object.values(row.copyCountsByColor).reduce((a, b) => a + b, 0), 0)).toBe(48);
  expect(getFacilityCopyCountRecords('enterprise').map(row => row.name)).toEqual(['企业办事处']);
  expect(getFacilityCopyCountRecords('infected').map(row => row.name)).toEqual(['临时聚居点', '罗德岛办事处']);
  expect(FOUNDERS_FACILITY_COLOR_COUNTS.facilities).toHaveLength(20);
  expect(Object.isFrozen(records)).toBe(true); expect(() => getFacilityCopyCountRecords('other' as 'base')).toThrow(RangeError);
});
it('rejects the retired cell-count interpretation instead of silently loading it as quantities', () => {
  const old = copy();
  const { copyCountsByColor, ...record } = old.facilities[0]!;
  expect(validateFoundersFacilityColorCounts({ ...old, schemaVersion: '1.0.0', facilities: [{ ...record, colorCellCounts: copyCountsByColor }, ...old.facilities.slice(1)] }).success).toBe(false);
});
