import { describe, expect, it } from 'vitest';
import {
  createPreEntryGame, getGamePosition, gamePositionSchema,
} from '../game/index.js';
import type { PlayerSetup } from '../game/types.js';
import {
  FOUNDERS_FACILITY_STOCK, FOUNDERS_FACILITY_FACES_HASH, getFoundersFacilityFace, createFoundersFacilitySupply, createInitialFacilityPanels,
  facilityConstructionPositionSchema, validateFacilityConstructionPosition, parseFacilityConstructionPosition,
  getFacilityConstructionSpec, getFacilityConstructionSupport, FACILITY_CONSTRUCTION_SOURCE_HASH, FacilityConstructionError,
  getFacilityConstructionQuote, settleFacilityConstruction, validateFacilityPanelSet,
} from './index.js';
const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
function fixture(facilityId = 'FAC-013', color = getFoundersFacilityFace(facilityId).observedColor, count = 3) {
  const game = createPreEntryGame('construction-test', seats.slice(0, count));
  const cardId = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === facilityId && card.color === color)!.id;
  const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
  const order = ordinary.includes(cardId) ? [cardId, ...ordinary.filter(id => id !== cardId)] : ordinary;
  const supply = createFoundersFacilitySupply({ gameId: game.definition.gameId, playerIds: game.definition.players.map(row => row.id), deckOrder: order });
  const position = gamePositionSchema.parse(getGamePosition(game.state, game.definition));
  for (const key of ['orirock', 'originium', 'iron', 'columbia-voucher', 'pure-originium'] as const) position.players.p1!.balances[key] = 30;
  const state = facilityConstructionPositionSchema.parse({ position, supply, panels: createInitialFacilityPanels(supply) });
  return { definition: game.definition, state, cardId,
    context: { gameId: game.definition.gameId, actorId: 'p1', expectedSupplyRevision: 0, expectedPanelRevision: 0 },
    command: { cardId, cellId: 'CP-1-1', paymentMode: 'resources' as 'resources' | 'vouchers',
      ...(facilityId === 'FAC-008' ? { entryChoice: { kind: 'resource-allocation' as const, gains: { orirock: 2, originium: 2, iron: 1 } } } : {}) },
  };
}
type Fixture = ReturnType<typeof fixture>;
const run = (f: Fixture, payload: unknown = f.command) => settleFacilityConstruction(f.state, f.definition, f.context, payload);
const errorCode = (fn: () => unknown, code: string) => {
  try { fn(); throw new Error('Expected construction rejection'); }
  catch (error) { expect(error).toBeInstanceOf(FacilityConstructionError); expect((error as FacilityConstructionError).code).toBe(code); }
};
/** Physical fixture, not historical proof that prior construction/actions were legal. */
function existing(f: Fixture, facilityId: string, color: string, cellId: string, playerIndex = 0) {
  const id = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === facilityId && card.color === color
    && card.id !== f.cardId
    && !f.state.supply.playerHoldings.some(row => row.cardIds.includes(card.id)))!.id;
  for (const zone of [f.state.supply.drawPile, f.state.supply.supply, f.state.supply.extensionReserve]) {
    const at = zone.indexOf(id); if (at >= 0) zone.splice(at, 1);
  }
  while (f.state.supply.supply.length < 6) f.state.supply.supply.push(f.state.supply.drawPile.shift()!);
  f.state.supply.playerHoldings[playerIndex]!.cardIds.push(id); f.state.panels[playerIndex]!.placements.push({ cellId, cardId: id });
}
// Independent source values: R/O/I/V resource cost, voucher-only cost, points, entry deltas before mining allocation.
const simple = [
  ['FAC-005', 3, 0, 2, 0, 16, 1, {}],
  ['FAC-008', 0, 2, 1, 0, 10, 0, { orirock: 2, originium: 2, iron: 1 }],
  ['FAC-009', 4, 3, 0, 2, 24, 2, {}],
  ['FAC-010', 2, 2, 1, 0, 15, 1, { iron: 4 }],
  ['FAC-011', 1, 1, 1, 0, 10, 0, { originium: 6 }],
  ['FAC-012', 1, 1, 1, 0, 10, 0, { orirock: 7 }],
  ['FAC-013', 3, 3, 3, 0, 30, 3, {}],
] as const;

describe('supported pictured facility variants and fail-closed boundaries', () => {
  it('reports precisely eleven types and twenty-six matching physical copies', () => {
    const support = getFacilityConstructionSupport();
    expect(support.supportedFacilityIds).toEqual(['FAC-001', 'FAC-002', 'FAC-003', 'FAC-005', 'FAC-006', 'FAC-008', 'FAC-009', 'FAC-010', 'FAC-011', 'FAC-012', 'FAC-013']);
    expect(support.supportedPhysicalCardIds).toHaveLength(26); expect(support.allFacilitiesImplemented).toBe(false);
    expect(FACILITY_CONSTRUCTION_SOURCE_HASH).toBe(FOUNDERS_FACILITY_FACES_HASH);
    expect(Object.isFrozen(support.supportedPhysicalCardIds)).toBe(true);
  });
  it.each([['FAC-010', 'blue'], ['FAC-011', 'yellow'], ['FAC-012', 'red']] as const)('rejects unpictured %s/%s without altering anything', (id, color) => {
    const f = fixture(id, color), before = JSON.stringify(f.state);
    errorCode(() => run(f), 'UNCONFIRMED_COLOR_VARIANT'); expect(JSON.stringify(f.state)).toBe(before);
  });
  it.each(['FAC-001', 'FAC-002', 'FAC-003', 'FAC-004', 'FAC-006', 'FAC-007', 'FAC-014', 'FAC-015', 'FAC-016'])('rejects %s with an unavailable handler or missing mandatory entry choice', id => {
    const f = fixture(id), before = JSON.stringify(f.state);
    errorCode(() => run(f), ['FAC-001', 'FAC-002', 'FAC-003', 'FAC-006'].includes(id) ? 'ENTRY_CHOICE' : 'UNSUPPORTED_ENTRY_EFFECT'); expect(JSON.stringify(f.state)).toBe(before);
  });
  it('rejects ordinary extension/core construction and unknown physical IDs', () => {
    const extension = fixture('FAC-018', 'yellow'); errorCode(() => run(extension), 'CARD_SOURCE');
    const core = fixture(); core.command.cardId = core.state.supply.unusedCoreTowers[0]!;
    errorCode(() => run(core), 'PLACEMENT_INVALID');
    errorCode(() => getFacilityConstructionSpec(core.command.cardId), 'CARD_SOURCE');
    errorCode(() => getFacilityConstructionSpec('__proto__'), 'CARD_REFERENCE');
  });
  it('returns detached readonly parsed transaction positions and rejects invented fields', () => {
    const f = fixture(), parsed = parseFacilityConstructionPosition(f.state, f.definition);
    expect(validateFacilityConstructionPosition(parsed, f.definition).success).toBe(true);
    expect(Object.isFrozen(parsed.position.players.p1!.balances)).toBe(true);
    f.state.position.players.p1!.balances.iron = 0; expect(parsed.position.players.p1!.balances.iron).toBe(30);
    expect(validateFacilityConstructionPosition({ ...f.state, approved: true }, f.definition).success).toBe(false);
  });
});

for (const mode of ['resources', 'vouchers'] as const) describe(`${mode} payment, position, points and entry settle atomically`, () => {
  it.each(simple)('executes %s using its exact source values', (id, rock, ori, iron, voucher, alt, points, gain) => {
    const f = fixture(id), before = JSON.stringify(f.state); f.command.paymentMode = mode;
    const quote = getFacilityConstructionQuote(f.state, f.definition, f.context, f.command);
    const result = run(f), actor = result.state.position.players.p1!;
    const delta = gain as Partial<Record<'orirock' | 'originium' | 'iron', number>>;
    expect(actor.balances.orirock).toBe(30 - (mode === 'resources' ? rock : 0) + (delta.orirock ?? 0));
    expect(actor.balances.originium).toBe(30 - (mode === 'resources' ? ori : 0) + (delta.originium ?? 0));
    expect(actor.balances.iron).toBe(30 - (mode === 'resources' ? iron : 0) + (delta.iron ?? 0));
    expect(actor.balances['columbia-voucher']).toBe(30 - (mode === 'resources' ? voucher : alt));
    expect(actor.balances['pure-originium']).toBe(30); expect(actor.score).toBe(points);
    expect(quote.canPay).toBe(true); expect(quote.printedPoints).toBe(points);
    expect(result.receipt.paid).toEqual(quote.costs); expect(result.receipt.order).toEqual(['pay', 'take-and-refill', 'place', 'score', 'entry']);
    expect(result.state.supply.supply).toHaveLength(6); expect(result.state.supply.drawPile).toHaveLength(34);
    expect(result.receipt.refilledCardIds).toEqual(f.state.supply.drawPile.slice(0, 1));
    expect(result.state.supply.playerHoldings[0]!.cardIds).toContain(f.cardId);
    expect(result.state.panels[0]!.placements).toContainEqual({ cellId: 'CP-1-1', cardId: f.cardId });
    expect(result.state.supply.revision).toBe(1); expect(result.state.panels[0]!.revision).toBe(1);
    expect(result.state.position.players.p2).toEqual(f.state.position.players.p2);
    expect(result.state.position.board).toEqual(f.state.position.board); expect(result.state.position.markerSupplyByPlayer).toEqual(f.state.position.markerSupplyByPlayer);
    expect(validateFacilityConstructionPosition(result.state, f.definition).success).toBe(true);
    expect(JSON.stringify(f.state)).toBe(before); expect(Object.isFrozen(result.receipt.paid)).toBe(true);
  });
});

describe('entry choices, post-placement adjacency and self-only discounts', () => {
  const allocations: [number, number, number][] = [];
  for (let rock = 0; rock <= 5; rock++) for (let ori = 0; ori <= 5 - rock; ori++) allocations.push([rock, ori, 5 - rock - ori]);
  it.each(allocations)('allocates exactly %i rock + %i originium + %i iron', (orirock, originium, iron) => {
    const f = fixture('FAC-008'); f.command.entryChoice!.gains = { orirock, originium, iron };
    const result = run(f); expect(result.state.position.players.p1!.balances).toMatchObject({ orirock: 30 + orirock, originium: 28 + originium, iron: 29 + iron });
    expect(result.receipt.entryGains.reduce((sum, entry) => sum + entry.amount, 0)).toBe(5);
  });
  it.each([{}, { entryChoice: { kind: 'resource-allocation', gains: { orirock: 5, originium: 5, iron: 5 } } },
    { entryChoice: { kind: 'resource-allocation', gains: { orirock: -1, originium: 1, iron: 5 } } },
    { entryChoice: { kind: 'resource-allocation', gains: { orirock: 0.5, originium: 0.5, iron: 4 } } },
    { entryChoice: { kind: 'resource-allocation', gains: { orirock: 5, originium: 0, iron: 0, 'pure-originium': 1 } } },
  ])('rejects missing/invalid mining choice %#', choice => {
    const f = fixture('FAC-008'); const payload = { cardId: f.cardId, cellId: 'CP-1-1', paymentMode: 'resources', ...choice };
    errorCode(() => run(f, payload), Object.hasOwn(choice, 'entryChoice') ? 'COMMAND_SCHEMA' : 'ENTRY_CHOICE');
  });
  it('rejects invented entry decisions on a non-choice facility', () => {
    const f = fixture('FAC-013'); errorCode(() => run(f, { ...f.command, entryChoice: { kind: 'resource-allocation', gains: { orirock: 5, originium: 0, iron: 0 } } }), 'ENTRY_CHOICE');
  });
  it.each(['CP-2-2', 'CP-3-1', 'CP-3-3', 'CP-4-2'])('urbanization counts itself after being placed at %s', cell => {
    const f = fixture('FAC-005'); f.command.cellId = cell;
    const result = run(f); expect(result.receipt.entryGains).toEqual([{ asset: 'columbia-voucher', amount: 4 }]);
  });
  it('urbanization counts all occupied core neighbors, ignoring diagonals and its own remote position', () => {
    const f = fixture('FAC-005'); existing(f, 'FAC-010', 'red', 'CP-2-2'); existing(f, 'FAC-011', 'blue', 'CP-3-1'); existing(f, 'FAC-012', 'yellow', 'CP-2-1');
    const result = run(f); expect(result.receipt.entryGains).toEqual([{ asset: 'columbia-voucher', amount: 8 }]);
  });
  it('industrial discount counts distinct pre-existing non-rainbow colors, not copies or its own newly placed color', () => {
    const f = fixture('FAC-009'); existing(f, 'FAC-010', 'red', 'CP-1-2'); existing(f, 'FAC-011', 'blue', 'CP-1-3'); existing(f, 'FAC-013', 'rainbow', 'CP-2-1');
    const q = getFacilityConstructionQuote(f.state, f.definition, f.context, f.command);
    expect(q.orirockDiscount).toBe(2); expect(q.costs).toEqual([{ asset: 'orirock', amount: 2 }, { asset: 'originium', amount: 3 }, { asset: 'columbia-voucher', amount: 2 }]);
    expect(run(f).state.position.players.p1!.balances.orirock).toBe(28);
  });
  it('industrial three-color discount never changes vouchers and does not apply to other facilities', () => {
    const f = fixture('FAC-009'); existing(f, 'FAC-010', 'red', 'CP-1-2'); existing(f, 'FAC-011', 'blue', 'CP-1-3'); existing(f, 'FAC-012', 'yellow', 'CP-2-1');
    expect(getFacilityConstructionQuote(f.state, f.definition, f.context, f.command).costs[0]).toEqual({ asset: 'orirock', amount: 1 });
    f.command.paymentMode = 'vouchers'; expect(getFacilityConstructionQuote(f.state, f.definition, f.context, f.command).costs).toEqual([{ asset: 'columbia-voucher', amount: 24 }]);
    const g = fixture('FAC-010'); existing(g, 'FAC-009', 'yellow', 'CP-1-2');
    expect(getFacilityConstructionQuote(g.state, g.definition, g.context, g.command).orirockDiscount).toBe(0);
  });
  it('requires all costs before crediting an otherwise sufficient future entry reward', () => {
    const f = fixture('FAC-010'); f.state.position.players.p1!.balances.iron = 0;
    expect(getFacilityConstructionQuote(f.state, f.definition, f.context, f.command).canPay).toBe(false);
    const before = JSON.stringify(f.state); errorCode(() => run(f), 'CANNOT_PAY'); expect(JSON.stringify(f.state)).toBe(before);
  });
});

describe('atomic failures, unique restrictions and outer-caller responsibilities', () => {
  it('blocks duplicate unique construction on the actor, while allowing another player to own the same type', () => {
    const f = fixture(); existing(f, 'FAC-013', 'rainbow', 'CP-1-2'); errorCode(() => run(f), 'UNIQUE_FACILITY');
    const g = fixture(); existing(g, 'FAC-013', 'rainbow', 'CP-1-2', 1); expect(run(g).state.position.players.p1!.score).toBe(3);
  });
  it('rejects an already-invalid duplicate unique or unpictured built variant snapshot', () => {
    const f = fixture(); existing(f, 'FAC-013', 'rainbow', 'CP-1-2'); existing(f, 'FAC-013', 'rainbow', 'CP-1-3');
    expect(validateFacilityConstructionPosition(f.state, f.definition).success).toBe(false);
    const g = fixture(); existing(g, 'FAC-010', 'blue', 'CP-1-2'); errorCode(() => run(g), 'POSITION_INVALID');
  });
  it.each(['game', 'supply-version', 'panel-version', 'actor', 'hidden-card', 'occupied', 'unknown-cell', 'fee-override', 'actor-override'] as const)('rejects %s without mutations', reason => {
    const f = fixture(); let payload: unknown = f.command;
    if (reason === 'game') f.context.gameId = 'other-game';
    if (reason === 'supply-version') f.context.expectedSupplyRevision = 1;
    if (reason === 'panel-version') f.context.expectedPanelRevision = 1;
    if (reason === 'actor') f.context.actorId = 'outsider';
    if (reason === 'hidden-card') f.command.cardId = f.state.supply.drawPile[0]!;
    if (reason === 'occupied') f.command.cellId = 'CP-3-2';
    if (reason === 'unknown-cell') f.command.cellId = 'CP-5-1';
    if (reason === 'fee-override') payload = { ...f.command, paid: 0 };
    if (reason === 'actor-override') payload = { ...f.command, actorId: 'p2' };
    const before = JSON.stringify(f.state);
    errorCode(() => run(f, payload), reason === 'game' ? 'GAME_REFERENCE' : reason === 'actor' ? 'ACTOR_REFERENCE' : ['fee-override', 'actor-override'].includes(reason) ? 'COMMAND_SCHEMA' : 'PLACEMENT_INVALID');
    expect(JSON.stringify(f.state)).toBe(before);
  });
  it('rejects malformed contexts, corrupt positions, mismatched game/player sets and replaying the old versions', () => {
    const f = fixture(); errorCode(() => settleFacilityConstruction(f.state, f.definition, { ...f.context, expectedSupplyRevision: -1 }, f.command), 'CONTEXT_SCHEMA');
    const result = run(f); errorCode(() => settleFacilityConstruction(result.state, f.definition, f.context, f.command), 'PLACEMENT_INVALID');
    const g = fixture(); g.state.supply.gameId = 'different-game'; errorCode(() => run(g), 'POSITION_INVALID');
    const h = fixture(); h.state.position.players.p1!.balances.orirock = -1; errorCode(() => run(h), 'POSITION_INVALID');
    const different = fixture('FAC-013', 'rainbow', 2); expect(validateFacilityConstructionPosition(f.state, different.definition).success).toBe(false);
  });
  it.each(['score', 'gain', 'panel-version', 'supply-version'] as const)('rolls back all effects on %s overflow', kind => {
    const f = fixture(kind === 'gain' ? 'FAC-010' : 'FAC-013');
    if (kind === 'score') f.state.position.players.p1!.score = Number.MAX_SAFE_INTEGER;
    if (kind === 'gain') { f.command.paymentMode = 'vouchers'; f.state.position.players.p1!.balances.iron = Number.MAX_SAFE_INTEGER; }
    if (kind === 'panel-version') { f.state.panels[0]!.revision = Number.MAX_SAFE_INTEGER; f.context.expectedPanelRevision = Number.MAX_SAFE_INTEGER; }
    if (kind === 'supply-version') { f.state.supply.revision = Number.MAX_SAFE_INTEGER; f.context.expectedSupplyRevision = Number.MAX_SAFE_INTEGER; }
    const before = JSON.stringify(f.state); errorCode(() => run(f), kind === 'score' ? 'SCORE_OVERFLOW' : kind === 'gain' ? 'BALANCE_OVERFLOW' : 'VERSION_OVERFLOW');
    expect(JSON.stringify(f.state)).toBe(before);
  });
  it('blocks incomplete/refill-exhausted supply without consuming any resources or cards', () => {
    const f = fixture(); f.state.supply.returnedToBox.push(...f.state.supply.drawPile.splice(0));
    const before = JSON.stringify(f.state); errorCode(() => run(f), 'REFILL_RULE_UNRESOLVED'); expect(JSON.stringify(f.state)).toBe(before);
    const g = fixture(); g.state.supply.returnedToBox.push(g.state.supply.supply.pop()!); errorCode(() => run(g), 'SUPPLY_NOT_READY');
  });
  it.each([2, 3, 4])('preserves the full %i-player physical ledger and panel set', count => {
    const f = fixture('FAC-013', 'rainbow', count), result = run(f);
    expect(validateFacilityPanelSet(result.state.panels, result.state.supply).success).toBe(true);
    expect(result.state.position.players).toHaveProperty('p1');
  });
  it('binds the actor by ID even if ownership and panel arrays are reordered', () => {
    const f = fixture(); f.state.supply.playerHoldings.reverse(); f.state.panels.reverse();
    const result = run(f);
    expect(result.state.panels.find(row => row.playerId === 'p1')!.placements).toContainEqual({ cardId: f.cardId, cellId: 'CP-1-1' });
    expect(result.state.supply.playerHoldings.find(row => row.playerId === 'p1')!.cardIds).toContain(f.cardId);
    expect(result.state.position.players.p1!.score).toBe(3); expect(result.state.position.players.p3!.score).toBe(0);
  });
});
