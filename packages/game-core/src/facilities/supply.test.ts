import { describe, expect, it } from 'vitest';
import {
  FOUNDERS_FACILITY_STOCK, FOUNDERS_FACILITY_STOCK_HASH, getFoundersPhysicalFacilityCard,
  computeFacilityStockHash, canonicalFacilityStockContent, facilityStockSchema,
  validateFoundersFacilityStock, parseFoundersFacilityStock,
  createFoundersFacilitySupply, parseFacilitySupplyState, validateFacilitySupplyState, facilitySupplyStateSchema,
  replenishFacilitySupply, getFacilitySupplyPublicView, shuffleFoundersFacilityDeck,
} from './index.js';

const ordinaryIds = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const initial = (count = 3) => createFoundersFacilitySupply({ gameId: 'supply-test', playerIds: Array.from({ length: count }, (_, n) => `p${n + 1}`), deckOrder: ordinaryIds });
const copy = () => facilitySupplyStateSchema.parse(initial());
// Physical ledger fixtures only, not simulations of legal construction/payment/placement.
const gap = (amount: number) => { const state = copy(); state.playerHoldings[0]!.cardIds.push(...state.supply.splice(0, amount)); return state; };
const expectedCounts = [
  ['FAC-001', 3, 0, 0, 0], ['FAC-002', 2, 0, 0, 0], ['FAC-003', 3, 0, 0, 0],
  ['FAC-004', 0, 2, 0, 0], ['FAC-005', 0, 3, 0, 0], ['FAC-006', 0, 3, 0, 0],
  ['FAC-007', 0, 0, 2, 0], ['FAC-008', 0, 0, 3, 0], ['FAC-009', 0, 0, 3, 0],
  ['FAC-010', 1, 1, 0, 0], ['FAC-011', 0, 1, 1, 0], ['FAC-012', 1, 0, 1, 0],
  ['FAC-013', 0, 0, 0, 3], ['FAC-014', 0, 0, 0, 3], ['FAC-015', 0, 0, 0, 3],
  ['FAC-016', 0, 0, 0, 2], ['FAC-018', 1, 1, 1, 0], ['FAC-CORE-COMMAND-TOWER', 0, 0, 0, 4],
] as const;

describe('physical facilities, independent of face cost/effects/geometry', () => {
  it.each(expectedCounts)('expands confirmed copies of %s', (id, red, blue, yellow, rainbow) => {
    const cards = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.facilityId === id);
    expect(['red', 'blue', 'yellow', 'rainbow'].map(color => cards.filter(card => card.color === color).length)).toEqual([red, blue, yellow, rainbow]);
    for (const card of cards) expect(getFoundersPhysicalFacilityCard(card.id)).toBe(card);
  });
  it('partitions all 48 unique cards into 41 ordinary, 4 core and 3 extension, without expansion cards', () => {
    const cards = FOUNDERS_FACILITY_STOCK.cards;
    expect(new Set(cards.map(card => card.id)).size).toBe(48);
    expect(cards.filter(card => card.group === 'ordinary')).toHaveLength(41);
    expect(cards.filter(card => card.group === 'core-command-tower')).toHaveLength(4);
    expect(cards.filter(card => card.group === 'extension-hub')).toHaveLength(3);
    expect(cards.some(card => ['FAC-017', 'FAC-019', 'FAC-020'].includes(card.facilityId))).toBe(false);
    expect(Object.keys(cards[0]!).sort()).toEqual(['color', 'facilityId', 'group', 'id']);
    expect(Object.isFrozen(cards[0])).toBe(true);
  });
  it('validates pinned stock, canonical order and round trips', () => {
    expect(validateFoundersFacilityStock(FOUNDERS_FACILITY_STOCK).success).toBe(true);
    expect(parseFoundersFacilityStock(JSON.parse(JSON.stringify(FOUNDERS_FACILITY_STOCK)))).toEqual(FOUNDERS_FACILITY_STOCK);
    const stock = facilityStockSchema.parse(FOUNDERS_FACILITY_STOCK); stock.cards.reverse();
    expect(computeFacilityStockHash(stock)).toBe(FOUNDERS_FACILITY_STOCK_HASH);
    expect(canonicalFacilityStockContent(stock)).toContain('nco-facility-stock-c14n-v1');
  });
  it.each(['color', 'group', 'identity', 'duplicate', 'source'] as const)('rejects altered %s with a recomputed hash', field => {
    const stock = facilityStockSchema.parse(FOUNDERS_FACILITY_STOCK);
    if (field === 'color') stock.cards[0]!.color = 'rainbow';
    if (field === 'group') stock.cards[0]!.group = 'extension-hub';
    if (field === 'identity') stock.cards[0]!.facilityId = 'FAC-020';
    if (field === 'duplicate') stock.cards[0] = stock.cards[1]!;
    if (field === 'source') stock.quantityCatalogRef.contentHash = `sha256:${'a'.repeat(64)}`;
    stock.contentHash = computeFacilityStockHash(stock);
    expect(validateFoundersFacilityStock(stock).success).toBe(false);
    expect(() => parseFoundersFacilityStock(stock)).toThrow('Invalid facility stock');
  });
  it('rejects missing cards, unknown fields, versions and false digest claims', () => {
    const stock = facilityStockSchema.parse(FOUNDERS_FACILITY_STOCK); stock.cards.pop();
    expect(validateFoundersFacilityStock(stock).success).toBe(false);
    expect(validateFoundersFacilityStock({ ...FOUNDERS_FACILITY_STOCK, definitionVersion: '2.0.0' }).success).toBe(false);
    expect(validateFoundersFacilityStock({ ...FOUNDERS_FACILITY_STOCK, contentHash: `sha256:${'0'.repeat(64)}` }).success).toBe(false);
    expect(validateFoundersFacilityStock({ ...FOUNDERS_FACILITY_STOCK, price: 0 }).success).toBe(false);
  });
  it.each(['constructor', '__proto__', 'toString', 'FAC-001'])('rejects unknown physical ID %s', id => {
    expect(() => getFoundersPhysicalFacilityCard(id)).toThrow(RangeError);
  });
});

describe('setup and secret-safe public projection', () => {
  it.each([2, 3, 4])('creates the %i-player facility supply and conserves all 48 physical cards', count => {
    const state = initial(count);
    expect(state.supply).toEqual(ordinaryIds.slice(0, 6)); expect(state.drawPile).toEqual(ordinaryIds.slice(6));
    expect(state.drawPile).toHaveLength(35); expect(state.extensionReserve).toHaveLength(3);
    expect(state.playerHoldings).toHaveLength(count); expect(state.unusedCoreTowers).toHaveLength(4 - count);
    for (const holding of state.playerHoldings) expect(holding.cardIds).toHaveLength(1);
    expect(validateFacilitySupplyState(state).success).toBe(true); expect(state.revision).toBe(0);
    expect(Object.isFrozen(state.supply)).toBe(true);
  });
  it('respects the supplied deck order instead of assuming a sorted order is shuffled', () => {
    const order = [...ordinaryIds].reverse();
    const state = createFoundersFacilitySupply({ gameId: 'reverse', playerIds: ['p1', 'p2'], deckOrder: order });
    expect(state.supply).toEqual(order.slice(0, 6)); expect(order).toHaveLength(41);
    order.reverse(); expect(state.supply).not.toEqual(order.slice(0, 6));
  });
  it('supports safe array-based player IDs including prototype property names', () => {
    const state = createFoundersFacilitySupply({ gameId: 'safe', playerIds: ['constructor', '__proto__'], deckOrder: ordinaryIds });
    expect(state.playerHoldings.map(row => row.playerId)).toEqual(['constructor', '__proto__']);
    expect(validateFacilitySupplyState(state).success).toBe(true);
  });
  it.each([0, 1, 5])('rejects unsupported %i players', count => {
    expect(() => initial(count)).toThrow();
  });
  it.each(['missing', 'duplicate', 'unknown', 'core', 'extension'] as const)('rejects %s in deck order', problem => {
    const order = [...ordinaryIds];
    if (problem === 'missing') order.pop();
    if (problem === 'duplicate') order[0] = order[1]!;
    if (problem === 'unknown') order[0] = 'FC:unknown:red:01';
    if (problem === 'core') order[0] = initial().playerHoldings[0]!.cardIds[0]!;
    if (problem === 'extension') order[0] = initial().extensionReserve[0]!;
    expect(() => createFoundersFacilitySupply({ gameId: 'bad-order', playerIds: ['p1', 'p2'], deckOrder: order })).toThrow();
  });
  it('rejects duplicate players, blank identifiers and an omitted order', () => {
    expect(() => createFoundersFacilitySupply({ gameId: 'test', playerIds: ['p1', 'p1'], deckOrder: ordinaryIds })).toThrow();
    expect(() => createFoundersFacilitySupply({ gameId: ' ', playerIds: ['p1', 'p2'], deckOrder: ordinaryIds })).toThrow();
    expect(() => createFoundersFacilitySupply({ gameId: 'x', playerIds: [' ', 'p2'], deckOrder: ordinaryIds })).toThrow();
    expect(() => createFoundersFacilitySupply({ gameId: 'x', playerIds: ['p1', 'p2'] } as unknown as Parameters<typeof createFoundersFacilitySupply>[0])).toThrow();
  });
  it('shows face-up zones and draw count without exposing hidden order', () => {
    const state = initial(), view = getFacilitySupplyPublicView(state);
    expect(Object.keys(view).sort()).toEqual(['schemaVersion', 'gameId', 'revision', 'stockRef', 'supply', 'extensionReserve', 'unusedCoreTowers', 'playerHoldings', 'returnedToBox', 'drawPileCount'].sort());
    expect(view.drawPileCount).toBe(35); expect(view.supply).toEqual(state.supply);
    expect(Object.hasOwn(view, 'drawPile')).toBe(false);
    expect(Object.isFrozen(view.playerHoldings[0]!.cardIds)).toBe(true);
    expect(JSON.stringify(view)).not.toContain(state.drawPile[0]);
  });
  it('shuffles through the supplied server random source without altering the stock', () => {
    const limits: number[] = [];
    const order = shuffleFoundersFacilityDeck(limit => { limits.push(limit); return 0; });
    expect(limits).toEqual(Array.from({ length: 40 }, (_, index) => 41 - index));
    expect([...order].sort()).toEqual([...ordinaryIds].sort()); expect(order).not.toEqual(ordinaryIds);
    expect(Object.isFrozen(order)).toBe(true);
    expect(createFoundersFacilitySupply({ gameId: 'shuffled', playerIds: ['p1', 'p2'], deckOrder: order }).supply).toEqual(order.slice(0, 6));
  });
  it.each([-1, 41, 0.5, NaN, Infinity])('rejects invalid random index %s', number => {
    expect(() => shuffleFoundersFacilityDeck(() => number)).toThrow(RangeError);
  });
});

describe('ledger integrity and internal supply replenishment', () => {
  it.each([1, 2, 6])('refills %i gaps from the top, atomically and without changing the input', amount => {
    const state = gap(amount), before = JSON.stringify(state);
    const result = replenishFacilitySupply(state, 0);
    expect(result.status).toBe('replenished');
    if (result.status !== 'replenished') throw new Error('expected refill');
    expect(result.drawnCardIds).toEqual(state.drawPile.slice(0, amount));
    expect(result.state.supply).toEqual([...state.supply, ...state.drawPile.slice(0, amount)]);
    expect(result.state.drawPile).toHaveLength(35 - amount); expect(result.state.revision).toBe(1);
    expect(validateFacilitySupplyState(result.state).success).toBe(true);
    expect(JSON.stringify(state)).toBe(before); expect(Object.isFrozen(result.drawnCardIds)).toBe(true);
  });
  it('does not draw or increment revision when the supply is already full', () => {
    const state = initial(); expect(replenishFacilitySupply(state, 0)).toEqual({ status: 'unchanged', state });
  });
  it('accounts for ordinary cards returned to the box, separately from unallocated core towers', () => {
    const state = copy(); state.returnedToBox.push(state.supply.shift()!);
    expect(validateFacilitySupplyState(state).success).toBe(true);
    const result = replenishFacilitySupply(state, 0);
    expect(result.status).toBe('replenished'); expect(result.state.returnedToBox).toEqual(state.returnedToBox);
    expect(result.state.unusedCoreTowers).toHaveLength(1);
    state.returnedToBox.push(state.extensionReserve.shift()!);
    expect(validateFacilitySupplyState(state).success).toBe(false);
  });
  it('reports an exhausted/insufficient pile without inventing reshuffling or partially mutating state', () => {
    for (const available of [0, 1]) {
      const state = gap(2); state.playerHoldings[0]!.cardIds.push(...state.drawPile.splice(available));
      const before = JSON.stringify(state);
      expect(replenishFacilitySupply(state, 0)).toEqual({ status: 'insufficient-cards', state, required: 2, available });
      expect(JSON.stringify(state)).toBe(before);
    }
  });
  it.each([-1, 1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects stale/invalid revision %s', revision => {
    expect(() => replenishFacilitySupply(gap(1), revision)).toThrow('revision');
  });
  it('rejects revision overflow when a refill is needed', () => {
    const state = gap(1); state.revision = Number.MAX_SAFE_INTEGER;
    expect(() => replenishFacilitySupply(state, state.revision)).toThrow('overflow');
  });
  it.each(['duplicate', 'missing', 'unknown', 'wrong-zone', 'wrong-player', 'core-lost', 'stock-hash', 'stock-version', 'schema-version'] as const)('rejects %s in a physical snapshot', problem => {
    const state = copy();
    if (problem === 'duplicate') state.playerHoldings[0]!.cardIds.push(state.supply[0]!);
    if (problem === 'missing') state.drawPile.pop();
    if (problem === 'unknown') state.drawPile[0] = 'FC:unknown:red:01';
    if (problem === 'wrong-zone') [state.supply[0], state.extensionReserve[0]] = [state.extensionReserve[0]!, state.supply[0]!];
    if (problem === 'wrong-player') state.playerHoldings[0]!.playerId = state.playerHoldings[1]!.playerId;
    if (problem === 'core-lost') state.unusedCoreTowers.push(...state.playerHoldings[0]!.cardIds.splice(0));
    if (problem === 'stock-hash') state.stockRef.contentHash = `sha256:${'0'.repeat(64)}`;
    if (problem === 'stock-version') Object.assign(state.stockRef, { definitionVersion: '2.0.0' });
    if (problem === 'schema-version') Object.assign(state, { schemaVersion: '2.0.0' });
    expect(validateFacilitySupplyState(state).success).toBe(false);
    expect(() => replenishFacilitySupply(state, 0)).toThrow('Invalid facility supply');
    expect(() => getFacilitySupplyPublicView(state)).toThrow('Invalid facility supply');
  });
  it('rejects hidden extension fields, overfull supply and invalid revision data', () => {
    expect(validateFacilitySupplyState({ ...copy(), actionApproved: true }).success).toBe(false);
    expect(validateFacilitySupplyState({ ...copy(), revision: -1 }).success).toBe(false);
    const state = copy(); state.supply.push(state.drawPile.shift()!);
    expect(validateFacilitySupplyState(state).success).toBe(false);
  });
  it('supports serialization and detached immutable parsing', () => {
    const input = copy(); const parsed = parseFacilitySupplyState(JSON.parse(JSON.stringify(input)));
    input.supply.reverse(); expect(parsed.supply).toEqual(ordinaryIds.slice(0, 6));
    expect(Object.isFrozen(parsed.stockRef)).toBe(true);
  });
});
