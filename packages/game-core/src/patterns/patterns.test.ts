import { describe, expect, it } from 'vitest';
import {
  CITY_PATTERNS, CITY_PATTERNS_HASH, computeCityPatternCatalogHash, validateCityPatternCatalog, getCityPattern,
  getEligibleCityPatterns, selectCityPatterns, getCityPatternSupport, cityPatternSchema,
  findCityPatternMatches, matchCityPatternSelection, cityPatternBoardSchema, getCityPatternRotations,
} from './index.js';
import type { CityPatternBoard } from './index.js';

// Independently read from upright card photos. V = red OR blue; U = blue OR yellow.
const sourceReadings = [
  ['PAT-001', '动员配套体系', 1, 3, ['YYR']],
  ['PAT-002', '物资中转站', 1, 2, ['VY']],
  ['PAT-003', '源石工业中枢', 2, 6, ['B--', 'RB-', 'YYR']],
  ['PAT-004', '复合动力系统', 1, 3, ['Y-', 'RY']],
  ['PAT-005', '军工化区域', 1, 2, ['UR']],
  ['PAT-006', '高效移动管理体系', 2, 7, ['Y--', 'RY-', 'BBR']],
  ['PAT-007', '大型企业园', 1, 3, ['B-', 'RB']],
  ['PAT-008', '核心商业区', 1, 3, ['BBR']],
  ['PAT-009', '警备队辖区', 2, 6, ['B--', 'RB-', 'YYR']],
  ['PAT-010', '拓荒指挥中枢', 2, 7, ['Y--', 'RY-', 'BBR']],
  ['PAT-011', '拓荒者据点', 1, 2, ['-Y', 'B-']],
  ['PAT-012', '城建开拓区', 1, 5, ['-Y-', 'BBR']],
  ['PAT-013', '新兴建筑群', 1, 4, ['-V-', 'YYR']],
  ['PAT-014', '城区管理中心', 1, 3, ['B-', 'YR']],
  ['PAT-015', '综合企业办公区', 2, 6, ['Y--', 'RY-', 'BBR']],
] as const;
type Color = CityPatternBoard['placements'][number]['color'];
const colors: Record<string, Color> = { R: 'red', B: 'blue', Y: 'yellow', V: 'red', U: 'blue', W: 'rainbow' };
function rawBoard(rows: readonly string[], turns = 0, top = 0, left = 0): CityPatternBoard {
  let grid = rows.map(line => [...line]);
  for (let i = 0; i < turns; i++) grid = Array.from({ length: grid[0]!.length }, (_, c) => Array.from({ length: grid.length }, (_, r) => grid[grid.length - 1 - r]![c]!));
  return { placements: grid.flatMap((line, r) => line.flatMap((token, c) => token === '-' ? [] : [{ cardId: `test:${r}:${c}`, cellId: `CP-${r + top + 1}-${c + left + 1}`, color: colors[token]!, exhausted: false }])) };
}
const clone = () => JSON.parse(JSON.stringify(CITY_PATTERNS)) as Record<string, unknown>;

describe('fifteen source-backed city pattern transcriptions', () => {
  it.each(sourceReadings)('%s has its independently read name, score, level and exact colour cells', (id, name, level, score, rows) => {
    const pattern = getCityPattern(id);
    expect([pattern.name, pattern.level, pattern.printedScore]).toEqual([name, level, score]);
    const expected = rows.flatMap((line, row) => [...line].flatMap((token, column) => token === '-' ? [] : [{ row, column,
      colors: token === 'V' ? ['red', 'blue'] : token === 'U' ? ['blue', 'yellow'] : [colors[token]] }]));
    expect(pattern.cells).toEqual(expected); expect(pattern.flavor.text.length).toBeGreaterThan(10);
  });
  it('pins the complete evidence, raw user flavor and original submitted typo separately from the printed name', () => {
    expect(validateCityPatternCatalog(CITY_PATTERNS).success).toBe(true); expect(computeCityPatternCatalogHash(CITY_PATTERNS)).toBe(CITY_PATTERNS_HASH);
    expect(CITY_PATTERNS.sources.map(source => source.libraryFileId)).toEqual(['libfile_a850c9c4e2848191894486126f36ad2d', 'libfile_8f8bd6c680ac8191a1f91866e46135b3', 'libfile_f0aa301d6e348191a1e0355d6677235a']);
    expect(getCityPattern('PAT-004').flavor).toMatchObject({ submittedName: '符合动力系统', text: '“新的巡航周期已经开始！小心手里的热咖啡。”' });
    expect(getCityPattern('PAT-012').flavor.text).toBe('管理条例第3章第9条附注2：工作人员有义务参与行政长官发起的工程活动。');
    expect(Object.isFrozen(CITY_PATTERNS.patterns[0]!.flavor)).toBe(true);
  });
  it.each(['printedScore', 'cells', 'flavor', 'sourceRef', 'minimumGameplayVersion'])('rejects changed %s even with a recomputed self hash', field => {
    const value = clone() as { patterns: Record<string, unknown>[]; contentHash: string };
    const pattern = value.patterns[0]!;
    if (field === 'printedScore') pattern[field] = 4;
    if (field === 'cells') pattern[field] = [{ row: 0, column: 0, colors: ['red'] }, { row: 0, column: 1, colors: ['red'] }];
    if (field === 'flavor') (pattern.flavor as { text: string }).text += '。';
    if (field === 'sourceRef') pattern[field] = 'pattern-image-7';
    if (field === 'minimumGameplayVersion') pattern[field] = 'enterprise';
    value.contentHash = computeCityPatternCatalogHash(value as unknown as typeof CITY_PATTERNS);
    expect(validateCityPatternCatalog(value).success).toBe(false);
  });
  it.each(['duplicate-cell', 'duplicate-colour', 'rainbow-requirement', 'non-normalized', 'bad-capacity', 'invented-field'])('rejects invalid shape or effect metadata %s', problem => {
    const value = JSON.parse(JSON.stringify(getCityPattern('PAT-001')));
    if (problem === 'duplicate-cell') value.cells[1] = value.cells[0];
    if (problem === 'duplicate-colour') value.cells[0].colors = ['red', 'red'];
    if (problem === 'rainbow-requirement') value.cells[0].colors = ['rainbow'];
    if (problem === 'non-normalized') for (const cell of value.cells) cell.row++;
    if (problem === 'bad-capacity') value.useCapacity = 2;
    if (problem === 'invented-field') value.free = true;
    expect(cityPatternSchema.safeParse(value).success).toBe(false);
  });
  it('keeps replacement, material income and paid construction meanings distinct', () => {
    expect(getCityPattern('PAT-001').specialAction).toBe('replace-one');
    expect(getCityPattern('PAT-009').effectText).toContain('支付2源岩1异铁→替换1个影响力');
    expect(getCityPattern('PAT-009').effectText).toContain('获得2异铁'); expect(getCityPattern('PAT-009').minimumGameplayVersion).toBe('base');
    expect(getCityPattern('PAT-013').declarationEffect).toBe('construction'); expect(getCityPattern('PAT-013').effectText).not.toContain('免费');
  });
});

describe('three inherited gameplay profiles, independent of printed E/O provenance and player count', () => {
  for (const count of [2, 3, 4]) it.each(['base', 'enterprise', 'entrepreneur'] as const)(`${count}p / %s eligibility and trusted setup`, version => {
    const eligible = getEligibleCityPatterns(version, count), ids = eligible.map(pattern => pattern.id);
    expect(ids).toHaveLength(version === 'base' ? 13 : 15);
    expect(ids.includes('PAT-007')).toBe(version !== 'base'); expect(ids.includes('PAT-015')).toBe(version !== 'base');
    expect(ids).toContain('PAT-009'); expect(ids).toContain('PAT-012'); expect(ids).toContain('PAT-013');
    const selected = selectCityPatterns(version, count, ids); expect(selected).toHaveLength(6); expect(new Set(selected).size).toBe(6);
    expect(selected.filter(id => getCityPattern(id).level === 1)).toHaveLength(4); expect(selected.filter(id => getCityPattern(id).level === 2)).toHaveLength(2);
    expect(selectCityPatterns(version, count)).toHaveLength(6); expect(Object.isFrozen(selected)).toBe(true);
  });
  it.each([0, 1, 5, 2.5])('rejects unsupported player count %s', count => { expect(() => selectCityPatterns('base', count)).toThrow(); });
  it('rejects missing, duplicate or high-version setup entries and malformed version names', () => {
    const ids = getEligibleCityPatterns('base', 3).map(pattern => pattern.id);
    expect(() => selectCityPatterns('base', 3, ids.slice(1))).toThrow();
    expect(() => selectCityPatterns('base', 3, ids.map((id, i) => i === 1 ? ids[0]! : id))).toThrow();
    expect(() => selectCityPatterns('base', 3, ids.map((id, i) => i === 0 ? 'PAT-007' : id))).toThrow();
    expect(() => selectCityPatterns('infected' as 'base', 3)).toThrow();
    expect(getCityPatternSupport()).toMatchObject({ transcribedPatterns: 15, flavors: 15, authoritativeDeclarationsImplemented: false, specialActionsImplemented: false });
  });
});

describe('rotation, alternative colour, rainbow and facility exhaustion matching', () => {
  for (const turn of [0, 1, 2, 3]) it.each(sourceReadings)(`rotation ${turn * 90}: %s matches without changing the board`, (id, _name, _level, _score, rows) => {
    const board = rawBoard(rows, turn), before = JSON.stringify(board), matches = findCityPatternMatches(board, id);
    expect(matches.length).toBeGreaterThan(0); expect(matches[0]!.facilityCardIds).toHaveLength(getCityPattern(id).cells.length);
    expect(matchCityPatternSelection(board, id, matches[0]!.facilityCardIds)?.facilityCardIds).toEqual(matches[0]!.facilityCardIds);
    expect(Object.isFrozen(matches[0]!.assignments)).toBe(true); expect(JSON.stringify(board)).toBe(before);
  });
  it.each(sourceReadings)('%s cannot match if one required facility is already exhausted', (id, _name, _level, _score, rows) => {
    const board = rawBoard(rows), input = { placements: board.placements.map((row, index) => ({ ...row, exhausted: index === 0 })) };
    expect(findCityPatternMatches(input, id)).toEqual([]);
  });
  it.each(['RY', 'BY', 'WY'])('red-or-blue requirement accepts %s', row => { expect(findCityPatternMatches(rawBoard([row]), 'PAT-002')).toHaveLength(1); });
  it.each(['BR', 'YR', 'WR'])('blue-or-yellow requirement accepts %s', row => { expect(findCityPatternMatches(rawBoard([row]), 'PAT-005')).toHaveLength(1); });
  it('rejects colors outside alternatives and rejects one facility pretending to fill two positions', () => {
    expect(findCityPatternMatches(rawBoard(['YY']), 'PAT-002')).toEqual([]); expect(findCityPatternMatches(rawBoard(['RR']), 'PAT-005')).toEqual([]);
    const single = rawBoard(['W']); expect(findCityPatternMatches(single, 'PAT-002')).toEqual([]);
    expect(matchCityPatternSelection(rawBoard(['RY']), 'PAT-002', ['test:0:0', 'test:0:0'])).toBeNull();
  });
  it('uses one rainbow facility for exactly one required cell', () => {
    const board = rawBoard(['WWR']); expect(findCityPatternMatches(board, 'PAT-001')).toHaveLength(1);
    expect(matchCityPatternSelection(board, 'PAT-001', board.placements.map(row => row.cardId).reverse())).not.toBeNull();
    expect(matchCityPatternSelection(board, 'PAT-001', board.placements.slice(1).map(row => row.cardId))).toBeNull();
  });
  it('does not reflect an asymmetric colour layout', () => {
    expect(findCityPatternMatches(rawBoard(['--B', '-BR', 'RYY']), 'PAT-003')).toEqual([]);
  });
  it('supports disconnected diagonals and does not require unused background cells to be empty', () => {
    const sparse = rawBoard(['-Y', 'B-']); expect(findCityPatternMatches(sparse, 'PAT-011')).toHaveLength(1);
    expect(findCityPatternMatches(rawBoard(['RY', 'BR']), 'PAT-011')).toHaveLength(1);
  });
  it.each([[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]])('translates the diagonal to row=%s column=%s', (top, left) => { expect(findCityPatternMatches(rawBoard(['-Y', 'B-'], 0, top, left), 'PAT-011')).toHaveLength(1); });
  it('finds the bottom row and right-edge vertical layouts without wrapping rows', () => {
    expect(findCityPatternMatches(rawBoard(['YYR'], 0, 3, 0), 'PAT-001')).toHaveLength(1);
    expect(findCityPatternMatches(rawBoard(['YYR'], 1, 1, 2), 'PAT-001')).toHaveLength(1);
    const broken = rawBoard(['--Y', 'YR-']); expect(findCityPatternMatches(broken, 'PAT-001')).toEqual([]);
  });
  it('rejects repeated cards, repeated positions, invalid cells and invented colour', () => {
    const value = rawBoard(['YYR']); expect(cityPatternBoardSchema.safeParse({ placements: [value.placements[0], value.placements[0]] }).success).toBe(false);
    expect(() => findCityPatternMatches(rawBoard(['YYR'], 0, 4), 'PAT-001')).toThrow();
    expect(() => findCityPatternMatches({ placements: [{ ...value.placements[0]!, color: 'green' as 'red' }] }, 'PAT-001')).toThrow();
    expect(() => getCityPatternRotations('PAT-999')).toThrow();
  });
});
