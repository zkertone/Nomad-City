import { describe, expect, it } from 'vitest';
import {
  FOUNDERS_FACILITY_PANEL, FOUNDERS_FACILITY_PANEL_HASH, facilityPanelDefinitionSchema,
  validateFoundersFacilityPanel, parseFoundersFacilityPanel, computeFacilityPanelHash,
  getFacilityPanelCell, getFacilityPanelCellAt, getFacilityPanelOrthogonalNeighbors, areFacilityPanelCellsAdjacent,
  FOUNDERS_FACILITY_STOCK, createFoundersFacilitySupply, facilitySupplyStateSchema, replenishFacilitySupply,
  createInitialFacilityPanels, facilityPanelStateSchema, validateFacilityPanelState, parseFacilityPanelState,
  validateFacilityPanelSet, getEmptyFacilityPanelCells, getOrthogonallyAdjacentPanelFacilities, previewFacilityPanelPlacement,
} from './index.js';
const cells = [
  ['CP-1-1', 0, 0], ['CP-1-2', 0, 1], ['CP-1-3', 0, 2],
  ['CP-2-1', 1, 0], ['CP-2-2', 1, 1], ['CP-2-3', 1, 2],
  ['CP-3-1', 2, 0], ['CP-3-2', 2, 1], ['CP-3-3', 2, 2],
  ['CP-4-1', 3, 0], ['CP-4-2', 3, 1], ['CP-4-3', 3, 2],
] as const;
const neighbors = [
  ['CP-1-1', ['CP-1-2', 'CP-2-1']], ['CP-1-2', ['CP-1-1', 'CP-1-3', 'CP-2-2']], ['CP-1-3', ['CP-1-2', 'CP-2-3']],
  ['CP-2-1', ['CP-1-1', 'CP-2-2', 'CP-3-1']], ['CP-2-2', ['CP-1-2', 'CP-2-1', 'CP-2-3', 'CP-3-2']], ['CP-2-3', ['CP-1-3', 'CP-2-2', 'CP-3-3']],
  ['CP-3-1', ['CP-2-1', 'CP-3-2', 'CP-4-1']], ['CP-3-2', ['CP-2-2', 'CP-3-1', 'CP-3-3', 'CP-4-2']], ['CP-3-3', ['CP-2-3', 'CP-3-2', 'CP-4-3']],
  ['CP-4-1', ['CP-3-1', 'CP-4-2']], ['CP-4-2', ['CP-3-2', 'CP-4-1', 'CP-4-3']], ['CP-4-3', ['CP-3-3', 'CP-4-2']],
] as const;
const order = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
function setup(count = 3) {
  const supply = createFoundersFacilitySupply({ gameId: 'panel-test', playerIds: Array.from({ length: count }, (_, index) => `p${index + 1}`), deckOrder: order });
  const panels = createInitialFacilityPanels(supply);
  return { supply: facilitySupplyStateSchema.parse(supply), panels: panels.map(panel => facilityPanelStateSchema.parse(panel)) };
}
function request(f: ReturnType<typeof setup>, cellId = 'CP-1-1') {
  return { actorId: 'p1', cardId: f.supply.supply[0]!, cellId, expectedPanelRevision: f.panels[0]!.revision, expectedSupplyRevision: f.supply.revision };
}
// Physical layout fixture only: does not represent payment, unique-rule verification or a legal construction action.
function occupy(f: ReturnType<typeof setup>, cellId: string) {
  const cardId = f.supply.supply.shift()!;
  f.supply.playerHoldings[0]!.cardIds.push(cardId); f.panels[0]!.placements.push({ cardId, cellId }); f.panels[0]!.revision++;
  f.supply = facilitySupplyStateSchema.parse(replenishFacilitySupply(f.supply, f.supply.revision).state);
  return cardId;
}

describe('source-verified 3-column by 4-row player panel', () => {
  it.each(cells)('preserves image cell %s at logical %i,%i', (id, row, column) => {
    expect(getFacilityPanelCell(id)).toEqual({ id, row, column }); expect(getFacilityPanelCellAt(row, column)).toBe(getFacilityPanelCell(id));
  });
  it('has 12 cells, core at third row/middle, and no note/resource/decorative cells', () => {
    expect(FOUNDERS_FACILITY_PANEL.rows).toBe(4); expect(FOUNDERS_FACILITY_PANEL.columns).toBe(3);
    expect(FOUNDERS_FACILITY_PANEL.initialCoreCellId).toBe('CP-3-2'); expect(FOUNDERS_FACILITY_PANEL.cells).toHaveLength(12);
    expect(new Set(FOUNDERS_FACILITY_PANEL.cells.map(cell => cell.id)).size).toBe(12);
    expect(FOUNDERS_FACILITY_PANEL.sources.find(source => source.kind === 'user-photo')).toMatchObject({
      attachmentId: 'libfile_18a07e3ee5a08191ac872b03436808ca', sha256: 'fcc7a3d215e414dd06bddeccd969325071e49124906fdc431d0fe656877b8d0f',
    });
    expect(Object.isFrozen(FOUNDERS_FACILITY_PANEL.cells[0])).toBe(true);
  });
  it('validates round trips and canonical cell/evidence ordering', () => {
    expect(parseFoundersFacilityPanel(JSON.parse(JSON.stringify(FOUNDERS_FACILITY_PANEL)))).toEqual(FOUNDERS_FACILITY_PANEL);
    const changed = facilityPanelDefinitionSchema.parse(FOUNDERS_FACILITY_PANEL); changed.cells.reverse(); changed.sources.reverse();
    expect(computeFacilityPanelHash(changed)).toBe(FOUNDERS_FACILITY_PANEL_HASH); expect(validateFoundersFacilityPanel(changed).success).toBe(true);
  });
  it.each(['core', 'source', 'cell', 'duplicate-id', 'duplicate-position', 'version'] as const)('rejects altered %s including recomputed claims', field => {
    const changed = facilityPanelDefinitionSchema.parse(FOUNDERS_FACILITY_PANEL);
    if (field === 'core') changed.initialCoreCellId = 'CP-2-2';
    if (field === 'source') changed.sources[0]!.sha256 = '0'.repeat(64);
    if (field === 'cell') changed.cells[0]!.row = 1;
    if (field === 'duplicate-id') changed.cells[0]!.id = changed.cells[1]!.id;
    if (field === 'duplicate-position') { changed.cells[0]!.row = changed.cells[1]!.row; changed.cells[0]!.column = changed.cells[1]!.column; }
    if (field === 'version') Object.assign(changed, { definitionVersion: '2.0.0' });
    changed.contentHash = computeFacilityPanelHash(changed);
    expect(validateFoundersFacilityPanel(changed).success).toBe(false);
    expect(() => parseFoundersFacilityPanel(changed)).toThrow('Invalid facility panel');
  });
  it('rejects false hashes, missing cells, unknown core cells and extra coordinate fields', () => {
    expect(validateFoundersFacilityPanel({ ...FOUNDERS_FACILITY_PANEL, contentHash: `sha256:${'0'.repeat(64)}` }).success).toBe(false);
    expect(validateFoundersFacilityPanel({ ...FOUNDERS_FACILITY_PANEL, initialCoreCellId: 'notes' }).success).toBe(false);
    const missing = facilityPanelDefinitionSchema.parse(FOUNDERS_FACILITY_PANEL); missing.cells.pop();
    expect(validateFoundersFacilityPanel(missing).success).toBe(false);
    const extra = facilityPanelDefinitionSchema.parse(FOUNDERS_FACILITY_PANEL); Object.assign(extra.cells[0]!, { x: 10, y: 20 });
    expect(validateFoundersFacilityPanel(extra).success).toBe(false);
  });
});

describe('orthogonal adjacency, separate from world map distances', () => {
  it.each(neighbors)('preserves every neighbor of %s', (id, expected) => {
    expect(getFacilityPanelOrthogonalNeighbors(id).map(cell => cell.id)).toEqual(expected);
    for (const other of expected) expect(areFacilityPanelCellsAdjacent(id, other)).toBe(true);
    expect(areFacilityPanelCellsAdjacent(id, id)).toBe(false);
  });
  it('excludes diagonals, wraparound and distant cells', () => {
    for (const [a, b] of [['CP-2-1', 'CP-3-2'], ['CP-1-3', 'CP-2-1'], ['CP-1-1', 'CP-4-3']]) expect(areFacilityPanelCellsAdjacent(a!, b!)).toBe(false);
  });
  it.each(['constructor', '__proto__', 'toString', 'CP-0-1', 'CP-5-1', 'notes', 'originium-storage'])('rejects non-cell %s', id => {
    expect(() => getFacilityPanelCell(id)).toThrow(RangeError); expect(() => getFacilityPanelOrthogonalNeighbors(id)).toThrow(RangeError);
    expect(() => areFacilityPanelCellsAdjacent('CP-1-1', id)).toThrow(RangeError);
  });
  it.each([[-1, 0], [4, 0], [0, 3], [0.5, 1], [NaN, 1], [Infinity, 0]])('rejects out-of-bounds/noninteger coordinate %s,%s', (row, column) => {
    expect(() => getFacilityPanelCellAt(row, column)).toThrow(RangeError);
  });
});

describe('initial panels and exact physical ownership matching', () => {
  it.each([2, 3, 4])('sets up %i independent core panels with 11 empty cells each', count => {
    const f = setup(count);
    expect(validateFacilityPanelSet(f.panels, f.supply).success).toBe(true);
    for (const [index, panel] of f.panels.entries()) {
      expect(panel.placements).toEqual([{ cellId: 'CP-3-2', cardId: f.supply.playerHoldings[index]!.cardIds[0] }]);
      expect(getEmptyFacilityPanelCells(panel, f.supply)).toHaveLength(11);
      expect(Object.isFrozen(parseFacilityPanelState(panel, f.supply).placements)).toBe(true);
    }
    expect(new Set(f.panels.map(panel => panel.placements[0]!.cardId)).size).toBe(count);
  });
  it('cannot initialize/reset panels using non-initial holdings or already-progressed supply', () => {
    const f = setup(); f.supply.revision = 1; expect(() => createInitialFacilityPanels(f.supply)).toThrow('Expected initial');
    const g = setup(); occupy(g, 'CP-1-1'); expect(() => createInitialFacilityPanels(g.supply)).toThrow('Expected initial');
    const h = setup(); h.supply.returnedToBox.push(h.supply.supply.shift()!);
    expect(() => createInitialFacilityPanels(h.supply)).toThrow('Expected initial');
  });
  it.each(['owner', 'game', 'hash', 'version', 'unknown-card', 'foreign-core', 'core-position', 'duplicate-cell', 'duplicate-card', 'missing-position', 'off-board'] as const)('rejects malformed %s positions', problem => {
    const f = setup(), panel = f.panels[0]!;
    if (problem === 'owner') panel.playerId = 'unknown';
    if (problem === 'game') panel.gameId = 'other-game';
    if (problem === 'hash') panel.panelRef.contentHash = `sha256:${'0'.repeat(64)}`;
    if (problem === 'version') Object.assign(panel, { schemaVersion: '2.0.0' });
    if (problem === 'unknown-card') panel.placements[0]!.cardId = 'FC:unknown';
    if (problem === 'foreign-core') panel.placements[0]!.cardId = f.panels[1]!.placements[0]!.cardId;
    if (problem === 'core-position') panel.placements[0]!.cellId = 'CP-1-1';
    if (problem === 'duplicate-cell') { const id = occupy(f, 'CP-1-1'); panel.placements.find(row => row.cardId === id)!.cellId = 'CP-3-2'; }
    if (problem === 'duplicate-card') panel.placements.push({ cellId: 'CP-1-1', cardId: panel.placements[0]!.cardId });
    if (problem === 'missing-position') f.supply.playerHoldings[0]!.cardIds.push(f.supply.supply.shift()!);
    if (problem === 'off-board') panel.placements[0]!.cellId = 'notes';
    expect(validateFacilityPanelState(panel, f.supply).success).toBe(false);
    expect(() => parseFacilityPanelState(panel, f.supply)).toThrow('Invalid facility panel state');
  });
  it('rejects panel sets with omitted, duplicate or additional players', () => {
    const f = setup(); expect(validateFacilityPanelSet(f.panels.slice(0, 2), f.supply).success).toBe(false);
    expect(validateFacilityPanelSet([f.panels[0], f.panels[0], f.panels[2]], f.supply).success).toBe(false);
    expect(validateFacilityPanelSet([...f.panels, { ...f.panels[0], playerId: 'p4' }], f.supply).success).toBe(false);
  });
  it('rejects corrupt supply, negative revisions and unsupported fields', () => {
    const f = setup(); f.supply.drawPile.pop(); expect(validateFacilityPanelState(f.panels[0], f.supply).success).toBe(false);
    const g = setup(); expect(validateFacilityPanelState({ ...g.panels[0], revision: -1 }, g.supply).success).toBe(false);
    expect(validateFacilityPanelState({ ...g.panels[0], paid: true }, g.supply).success).toBe(false);
  });
  it('queries occupied core neighbors with derived colors while ignoring diagonals', () => {
    const f = setup(); const top = occupy(f, 'CP-2-2'); const right = occupy(f, 'CP-3-3'); occupy(f, 'CP-2-1');
    expect(getOrthogonallyAdjacentPanelFacilities(f.panels[0], f.supply, 'CP-3-2').map(row => row.cardId)).toEqual([top, right]);
    expect(getOrthogonallyAdjacentPanelFacilities(f.panels[0], f.supply, 'CP-3-2')[0]).toMatchObject({ color: 'red', facilityId: 'FAC-001' });
  });
  it('represents a full 12-cell panel with no remaining empty cell', () => {
    const f = setup(); for (const [id] of cells) if (id !== 'CP-3-2') occupy(f, id);
    expect(validateFacilityPanelSet(f.panels, f.supply).success).toBe(true);
    expect(getEmptyFacilityPanelCells(f.panels[0], f.supply)).toEqual([]);
    expect(previewFacilityPanelPlacement(f.panels[0], f.supply, request(f)).status).toBe('position-unavailable');
  });
});

describe('position preflight only; no action execution/fee/entry authorization', () => {
  it.each(cells.filter(([id]) => id !== 'CP-3-2'))('accepts any empty %s, including non-adjacent cells', id => {
    const f = setup(), before = JSON.stringify(f), result = previewFacilityPanelPlacement(f.panels[0], f.supply, request(f, id));
    expect(result).toEqual({ status: 'position-available', placement: { cellId: id, cardId: f.supply.supply[0] }, source: 'supply' });
    expect(JSON.stringify(f)).toBe(before);
    expect(Object.hasOwn(result, 'allowed')).toBe(false);
  });
  it('does not mistake a valid extension-reserve position for authorization to construct an extension', () => {
    const f = setup(), before = JSON.stringify(f);
    expect(previewFacilityPanelPlacement(f.panels[0], f.supply, { ...request(f), cardId: f.supply.extensionReserve[0] })).toMatchObject({ status: 'position-available', source: 'extension-reserve' });
    expect(JSON.stringify(f)).toBe(before); // Logistics authorization is a separate unimplemented action rule.
  });
  it.each(['actor', 'panel-revision', 'supply-revision', 'occupied', 'off-board', 'hidden-card', 'foreign-card', 'core', 'unknown-card', 'invalid-request'] as const)('rejects %s request', problem => {
    const f = setup(), input = request(f);
    if (problem === 'actor') input.actorId = 'p2';
    if (problem === 'panel-revision') input.expectedPanelRevision = 1;
    if (problem === 'supply-revision') input.expectedSupplyRevision = 1;
    if (problem === 'occupied') input.cellId = 'CP-3-2';
    if (problem === 'off-board') input.cellId = 'CP-4-4';
    if (problem === 'hidden-card') input.cardId = f.supply.drawPile[0]!;
    if (problem === 'foreign-card') input.cardId = f.supply.playerHoldings[1]!.cardIds[0]!;
    if (problem === 'core') input.cardId = f.supply.unusedCoreTowers[0]!;
    if (problem === 'unknown-card') input.cardId = '__proto__';
    if (problem === 'invalid-request') Object.assign(input, { paid: true });
    expect(previewFacilityPanelPlacement(f.panels[0], f.supply, input).status).toBe('position-unavailable');
  });
  it('fails safely on invalid snapshots and malformed request envelopes', () => {
    const f = setup(); expect(previewFacilityPanelPlacement({}, f.supply, request(f)).status).toBe('position-unavailable');
    for (const input of [null, [], {}, { ...request(f), expectedPanelRevision: NaN }]) expect(previewFacilityPanelPlacement(f.panels[0], f.supply, input).status).toBe('position-unavailable');
  });
});
