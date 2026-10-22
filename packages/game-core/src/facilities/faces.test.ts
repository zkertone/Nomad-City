import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FOUNDERS_FACILITY_FACES, FOUNDERS_FACILITY_FACES_HASH, getFoundersFacilityFace,
  getFacilityCopyCountRecords, getFacilityFaceTranscriptionProgress, facilityFacesCatalogSchema,
  getFacilityIconMeaning, getFacilityEffectText,
  validateFoundersFacilityFaces, parseFoundersFacilityFaces, computeFacilityFacesHash, canonicalFacilityFacesContent,
} from './index.js';

// Exact user-supplied text; tests only. Do not normalize punctuation or replace user wording.
const userFacilityFlavorTexts = {
  "载具仓库": "从矿区回收的探索车辆正在进行细致的清洗，等待它的下一任主人。",
  "护航调度中心": "“虽不及高多汀开拓军的前人来的谨慎，但这些新人拓荒者们勇气尚可。”",
  "佣兵指挥部": "“放心，把活儿交给专业的人。”",
  "物流枢纽": "“本城的第一座物流港，愿其能为我们开辟一条......”",
  "城市化区域": "“哥伦比亚重视开拓与研究，当然也重视在其背后支持的贸易系统。”",
  "贸易街区": "“在这不一定能寻到最好的价格，但一定可以解你燃眉之急。”",
  "高性能动力系统": "下层动力区关乎所有人的存亡，有必要对其进行翻修和改良。",
  "开采电铲": "当开采平台发展为移动城市，会有人想起它简陋的过往吗？",
  "城邦工业区": "移动城市的优势既非武力，也非经济，而是可以躲避天灾的生产力。",
  "异铁冶炼厂": "少有人造物可以像异铁块一样，承受着这片大地的苦难而不变质。",
  "源石精炼厂": "现在，移动城市有了跳动的心脏。",
  "固源岩提纯厂": "假若精炼源石是移动城市不断流动的血液，那提纯源岩便是坚实的肌肉。",
  "城邦行政区": "行政体系的建立能够解决各种问题，特别是在这片正待开垦的荒原之上。",
  "附属能源设施": "通过源源不断的能源供应，移动城市上的设施日以继夜地运作着，一刻不停。",
  "联邦理事处": "尽管拓荒队之间各自为政，但依旧在一些方面受制于哥伦比亚当局。",
  "简陋工程营": "“我们提供高规格的防护，有效的抑制剂，并维护工人的个人利益。”",
  "延伸枢纽": "......源石与工业之路。",
  "核心指挥塔": "启航的第一盏信号灯在塔顶点亮。"
} as const;
const userFacilityEffectTexts = {
  "联邦理事处": "本回合收尾阶段传递起始玩家标记时，由你获得该标记。（只有本回合最后被建设的联邦理事处效果会生效）",
  "核心指挥塔": "设置玩家面板时，放置在设施面板的初始位置上。"
} as const;

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
    expect(core.constructionCost.kind).toBe('not-printed'); expect(core.effect.transcription.status).toBe('transcribed');
    expect(getFoundersFacilityFace('FAC-018').effect.transcription).toMatchObject({ status: 'transcribed', segments: [{ kind: 'text', text: '延伸枢纽只能通过物流枢纽的效果建造。' }] });
  });
  it('preserves the two identical cube symbols and the choice operator instead of guessing executable effects', () => {
    expect(getFoundersFacilityFace('FAC-002').effect).toMatchObject({ entryMarker: true, uniqueMarker: false,
      transcription: { status: 'transcribed', segments: [{ kind: 'icon', icon: 'green-down-cube' }, { kind: 'icon', icon: 'green-down-cube' }] } });
    expect(getFoundersFacilityFace('FAC-003').effect.transcription).toMatchObject({ status: 'transcribed', segments: [
      { kind: 'icon', icon: 'red-green-up-down-cube' }, { kind: 'text', text: ' 或 ' }, { kind: 'icon', icon: 'green-down-cube' },
    ] });
  });
  it('retains a unique-only face and a crane-only entry effect', () => {
    expect(getFoundersFacilityFace('FAC-013').effect).toMatchObject({ entryMarker: false, uniqueMarker: true, transcription: { status: 'transcribed', segments: [] } });
    expect(getFoundersFacilityFace('FAC-016').effect).toMatchObject({ entryMarker: true, uniqueMarker: true, transcription: { status: 'transcribed', segments: [{ kind: 'icon', icon: 'construction-crane' }] } });
  });
  it('retains aggregate extraction, movement text and cardinal-adjacency conditions', () => {
    expect(JSON.stringify(getFoundersFacilityFace('FAC-008').effect)).toContain('获得合计5个');
    expect(JSON.stringify(getFoundersFacilityFace('FAC-007').effect)).toContain('通过的航道');
    expect(JSON.stringify(getFoundersFacilityFace('FAC-014').effect)).toContain('十字相邻的非彩色');
    expect(getFoundersFacilityFace('FAC-009').effect.entryMarker).toBe(false);
  });
  it('reports complete supplied texts while keeping execution readiness false', () => {
    expect(getFoundersFacilityFace('FAC-011').flavor).toMatchObject({ status: 'transcribed', text: '现在，移动城市有了跳动的心脏。' });
    expect(getFoundersFacilityFace('FAC-015').effect.transcription.status).toBe('transcribed');
    expect(getFacilityFaceTranscriptionProgress()).toEqual({ totalPicturedFaces: 18, printedScores: 18, printedCostAlternatives: 16, costNotPrinted: 2,
      effects: { transcribed: 18, partial: 0, unreadable: 0 }, flavor: { transcribed: 18, partial: 0, unreadable: 0 },
      executionReady: false, reviewStatus: 'mixed-source-transcription' });
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
    const changed = copy(); changed.sources.reverse(); changed.facilities.reverse(); changed.textSources.reverse(); changed.iconLegend.reverse();
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
    if (field === 'flavor') row.flavor = { status: 'transcribed', text: '替换的文字', sourceRef: 'user-2026-10-22-facility-flavor-fulltext', verificationStatus: 'user-provided' };
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
    expect(facilityFacesCatalogSchema.safeParse({ ...copy(), schemaVersion: '1.0.0' }).success).toBe(false);
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
    for (const flavor of [null, '', { status: 'transcribed', text: ' ', sourceRef: 'user-2026-10-22-facility-flavor-fulltext', verificationStatus: 'user-provided' }, { status: 'partial', fragments: [], reason: '不清楚' }]) {
      const bad = copy(); Object.assign(bad.facilities[0]!, { flavor }); expect(facilityFacesCatalogSchema.safeParse(bad).success).toBe(false);
    }
    const empty = copy(); empty.facilities[0]!.effect.transcription = { status: 'transcribed', segments: [], sourceRef: 'facility-image-1', verificationStatus: 'image-transcribed' };
    expect(facilityFacesCatalogSchema.safeParse(empty).success).toBe(false);
    const icon = copy(); Object.assign(icon.facilities[0]!.effect, { transcription: { status: 'transcribed', segments: [{ kind: 'icon', icon: 'free-build' }], sourceRef: 'facility-image-1', verificationStatus: 'image-transcribed' } });
    expect(facilityFacesCatalogSchema.safeParse(icon).success).toBe(false);
    expect(facilityFacesCatalogSchema.safeParse({ ...copy(), executionReady: true }).success).toBe(false);
    expect(facilityFacesCatalogSchema.safeParse({ ...copy(), reviewStatus: 'user-confirmed' }).success).toBe(false);
    expect(facilityFacesCatalogSchema.safeParse({ ...copy(), executor: 'build' }).success).toBe(false);
  });
});

describe('user-supplied exact text and semantic icon recognition', () => {
  it.each(Object.entries(userFacilityFlavorTexts))('preserves the entire supplied flavor for %s', (name, text) => {
    const row = FOUNDERS_FACILITY_FACES.facilities.find(face => face.name === name)!;
    expect(row.flavor).toEqual({ status: 'transcribed', text,
      sourceRef: 'user-2026-10-22-facility-flavor-fulltext', verificationStatus: 'user-provided' });
  });
  it.each(Object.entries(userFacilityEffectTexts))('preserves the full supplied instruction for %s', (name, text) => {
    const row = FOUNDERS_FACILITY_FACES.facilities.find(face => face.name === name)!;
    expect(row.effect.transcription).toEqual({ status: 'transcribed', segments: [{ kind: 'text', text }],
      sourceRef: 'user-2026-10-22-facility-effect-fulltext', verificationStatus: 'user-provided' });
  });
  it.each([
    ['red-up-cube', 'place-influence', '放置1个影响力'],
    ['blue-right-cube', 'move-influence', '移动1个影响力'],
    ['green-down-cube', 'remove-influence', '移除1个影响力'],
    ['red-green-up-down-cube', 'replace-influence', '替换1个影响力'],
    ['city-right-arrow', 'city-move', '城市移动'],
    ['construction-crane', 'construct', '建设'],
    ['orirock', 'resource-orirock', '源岩'],
    ['originium', 'resource-originium', '源石'],
    ['iron', 'resource-iron', '异铁'],
    ['pure-originium', 'resource-pure-originium', '至纯源石'],
    ['voucher', 'currency-voucher', '哥伦比亚金券'],
  ])('recognizes %s using rule terms', (icon, meaning, label) => {
    const result = getFacilityIconMeaning(icon!);
    expect(result).toMatchObject({ icon, meaning, label });
    expect(result.sourcePages.length).toBeGreaterThan(0); expect(Object.isFrozen(result)).toBe(true);
  });
  it('corrects the previously missed green arrow in the mercenary replacement symbol', () => {
    expect(getFacilityEffectText('FAC-003')).toBe('入场；〔替换1个影响力〕 或 〔移除1个影响力〕');
    expect(getFacilityEffectText('FAC-003')).not.toContain('放置1个影响力');
  });
  it('renders a single influence move rather than granting an entire two-move dispatch action', () => {
    expect(getFacilityEffectText('FAC-001')).toBe('入场；〔放置1个影响力〕、〔移动1个影响力〕 或 进行1次 探索。');
    expect(getFacilityEffectText('FAC-001')).not.toContain('调度');
  });
  it('retains both removals, the construction effect, the city move and the free qualifier', () => {
    expect(getFacilityEffectText('FAC-002')).toBe('入场；〔移除1个影响力〕〔移除1个影响力〕');
    expect(getFacilityEffectText('FAC-016')).toBe('入场；唯一；〔建设〕');
    expect(getFacilityEffectText('FAC-016')).not.toContain('免费');
    expect(getFacilityEffectText('FAC-007')).toBe('入场；免费〔城市移动〕，并在通过的航道上放置1个影响力。');
  });
  it('keeps the full federation last-built limitation and the exact initial tower instruction', () => {
    expect(getFacilityEffectText('FAC-015')).toBe(`入场；唯一；${userFacilityEffectTexts['联邦理事处']}`);
    expect(getFacilityEffectText('FAC-CORE-COMMAND-TOWER')).toBe(userFacilityEffectTexts['核心指挥塔']);
    expect(getFacilityEffectText('FAC-013')).toBe('唯一');
  });
  it('does not normalize supplied ellipses, quotation marks, names or grammatical wording', () => {
    expect(getFoundersFacilityFace('FAC-018').flavor).toMatchObject({ text: '......源石与工业之路。' });
    expect(getFoundersFacilityFace('FAC-002').flavor).toMatchObject({ text: '“虽不及高多汀开拓军的前人来的谨慎，但这些新人拓荒者们勇气尚可。”' });
    expect(FOUNDERS_FACILITY_FACES.reviewStatus).toBe('mixed-source-transcription');
    expect(FOUNDERS_FACILITY_FACES.executionReady).toBe(false);
    expect(getFoundersFacilityFace('FAC-001').effect.transcription).toMatchObject({ verificationStatus: 'image-transcribed' });
  });
  it.each(['constructor', '__proto__', 'toString', 'dispatch', 'free-build'])('rejects unrecognized symbol %s', icon => {
    expect(() => getFacilityIconMeaning(icon)).toThrow(RangeError);
  });
  it('requires complete, unique icon definitions and properly typed per-field evidence', () => {
    const legend = copy(); legend.iconLegend[0]!.icon = legend.iconLegend[1]!.icon;
    expect(facilityFacesCatalogSchema.safeParse(legend).success).toBe(false);
    const missing = copy(); missing.iconLegend.pop(); expect(facilityFacesCatalogSchema.safeParse(missing).success).toBe(false);
    const bad = copy(); bad.facilities[0]!.flavor = { status: 'transcribed', text: '测试', sourceRef: 'facility-image-1', verificationStatus: 'user-provided' };
    expect(facilityFacesCatalogSchema.safeParse(bad).success).toBe(false);
    const unknown = copy(); unknown.facilities[0]!.flavor = { status: 'transcribed', text: '测试', sourceRef: 'missing', verificationStatus: 'user-provided' };
    expect(facilityFacesCatalogSchema.safeParse(unknown).success).toBe(false);
    const userSources = copy(); userSources.textSources[1]!.id = userSources.textSources[0]!.id;
    expect(facilityFacesCatalogSchema.safeParse(userSources).success).toBe(false);
    const ambiguous = copy(); ambiguous.textSources[0]!.id = ambiguous.sources[0]!.id;
    expect(facilityFacesCatalogSchema.safeParse(ambiguous).success).toBe(false);
  });
  it.each(['meaning', 'rule-source', 'user-source', 'provenance', 'punctuation', 'rule-page'] as const)('hashes and pins changed %s', field => {
    const data = copy();
    if (field === 'meaning') data.iconLegend[0]!.meaning = 'remove-influence';
    if (field === 'rule-source') data.rulesSource.sha256 = '0'.repeat(64);
    if (field === 'user-source') data.textSources[0]!.description += '变更';
    if (field === 'provenance') {
      const flavor = data.facilities[0]!.flavor;
      if (flavor.status === 'transcribed') { flavor.sourceRef = 'facility-image-1'; flavor.verificationStatus = 'image-transcribed'; }
    }
    if (field === 'punctuation') {
      const flavor = data.facilities.find(face => face.id === 'FAC-018')!.flavor;
      if (flavor.status === 'transcribed') flavor.text = flavor.text.replace('......', '……');
    }
    if (field === 'rule-page') data.iconLegend[0]!.sourcePages[0] = 1;
    data.contentHash = computeFacilityFacesHash(data);
    expect(data.contentHash).not.toBe(FOUNDERS_FACILITY_FACES_HASH);
    expect(facilityFacesCatalogSchema.safeParse(data).success).toBe(true);
    expect(validateFoundersFacilityFaces(data).success).toBe(false);
  });
});
