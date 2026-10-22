import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FOUNDERS_FACILITY_FACES, FOUNDERS_FACILITY_FACES_HASH, getFoundersFacilityFace,
  getFacilityCopyCountRecords, getFacilityFaceTranscriptionProgress, facilityFacesCatalogSchema,
  validateFoundersFacilityFaces, parseFoundersFacilityFaces, computeFacilityFacesHash, canonicalFacilityFacesContent,
} from './index.js';

const copy = () => facilityFacesCatalogSchema.parse(FOUNDERS_FACILITY_FACES);
// Independent visual transcription: [ID, name, pictured color, printed score, resource payment R/O/I/P/V, voucher alternative].
// Quantities are costs, never inferred from the user's physical-copy counts.
const pictured = [
  ['FAC-001', '载具仓库', 'red', 0, [1, 2, 0, 0, 0], 9],
  ['FAC-002', '护航调度中心', 'red', 0, [2, 2, 2, 0, 0], 18],
  ['FAC-003', '佣兵指挥部', 'red', 1, [2, 0, 2, 0, 4], 18],
  ['FAC-004', '物流枢纽', 'blue', 2, [0, 0, 0, 1, 2], 24],
  ['FAC-005', '城市化区域', 'blue', 1, [3, 0, 2, 0, 0], 16],
  ['FAC-006', '贸易街区', 'blue', 0, [1, 0, 1, 0, 0], 6],
  ['FAC-007', '高性能动力系统', 'yellow', 0, [0, 4, 2, 0, 0], 20],
  ['FAC-008', '开采电铲', 'yellow', 0, [0, 2, 1, 0, 0], 10],
  ['FAC-009', '城邦工业区', 'yellow', 2, [4, 3, 0, 0, 2], 24],
  ['FAC-010', '异铁冶炼厂', 'red', 1, [2, 2, 1, 0, 0], 15],
  ['FAC-011', '源石精炼厂', 'blue', 0, [1, 1, 1, 0, 0], 10],
  ['FAC-012', '固源岩提纯厂', 'yellow', 0, [1, 1, 1, 0, 0], 10],
  ['FAC-013', '城邦行政区', 'rainbow', 3, [3, 3, 3, 0, 0], 30],
  ['FAC-014', '附属能源设施', 'rainbow', 1, [2, 2, 3, 0, 0], 23],
  ['FAC-015', '联邦理事处', 'rainbow', 0, [4, 2, 0, 0, 0], 17],
  ['FAC-016', '简陋工程营', 'rainbow', -1, [2, 1, 0, 0, 0], 8],
  ['FAC-018', '延伸枢纽', 'yellow', -1, null, null],
  ['FAC-CORE-COMMAND-TOWER', '核心指挥塔', 'rainbow', 0, null, null],
] as const;

describe('pictured base facility faces, separate from physical inventory', () => {
  it.each(pictured)('preserves the source values for %s %s', (id, name, color, score, amounts, vouchers) => {
    const face = getFoundersFacilityFace(id);
    expect([face.name, face.observedColor, face.printedScore]).toEqual([name, color, score]);
    expect(face.appliesTo).toBe('pictured-face-only');
    if (!amounts) expect(face.constructionCost).toEqual({ kind: 'not-printed' });
    else expect(face.constructionCost).toEqual({ kind: 'printed-alternatives', resourcePayment: {
      orirock: amounts[0], originium: amounts[1], iron: amounts[2], pureOriginium: amounts[3], vouchers: amounts[4],
    }, voucherPayment: vouchers });
  });
  it('matches exactly the 18 base identities, excluding all enterprise and Infected cards', () => {
    expect(FOUNDERS_FACILITY_FACES.facilities.map(row => row.id).sort()).toEqual(getFacilityCopyCountRecords().map(row => row.id).sort());
    for (const id of ['FAC-017', 'FAC-019', 'FAC-020']) expect(() => getFoundersFacilityFace(id)).toThrow(RangeError);
  });
  it('keeps compound resource-plus-voucher payments as alternatives to the voucher-only price', () => {
    const logistics = getFoundersFacilityFace('FAC-004').constructionCost;
    expect(logistics).toEqual({ kind: 'printed-alternatives', resourcePayment: { orirock: 0, originium: 0, iron: 0, pureOriginium: 1, vouchers: 2 }, voucherPayment: 24 });
    expect(getFacilityCopyCountRecords().find(row => row.id === 'FAC-004')!.copyCountsByColor.blue).toBe(2);
  });
  it('does not turn missing printed costs or unreadable instructions into free construction/empty effects', () => {
    const core = getFoundersFacilityFace('FAC-CORE-COMMAND-TOWER');
    expect(core.constructionCost.kind).toBe('not-printed'); expect(core.effect.transcription.status).toBe('partial');
    expect(getFoundersFacilityFace('FAC-018').effect.transcription).toEqual({ status: 'transcribed', segments: [{ kind: 'text', text: '延伸枢纽只能通过物流枢纽的效果建造。' }] });
  });
  it('preserves the two identical cube symbols and the choice operator instead of guessing executable effects', () => {
    expect(getFoundersFacilityFace('FAC-002').effect).toEqual({ entryMarker: true, uniqueMarker: false,
      transcription: { status: 'transcribed', segments: [{ kind: 'icon', icon: 'green-down-cube' }, { kind: 'icon', icon: 'green-down-cube' }] } });
    expect(getFoundersFacilityFace('FAC-003').effect.transcription).toEqual({ status: 'transcribed', segments: [
      { kind: 'icon', icon: 'red-up-cube' }, { kind: 'text', text: ' 或 ' }, { kind: 'icon', icon: 'green-down-cube' },
    ] });
  });
  it('retains a unique-only face and a crane-only entry effect', () => {
    expect(getFoundersFacilityFace('FAC-013').effect).toEqual({ entryMarker: false, uniqueMarker: true, transcription: { status: 'transcribed', segments: [] } });
    expect(getFoundersFacilityFace('FAC-016').effect).toEqual({ entryMarker: true, uniqueMarker: true, transcription: { status: 'transcribed', segments: [{ kind: 'icon', icon: 'construction-crane' }] } });
  });
  it('retains aggregate extraction, movement text and cardinal-adjacency conditions', () => {
    expect(JSON.stringify(getFoundersFacilityFace('FAC-008').effect)).toContain('获得合计5个');
    expect(JSON.stringify(getFoundersFacilityFace('FAC-007').effect)).toContain('通过的航道');
    expect(JSON.stringify(getFoundersFacilityFace('FAC-014').effect)).toContain('十字相邻的非彩色');
    expect(getFoundersFacilityFace('FAC-009').effect.entryMarker).toBe(false);
  });
  it('reports partial flavor and federation fine print honestly, without marking the catalog executable', () => {
    expect(getFoundersFacilityFace('FAC-011').flavor).toEqual({ status: 'transcribed', text: '现在，移动城市有了跳动的心脏。' });
    expect(getFoundersFacilityFace('FAC-015').effect.transcription.status).toBe('partial');
    expect(getFacilityFaceTranscriptionProgress()).toEqual({ totalPicturedFaces: 18, printedScores: 18, printedCostAlternatives: 16, costNotPrinted: 2,
      effects: { transcribed: 16, partial: 2, unreadable: 0 }, flavor: { transcribed: 1, partial: 4, unreadable: 13 },
      executionReady: false, reviewStatus: 'ai-transcribed-awaiting-review' });
  });
  it('deep freezes both known and partial source data', () => {
    const face = getFoundersFacilityFace('FAC-011');
    expect(Object.isFrozen(face.flavor)).toBe(true); expect(Object.isFrozen(FOUNDERS_FACILITY_FACES.sources[0])).toBe(true);
    expect(() => { (face as { printedScore: number }).printedScore = 99; }).toThrow(TypeError);
    expect(Object.isFrozen(getFacilityFaceTranscriptionProgress().effects)).toBe(true);
  });
  it.each(['constructor', '__proto__', 'toString', 'FAC-000'])('rejects unknown ID %s', id => {
    expect(() => getFoundersFacilityFace(id)).toThrow(RangeError);
  });
});

describe('strict transcription validation and source-aware digest', () => {
  it('loads and parses an independently pinned JSON round trip', () => {
    expect(validateFoundersFacilityFaces(JSON.parse(JSON.stringify(FOUNDERS_FACILITY_FACES))).success).toBe(true);
    expect(parseFoundersFacilityFaces(copy())).toEqual(FOUNDERS_FACILITY_FACES);
    expect(computeFacilityFacesHash(copy())).toBe(FOUNDERS_FACILITY_FACES_HASH);
    const digest = createHash('sha256').update(canonicalFacilityFacesContent(copy()), 'utf8').digest('hex');
    expect(`sha256:${digest}`).toBe(FOUNDERS_FACILITY_FACES_HASH);
  });
  it('normalizes source/facility and object-key ordering, while retaining every other array order and all Unicode', () => {
    const changed = copy(); changed.sources.reverse(); changed.facilities.reverse();
    expect(computeFacilityFacesHash(changed)).toBe(FOUNDERS_FACILITY_FACES_HASH);
    // Reordering the top level alone must also retain canonical content.
    expect(computeFacilityFacesHash({ ...copy(), ...Object.fromEntries(Object.entries(copy()).reverse()) })).toBe(FOUNDERS_FACILITY_FACES_HASH);
    const a = copy(), b = copy(); a.facilities[0]!.name = 'é'; b.facilities[0]!.name = 'e\u0301';
    expect(computeFacilityFacesHash(a)).not.toBe(computeFacilityFacesHash(b));
  });
  it.each(['score', 'cost', 'source', 'flavor', 'effect', 'marker', 'scope'] as const)('rejects changed %s even with a recomputed claimed hash', field => {
    const changed = copy(); const row = changed.facilities[0]!;
    if (field === 'score') row.printedScore += 1;
    if (field === 'cost' && row.constructionCost.kind === 'printed-alternatives') row.constructionCost.resourcePayment.vouchers++;
    if (field === 'source') changed.sources[0]!.sha256 = 'a'.repeat(64);
    if (field === 'flavor') row.flavor = { status: 'transcribed', text: '替换的文字' };
    if (field === 'effect' && row.effect.transcription.status === 'transcribed') row.effect.transcription.segments.reverse();
    if (field === 'marker') row.effect.uniqueMarker = !row.effect.uniqueMarker;
    if (field === 'scope') row.appliesTo = 'all-color-variants' as typeof row.appliesTo;
    changed.contentHash = computeFacilityFacesHash(changed);
    expect(validateFoundersFacilityFaces(changed).success).toBe(false);
    expect(() => parseFoundersFacilityFaces(changed)).toThrow('Invalid facility faces');
  });
  it('rejects bad claims, wrong versions, missing rows and unknown sources', () => {
    const changed = copy(); changed.contentHash = `sha256:${'0'.repeat(64)}`;
    expect(validateFoundersFacilityFaces(changed).success).toBe(false);
    expect(facilityFacesCatalogSchema.safeParse({ ...copy(), schemaVersion: '2.0.0' }).success).toBe(false);
    changed.facilities.pop(); expect(facilityFacesCatalogSchema.safeParse(changed).success).toBe(false);
    const bad = copy(); bad.facilities[0]!.sourceRef = 'missing'; expect(facilityFacesCatalogSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects duplicate IDs/names and invalid base identities/colors independently of the digest', () => {
    const changed = copy(); changed.facilities[0]!.id = changed.facilities[1]!.id;
    expect(facilityFacesCatalogSchema.safeParse(changed).success).toBe(false);
    const names = copy(); names.facilities[0]!.name = names.facilities[1]!.name; expect(facilityFacesCatalogSchema.safeParse(names).success).toBe(false);
    const sources = copy(); sources.sources[1]!.id = sources.sources[0]!.id; expect(facilityFacesCatalogSchema.safeParse(sources).success).toBe(false);
    const foreign = copy(); foreign.facilities[0]!.id = 'FAC-020'; foreign.contentHash = computeFacilityFacesHash(foreign);
    expect(validateFoundersFacilityFaces(foreign)).toMatchObject({ success: false, issues: expect.arrayContaining(['Unknown base facility identity: FAC-020']) });
    const color = copy(); color.facilities[0]!.observedColor = 'rainbow'; color.contentHash = computeFacilityFacesHash(color);
    expect(validateFoundersFacilityFaces(color)).toMatchObject({ success: false, issues: expect.arrayContaining(['Unreported pictured color: FAC-001']) });
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid resource costs %s', amount => {
    const changed = copy(); const cost = changed.facilities[0]!.constructionCost;
    if (cost.kind === 'printed-alternatives') cost.resourcePayment.orirock = amount;
    expect(facilityFacesCatalogSchema.safeParse(changed).success).toBe(false);
  });
  it('rejects empty costs, zero vouchers, empty/omitted text, invented icons and executable readiness', () => {
    const changed = copy(); const cost = changed.facilities[0]!.constructionCost;
    if (cost.kind === 'printed-alternatives') {
      for (const key of Object.keys(cost.resourcePayment) as (keyof typeof cost.resourcePayment)[]) cost.resourcePayment[key] = 0;
      cost.voucherPayment = 0;
    }
    expect(facilityFacesCatalogSchema.safeParse(changed).success).toBe(false);
    for (const flavor of [null, '', { status: 'transcribed', text: ' ' }, { status: 'partial', fragments: [], reason: '不清楚' }]) {
      const bad = copy(); Object.assign(bad.facilities[0]!, { flavor }); expect(facilityFacesCatalogSchema.safeParse(bad).success).toBe(false);
    }
    const empty = copy(); empty.facilities[0]!.effect.transcription = { status: 'transcribed', segments: [] };
    expect(facilityFacesCatalogSchema.safeParse(empty).success).toBe(false);
    const icon = copy(); Object.assign(icon.facilities[0]!.effect, { transcription: { status: 'transcribed', segments: [{ kind: 'icon', icon: 'free-build' }] } });
    expect(facilityFacesCatalogSchema.safeParse(icon).success).toBe(false);
    expect(facilityFacesCatalogSchema.safeParse({ ...copy(), executionReady: true }).success).toBe(false);
    expect(facilityFacesCatalogSchema.safeParse({ ...copy(), reviewStatus: 'user-confirmed' }).success).toBe(false);
    expect(facilityFacesCatalogSchema.safeParse({ ...copy(), executor: 'build' }).success).toBe(false);
  });
});
