import { describe, expect, it } from 'vitest';
import {
  FOUNDERS_FACILITY_STOCK, createFoundersFacilitySupply, createInitialFacilityPanels, facilitySupplyStateSchema,
  facilityPanelStateSchema, validateFacilityPanelSet,
} from '../facilities/index.js';
import { selectCityPatterns, previewCityPatternDeclaration, getCityPatternBoard } from './index.js';

function fixture(count = 3) {
  const ids = ['p1', 'p2', 'p3', 'p4'].slice(0, count), supply = facilitySupplyStateSchema.parse(createFoundersFacilitySupply({ gameId: 'pattern-preview', playerIds: ids,
    deckOrder: FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id) }));
  const panels = createInitialFacilityPanels(supply).map(panel => facilityPanelStateSchema.parse(panel));
  const selected: string[] = [];
  for (const [index, [facilityId, color]] of ([['FAC-009', 'yellow'], ['FAC-009', 'yellow'], ['FAC-001', 'red']] as const).entries()) {
    const cardId = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === facilityId && card.color === color && !selected.includes(card.id))!.id;
    for (const zone of [supply.supply, supply.drawPile]) { const at = zone.indexOf(cardId); if (at >= 0) zone.splice(at, 1); }
    selected.push(cardId); supply.playerHoldings[0]!.cardIds.push(cardId); panels[0]!.placements.push({ cardId, cellId: `CP-1-${index + 1}` });
  }
  while (supply.supply.length < 6) supply.supply.push(supply.drawPile.shift()!);
  supply.revision = 3; panels[0]!.revision = 3;
  const context = { gameId: 'pattern-preview', actorId: 'p1', gameplayVersion: 'base' as const, playerCount: count,
    expectedSupplyRevision: 3, expectedPanelRevision: 3, publicPatternIds: [...selectCityPatterns('base', count, ['PAT-001', 'PAT-002', 'PAT-003', 'PAT-004', 'PAT-005', 'PAT-006', 'PAT-008', 'PAT-009', 'PAT-010', 'PAT-011', 'PAT-012', 'PAT-013', 'PAT-014'])],
    exhaustedFacilityCardIds: [] as string[], availableMarkerCount: 29 };
  return { supply, panels, context, selected };
}

describe('trusted read-only city-pattern declaration preflight', () => {
  it.each([2, 3, 4])('cross-checks a real %i-player supply, ownership, panel and distinct physical cards', count => {
    const f = fixture(count), before = JSON.stringify(f), result = previewCityPatternDeclaration(f.panels[0], f.supply, f.context, 'PAT-001', f.selected);
    expect(validateFacilityPanelSet(f.panels, f.supply).success).toBe(true);
    expect(result).toMatchObject({ status: 'layout-eligible', printedScore: 3, specialAction: 'replace-one', useCapacity: 1, authoritativeActionGranted: false });
    expect(result.selectedMatch!.facilityCardIds).toEqual([...f.selected].sort()); expect(JSON.stringify(f)).toBe(before);
    expect(Object.isFrozen(result.matches)).toBe(true);
  });
  it('tracks used facilities by exact physical card and keeps rainbow core colour intact', () => {
    const f = fixture(), board = getCityPatternBoard(f.panels[0], f.supply, [f.selected[0]!]);
    expect(board.placements.find(row => row.cardId === f.selected[0])!.exhausted).toBe(true);
    expect(board.placements.find(row => row.cellId === 'CP-3-2')!.color).toBe('rainbow');
    const result = previewCityPatternDeclaration(f.panels[0], f.supply, { ...f.context, exhaustedFacilityCardIds: [f.selected[0]] }, 'PAT-001', f.selected);
    expect(result.status).toBe('not-eligible'); expect(result.issues).toContain('NO_VALID_LAYOUT');
  });
  it('refuses exhausted cards outside this player panel or duplicate exhausted identities', () => {
    const f = fixture(); expect(() => getCityPatternBoard(f.panels[0], f.supply, [f.supply.supply[0]!])).toThrow();
    expect(() => getCityPatternBoard(f.panels[0], f.supply, [f.selected[0]!, f.selected[0]!])).toThrow();
    expect(() => getCityPatternBoard(f.panels[0], f.supply, [f.panels[1]!.placements[0]!.cardId])).toThrow();
  });
  it('reports marker shortage without mutating supplies or claiming the special action', () => {
    const f = fixture(), result = previewCityPatternDeclaration(f.panels[0], f.supply, { ...f.context, availableMarkerCount: 0 }, 'PAT-001', f.selected);
    expect(result.issues).toEqual(['NO_AVAILABLE_MARKER']); expect(result.authoritativeActionGranted).toBe(false); expect(f.context.availableMarkerCount).toBe(29);
  });
  it('rejects a correct shape submitted as too few, too many, duplicate or unowned cards', () => {
    const f = fixture();
    for (const cards of [f.selected.slice(1), [...f.selected, f.panels[0]!.placements[0]!.cardId], [f.selected[0]!, f.selected[0]!, f.selected[2]!], [...f.selected.slice(0, 2), f.supply.supply[0]!]]) {
      expect(previewCityPatternDeclaration(f.panels[0], f.supply, f.context, 'PAT-001', cards).issues).toContain('NO_VALID_LAYOUT');
    }
  });
  it.each(['actor', 'game', 'count', 'supply-revision', 'panel-revision', 'public-duplicates', 'public-levels', 'high-version', 'override'])('rejects invalid trusted context %s', reason => {
    const f = fixture(), context: Record<string, unknown> = { ...f.context };
    if (reason === 'actor') context.actorId = 'p2';
    if (reason === 'game') context.gameId = 'other';
    if (reason === 'count') context.playerCount = 4;
    if (reason === 'supply-revision') context.expectedSupplyRevision = 2;
    if (reason === 'panel-revision') context.expectedPanelRevision = 2;
    if (reason === 'public-duplicates') context.publicPatternIds = Array(6).fill('PAT-001');
    if (reason === 'public-levels') context.publicPatternIds = ['PAT-001', 'PAT-002', 'PAT-003', 'PAT-006', 'PAT-009', 'PAT-010'];
    if (reason === 'high-version') context.publicPatternIds = f.context.publicPatternIds.map((id, i) => i === 0 ? 'PAT-007' : id);
    if (reason === 'override') context.free = true;
    const before = JSON.stringify(f); expect(() => previewCityPatternDeclaration(f.panels[0], f.supply, context, 'PAT-001')).toThrow(); expect(JSON.stringify(f)).toBe(before);
  });
  it('does not allow any known but unselected pattern to be announced by a matching client', () => {
    const f = fixture(), result = previewCityPatternDeclaration(f.panels[0], f.supply, f.context, 'PAT-007');
    expect(result.issues).toContain('PATTERN_NOT_PUBLIC'); expect(result.issues).toContain('PATTERN_VERSION'); expect(result.status).toBe('not-eligible');
  });
});
