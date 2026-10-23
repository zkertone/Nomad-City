import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import {
  FOUNDERS_FACILITY_STOCK, FOUNDERS_FACILITY_FACES_HASH, FacilityConstructionError,
  getFacilityConstructionSupport, getFoundersFacilityFace, getFoundersPhysicalFacilityCard,
  settleFacilityConstruction, getFacilityConstructionQuote, facilityEntryChoiceSchema,
} from '../facilities/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects,
  applyRoundCommand, getRoundTurn, applyInfluenceCommand, applyBaseRoleCommand, getGamePosition,
  gameStateSchema, parseGameState, validateGameState, getMarkerLedger,
  applyConstructionCommand, getConstructionQuote, openHarvestPhase, applyHarvestCommand, finishManagedRound,
} from './index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';
const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = (state: GameState) => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const cardOf = (id: string) => FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === id && card.color === getFoundersFacilityFace(id).observedColor)!;
const zeroSales = { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 };
function roundSend(state: GameState, definition: GameDefinition, payload: Record<string, unknown>) {
  return applyRoundCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), ...payload });
}
function dispatchTurn(state: GameState, definition: GameDefinition) {
  state = roundSend(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction!.status === 'ready') state = applyInfluenceCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), type: 'finish-dispatch' });
  return roundSend(state, definition, { type: 'finish-player-turn' });
}
function fixture(facilityId = 'FAC-002', count = 3) {
  const setup = createPreEntryGame('facility-entries-test', seats.slice(0, count));
  const ids = (color: 'green' | 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id), expectedVersion: 0,
    greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (const [index, player] of seats.slice(0, count).entries()) {
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  // Explicit funding fixture for arithmetic boundaries; compiled check uses only earned entry/role income.
  const funded = gameStateSchema.parse(state);
  for (const player of Object.values(funded.players)) player.balances = { orirock: 30, originium: 30, iron: 30, 'columbia-voucher': 50, 'pure-originium': 2 };
  const cardId = cardOf(facilityId).id, deck = [cardId, ...ordinary.filter(id => id !== cardId)];
  state = beginRoundFlow(funded, setup.definition, { expectedVersion: funded.stateVersion, facilityDeckOrder: deck, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  state = enableBaseRoleEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  state = enableLiskarmEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  state = enableRemainingBaseRoleEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  while (state.roundFlow!.stage === 'role-removal') state = roundSend(state, setup.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply.find(id => id !== cardId) });
  while (state.roundFlow!.stage === 'role-placement') state = roundSend(state, setup.definition, { type: 'place-round-role', roleId: getRoundTurn(state, setup.definition).actorId === 'p1' ? 'ROLE-04' : 'ROLE-01' });
  state = roundSend(state, setup.definition, { type: 'choose-major-action', action: 'construct' });
  const board = loadFoundersBoard(count === 4 ? 'four-player' : 'three-player'), slots = Object.values(board.routes).flatMap(route => route.influenceSlotIds);
  return { definition: setup.definition, state, board, slots, facilityId, cardId };
}
type Fixture = ReturnType<typeof fixture>;
type MutableState = ReturnType<typeof gameStateSchema.parse>;
function command(f: Fixture, entryChoice: unknown, state: GameState = f.state, paymentMode = 'vouchers') {
  return { ...env(state), type: 'construct-facility', cardId: f.cardId, cellId: 'CP-1-1', paymentMode, entryChoice };
}
const run = (f: Fixture, choice: unknown, state: GameState = f.state, paymentMode = 'vouchers') => applyConstructionCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, command(f, choice, state, paymentMode));
function internal(f: Fixture, state: GameState = f.state) {
  return { bundle: { position: getGamePosition(state, f.definition), ...state.facilities! }, context: { gameId: state.gameId, actorId: 'p1', expectedSupplyRevision: state.facilities!.supply.revision, expectedPanelRevision: state.facilities!.panels.find(panel => panel.playerId === 'p1')!.revision } };
}
function settle(f: Fixture, choice: unknown, state: GameState = f.state, paymentMode = 'vouchers') {
  const p = internal(f, state); return settleFacilityConstruction(p.bundle, f.definition, p.context, { cardId: f.cardId, cellId: 'CP-1-1', paymentMode, entryChoice: choice });
}
function put(state: MutableState, slotId: string, owner = 'p1') {
  if (state.board.influenceBySlot[slotId] !== null) throw Error('Occupied fixture slot');
  const markerId = state.markerSupplyByPlayer[owner]!.shift(); if (!markerId) throw Error('Empty fixture supply');
  state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: owner }; return markerId;
}
function errorCode(fn: () => unknown, code: string) {
  try { fn(); throw Error('Expected construction rejection'); } catch (error) { expect(error).toBeInstanceOf(FacilityConstructionError); expect((error as FacilityConstructionError).code).toBe(code); }
}
const removal = (slotIds: readonly string[]) => ({ kind: 'remove-influence', slotIds });
const mercenary = (effect: 'replace' | 'remove', slotId?: string) => ({ kind: 'mercenary-influence', effect, ...(slotId === undefined ? {} : { slotId }) });
const sales = (amounts = zeroSales) => ({ kind: 'sell-resources', amounts });

function assertBuilt(f: Fixture, before: GameState, next: GameState) {
  const face = getFoundersFacilityFace(f.facilityId);
  expect(next.stateVersion).toBe(before.stateVersion + 1); expect(next.schemaVersion).toBe(before.schemaVersion);
  expect(next.construction).toMatchObject({ status: 'complete', constructionsCompleted: 1, builtCardId: f.cardId });
  expect(next.players.p1!.score).toBe(before.players.p1!.score + face.printedScore);
  expect(next.facilities!.panels[0]!.placements).toContainEqual({ cardId: f.cardId, cellId: 'CP-1-1' });
  expect(next.facilities!.panels[0]!.revision).toBe(before.facilities!.panels[0]!.revision + 1); expect(next.facilities!.supply.revision).toBe(before.facilities!.supply.revision + 1);
  expect(next.facilities!.supply.supply).toHaveLength(6); expect(next.facilities!.supply.drawPile).toHaveLength(before.facilities!.supply.drawPile.length - 1);
  expect(next.eventDecks).toEqual(before.eventDecks); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(f.definition.players.length * 30);
  expect(parseGameState(JSON.parse(JSON.stringify(next)), f.definition)).toEqual(next);
}

describe('source scope, runtime choices and construction quotes', () => {
  it('reports eleven complete pictured types and 26 physical cards while keeping the original face hash pinned', () => {
    const support = getFacilityConstructionSupport(); expect(support.supportedFacilityIds).toEqual(['FAC-001', 'FAC-002', 'FAC-003', 'FAC-005', 'FAC-006', 'FAC-008', 'FAC-009', 'FAC-010', 'FAC-011', 'FAC-012', 'FAC-013']);
    expect(support.supportedPhysicalCardIds).toHaveLength(26); expect(support.sourceHash).toBe(FOUNDERS_FACILITY_FACES_HASH); expect(support.allFacilitiesImplemented).toBe(false);
    expect(support.supportedPhysicalCardIds.filter(id => getFoundersPhysicalFacilityCard(id).facilityId === 'FAC-002')).toHaveLength(2);
    expect(support.supportedPhysicalCardIds.filter(id => getFoundersPhysicalFacilityCard(id).facilityId === 'FAC-003')).toHaveLength(3);
    expect(support.supportedPhysicalCardIds.filter(id => getFoundersPhysicalFacilityCard(id).facilityId === 'FAC-006')).toHaveLength(3);
  });
  it.each([['FAC-002', 'remove-influence', 18], ['FAC-003', 'mercenary-influence', 18], ['FAC-006', 'sell-resources', 6]] as const)('quotes %s without requiring a final choice or changing state', (id, kind, price) => {
    const f = fixture(id), before = structuredClone(f.state), p = internal(f); const quote = getFacilityConstructionQuote(p.bundle, f.definition, p.context, { cardId: f.cardId, cellId: 'CP-1-1', paymentMode: 'vouchers' });
    expect(quote).toMatchObject({ entryChoiceKind: kind, requiresResourceAllocation: false, costs: [{ asset: 'columbia-voucher', amount: price }], canPay: true }); expect(Object.isFrozen(quote)).toBe(true); expect(f.state).toEqual(before);
  });
  it.each(['FAC-002', 'FAC-003', 'FAC-006'])('requires the exact entry choice kind for %s', id => {
    const f = fixture(id); errorCode(() => run(f, undefined), 'ENTRY_CHOICE'); errorCode(() => run(f, { kind: 'resource-allocation', gains: { orirock: 5, originium: 0, iron: 0 } }), 'ENTRY_CHOICE');
  });
  it.each([removal(['not-a-slot']), removal(['F-route-01:S1', 'F-route-02:S1', 'F-route-03:S1']), { kind: 'mercenary-influence', effect: 'deploy' }, { kind: 'sell-resources', amounts: { ...zeroSales, iron: -1 } }, { kind: 'sell-resources', amounts: { ...zeroSales, iron: 0.5 } }])('rejects malformed entry choices at runtime %j', input => { expect(facilityEntryChoiceSchema.safeParse(input).success).toBe(false); });
});

describe('Escort Dispatch Center: two ordered removals with real original ownership', () => {
  it.each([2, 3, 4])('settles both removals with payment, placement, score and refill in %i-player managed games', count => {
    const f = fixture('FAC-002', count), state = gameStateSchema.parse(f.state), [a, b] = f.slots, own = put(state, a!), other = put(state, b!, 'p2'), before = structuredClone(state);
    const next = run(f, removal([b!, a!]), state); assertBuilt(f, state, next);
    expect(next.board.influenceBySlot[a!]).toBe(null); expect(next.board.influenceBySlot[b!]).toBe(null); expect(next.markerSupplyByPlayer.p1).toContain(own); expect(next.markerSupplyByPlayer.p2).toContain(other);
    expect(next.players.p1!.balances['columbia-voucher']).toBe(32); expect(next.players.p2).toEqual(before.players.p2); expect(state).toEqual(before);
    const receipt = settle(f, removal([b!, a!]), state).receipt; expect(receipt.entryInfluenceChanges.map(change => change.markerId)).toEqual([other, own]); expect(receipt.entrySales).toEqual([]); expect(receipt.entryGains).toEqual([]);
  });
  it('removes only one when no board influence remains for the second step', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), a = f.slots[0]!, id = put(state, a, 'p2');
    const next = run(f, removal([a]), state); expect(next.markerSupplyByPlayer.p2).toContain(id); expect(Object.values(next.board.influenceBySlot).every(marker => marker === null)).toBe(true);
  });
  it('skips both impossible removals with an explicit empty choice and still completes construction', () => { const f = fixture(), next = run(f, removal([])); assertBuilt(f, f.state, next); expect(next.board).toEqual(f.state.board); });
  it('does not let the player omit the second still-executable removal', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); put(state, f.slots[0]!); put(state, f.slots[1]!, 'p2'); const before = structuredClone(state);
    errorCode(() => run(f, removal([f.slots[0]!]), state), 'REMOVAL_REQUIRED'); expect(state).toEqual(before);
  });
  it.each(['duplicate', 'empty', 'extra'] as const)('rejects %s targets without keeping the first removal, payment or card movement', reason => {
    const f = fixture(), state = gameStateSchema.parse(f.state), [a, b, c] = f.slots; put(state, a!, 'p2'); if (reason !== 'extra') put(state, b!);
    const before = structuredClone(state); errorCode(() => run(f, removal([a!, reason === 'duplicate' || reason === 'extra' ? a! : c!]), state), 'REMOVAL_TARGET'); expect(state).toEqual(before); expect(state.construction!.status).toBe('ready');
  });
  it('can remove opponent-city influence without moving cities or clearing other route slots', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), city = f.board.resourceNodes['A-02']!.influenceSlotIds, a = put(state, city[0]!, 'p2'), b = put(state, city[1]!, 'p2'), kept = put(state, f.slots[0]!, 'p2');
    const next = run(f, removal(city), state); expect(next.markerSupplyByPlayer.p2).toEqual(expect.arrayContaining([a, b])); expect(next.board.influenceBySlot[f.slots[0]!]!.markerId).toBe(kept); expect(next.board.cityNodeByPlayer).toEqual(state.board.cityNodeByPlayer);
  });
  it('can remove on a red-associated route before resource-node exploration opens', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), slot = f.board.routes['F-route-01']!.influenceSlotIds[0]!; put(state, slot, 'p2'); expect(run(f, removal([slot]), state).board.influenceBySlot[slot]).toBe(null);
  });
});

describe('Mercenary Command: explicit replacement OR removal without role costs', () => {
  it.each([2, 3, 4])('replaces one opponent route influence for %i players, charging only construction', count => {
    const f = fixture('FAC-003', count), state = gameStateSchema.parse(f.state), a = f.slots[0]!, old = put(state, a, 'p2'), own = state.markerSupplyByPlayer.p1![0]!, before = structuredClone(state);
    const next = run(f, mercenary('replace', a), state); assertBuilt(f, state, next); expect(next.players.p1!.balances['columbia-voucher']).toBe(32); expect(next.board.influenceBySlot[a]).toEqual({ markerId: own, ownerPlayerId: 'p1' }); expect(next.markerSupplyByPlayer.p2).toContain(old); expect(state).toEqual(before);
    expect(settle(f, mercenary('replace', a), state).receipt.entryInfluenceChanges).toEqual([{ kind: 'remove', slotId: a, markerId: old, ownerPlayerId: 'p2' }, { kind: 'place', slotId: a, markerId: own, ownerPlayerId: 'p1' }]);
  });
  it.each(['p1', 'p2'])('can choose removal of %s influence without replacing or taking supply', owner => {
    const f = fixture('FAC-003'), state = gameStateSchema.parse(f.state), a = f.slots[0]!, marker = put(state, a, owner), before = structuredClone(state);
    const next = run(f, mercenary('remove', a), state); expect(next.board.influenceBySlot[a]).toBe(null); expect(next.markerSupplyByPlayer[owner]).toContain(marker); if (owner !== 'p1') expect(next.markerSupplyByPlayer.p1).toEqual(before.markerSupplyByPlayer.p1);
  });
  it('removes at an opposing city but cannot place its own marker there', () => {
    const f = fixture('FAC-003'), state = gameStateSchema.parse(f.state), a = f.board.resourceNodes['A-02']!.influenceSlotIds[0]!, marker = put(state, a, 'p2'); const next = run(f, mercenary('replace', a), state);
    expect(next.board.influenceBySlot[a]).toBe(null); expect(next.markerSupplyByPlayer.p2).toContain(marker); expect(next.markerSupplyByPlayer.p1).toEqual(state.markerSupplyByPlayer.p1); expect(settle(f, mercenary('replace', a), state).receipt.entryInfluenceChanges).toHaveLength(1);
  });
  it('with empty own supply, removes the opponent but does not fabricate a placement', () => {
    const f = fixture('FAC-003'), state = gameStateSchema.parse(f.state), a = f.slots[0]!, marker = put(state, a, 'p2');
    for (const slot of f.slots.slice(1)) { if (!state.markerSupplyByPlayer.p1!.length) break; put(state, slot); }
    expect(state.markerSupplyByPlayer.p1).toHaveLength(0); const next = run(f, mercenary('replace', a), state); expect(next.board.influenceBySlot[a]).toBe(null); expect(next.markerSupplyByPlayer.p1).toHaveLength(0); expect(next.markerSupplyByPlayer.p2).toContain(marker);
  });
  it('can replace its own marker even with empty supply because removal returns it first', () => {
    const f = fixture('FAC-003'), state = gameStateSchema.parse(f.state);
    for (const slot of f.slots) { if (!state.markerSupplyByPlayer.p1!.length) break; put(state, slot); }
    const a = f.slots[0]!, marker = state.board.influenceBySlot[a]!.markerId, next = run(f, mercenary('replace', a), state);
    expect(next.board.influenceBySlot[a]!.markerId).toBe(marker); expect(next.markerSupplyByPlayer.p1).toHaveLength(0); expect(settle(f, mercenary('replace', a), state).receipt.entryInfluenceChanges.map(change => change.kind)).toEqual(['remove', 'place']);
  });
  it.each(['replace', 'remove'] as const)('skips an impossible %s only when no board influence exists', effect => { const f = fixture('FAC-003'), next = run(f, mercenary(effect)); assertBuilt(f, f.state, next); expect(next.board).toEqual(f.state.board); });
  it.each(['replace', 'remove'] as const)('requires a target for executable %s and rejects empty slots', effect => {
    const f = fixture('FAC-003'), state = gameStateSchema.parse(f.state); put(state, f.slots[0]!, 'p2'); const before = structuredClone(state);
    errorCode(() => run(f, mercenary(effect), state), effect === 'replace' ? 'REPLACEMENT_REQUIRED' : 'REMOVAL_REQUIRED'); errorCode(() => run(f, mercenary(effect, f.slots[1]), state), effect === 'replace' ? 'REPLACEMENT_TARGET' : 'REMOVAL_TARGET'); expect(state).toEqual(before);
  });
  it('does not execute both alternatives or accept a client-chosen fee waiver', () => {
    const f = fixture('FAC-003'); errorCode(() => run(f, { ...mercenary('replace'), effect: 'both' }), 'COMMAND_SCHEMA'); errorCode(() => run(f, { ...mercenary('replace'), free: true }), 'COMMAND_SCHEMA');
  });
});

describe('Trade District: pay first, then voluntary quantities at the exact printed table', () => {
  it.each([['orirock', 3], ['originium', 3], ['iron', 4], ['pure-originium', 15]] as const)('sells %s for %i each without changing any opponent', (asset, rate) => {
    const f = fixture('FAC-006'), amounts = { ...zeroSales, [asset]: 2 }, next = run(f, sales(amounts)); assertBuilt(f, f.state, next);
    expect(next.players.p1!.balances[asset]).toBe(f.state.players.p1!.balances[asset] - 2); expect(next.players.p1!.balances['columbia-voucher']).toBe(44 + 2 * rate);
    expect(next.players.p2).toEqual(f.state.players.p2); expect(next.players.p3).toEqual(f.state.players.p3);
    const receipt = settle(f, sales(amounts)).receipt; expect(receipt.entrySales).toEqual([{ asset, amount: 2, unitPrice: rate, proceeds: 2 * rate }]); expect(receipt.entryGains).toEqual([{ asset: 'columbia-voucher', amount: 2 * rate }]); expect(receipt.entryInfluenceChanges).toEqual([]);
  });
  it('sells several resources together or explicitly sells zero of every kind', () => {
    const f = fixture('FAC-006'), next = run(f, sales({ orirock: 1, originium: 2, iron: 3, 'pure-originium': 1 })); expect(next.players.p1!.balances).toEqual({ orirock: 29, originium: 28, iron: 27, 'pure-originium': 1, 'columbia-voucher': 80 });
    const zero = run(f, sales()); expect(zero.players.p1!.balances).toEqual({ ...f.state.players.p1!.balances, 'columbia-voucher': 44 }); expect(settle(f, sales()).receipt.entrySales).toEqual([]);
  });
  it.each(['resources', 'vouchers'])('uses only the resources remaining after %s payment', paymentMode => {
    const f = fixture('FAC-006'), state = gameStateSchema.parse(f.state); state.players.p1!.balances.orirock = 1; state.players.p1!.balances.iron = 1;
    const choice = sales({ ...zeroSales, orirock: 1, iron: 1 });
    if (paymentMode === 'resources') errorCode(() => run(f, choice, state, paymentMode), 'INSUFFICIENT_RESOURCE');
    else expect(run(f, choice, state, paymentMode).players.p1!.balances['columbia-voucher']).toBe(51);
    const noSales = run(f, sales(), state, 'resources'); expect(noSales.players.p1!.balances.orirock).toBe(0); expect(noSales.players.p1!.balances.iron).toBe(0); expect(noSales.players.p1!.balances['columbia-voucher']).toBe(50);
  });
  it('cannot use prospective sale income to pay the construction fee', () => {
    const f = fixture('FAC-006'), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 5; const before = structuredClone(state);
    expect(getConstructionQuote(state, f.definition, { authenticatedPlayerId: 'p1' }, command(f, sales({ ...zeroSales, iron: 2 }), state)).canPay).toBe(false);
    errorCode(() => run(f, sales({ ...zeroSales, iron: 2 }), state), 'CANNOT_PAY'); expect(state).toEqual(before);
  });
  it('sells only the selected quantities, refuses overselling and does not silently reduce a requested amount', () => {
    const f = fixture('FAC-006'), before = structuredClone(f.state); errorCode(() => run(f, sales({ ...zeroSales, iron: 31 })), 'INSUFFICIENT_RESOURCE'); expect(f.state).toEqual(before);
    expect(run(f, sales({ ...zeroSales, iron: 4 })).players.p1!.balances.iron).toBe(26);
  });
  it.each(['proceeds', 'sum', 'balance'] as const)('rolls back costs, card, score, refill and all resources on %s overflow', kind => {
    const f = fixture('FAC-006'), state = gameStateSchema.parse(f.state); let amounts = { ...zeroSales };
    if (kind === 'proceeds') { state.players.p1!.balances['pure-originium'] = Number.MAX_SAFE_INTEGER; amounts['pure-originium'] = Number.MAX_SAFE_INTEGER; }
    if (kind === 'sum') { amounts.orirock = Math.floor(Number.MAX_SAFE_INTEGER / 3); amounts.iron = Math.floor(Number.MAX_SAFE_INTEGER / 4); state.players.p1!.balances.orirock = amounts.orirock; state.players.p1!.balances.iron = amounts.iron; }
    if (kind === 'balance') { state.players.p1!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER; amounts.iron = 2; }
    const before = structuredClone(state); errorCode(() => run(f, sales(amounts), state), 'BALANCE_OVERFLOW'); expect(state).toEqual(before);
  });
  it.each(['unitPrice', 'recipientPlayerId', 'proceeds', 'canSkip'] as const)('rejects client authority field %s', key => { const f = fixture('FAC-006'); errorCode(() => run(f, { ...sales(), [key]: 0 }), 'COMMAND_SCHEMA'); });
});

describe('full construction atomicity, permissions, save formats and managed-round continuation', () => {
  it.each(['FAC-002', 'FAC-003', 'FAC-006'])('pays the exact resource alternative and printed points for %s', id => {
    const f = fixture(id), choice = id === 'FAC-002' ? removal([]) : id === 'FAC-003' ? mercenary('remove') : sales(), next = run(f, choice, f.state, 'resources');
    const expected = id === 'FAC-002' ? { orirock: 28, originium: 28, iron: 28, 'columbia-voucher': 50, 'pure-originium': 2 } : id === 'FAC-003' ? { orirock: 28, originium: 30, iron: 28, 'columbia-voucher': 46, 'pure-originium': 2 } : { orirock: 29, originium: 30, iron: 29, 'columbia-voucher': 50, 'pure-originium': 2 };
    expect(next.players.p1!.balances).toEqual(expected); expect(next.players.p1!.score - f.state.players.p1!.score).toBe(id === 'FAC-003' ? 1 : 0); assertBuilt(f, f.state, next);
  });
  it.each(['game', 'stale', 'actor', 'payload-actor', 'score-marker', 'supply-marker'] as const)('refuses %s without changing any fact or consuming the construction', problem => {
    const f = fixture(), state = gameStateSchema.parse(f.state); put(state, f.slots[0]!); const payload: Record<string, unknown> = command(f, removal([f.slots[0]!]), state); let actor = 'p1', expected = 'COMMAND_SCHEMA';
    if (problem === 'game') { payload.gameId = 'other'; expected = 'GAME_REFERENCE'; }
    if (problem === 'stale') { payload.expectedVersion = 0; expected = 'STALE_VERSION'; }
    if (problem === 'actor') { actor = 'p2'; expected = 'WRONG_ACTOR'; }
    if (problem === 'payload-actor') payload.actorId = 'p2';
    if (problem === 'score-marker') payload.entryChoice = removal([state.players.p2!.scoreMarkerId]);
    if (problem === 'supply-marker') payload.entryChoice = removal([state.markerSupplyByPlayer.p2![0]!]);
    const before = structuredClone(state); errorCode(() => applyConstructionCommand(state, f.definition, { authenticatedPlayerId: actor }, payload), expected); expect(state).toEqual(before);
  });
  it('rejects old command replay and a second build at the new version', () => {
    const f = fixture('FAC-006'), next = run(f, sales()); errorCode(() => applyConstructionCommand(next, f.definition, { authenticatedPlayerId: 'p1' }, command(f, sales())), 'STALE_VERSION'); errorCode(() => run(f, sales(), next), 'ACTION_STAGE');
  });
  it.each(['1.6.0', '1.7.0', '1.8.0', '1.9.0', '1.10.0'] as const)('preserves existing %s format without a new persisted entry ledger', format => {
    const f = fixture('FAC-003'), state = gameStateSchema.parse(f.state); state.schemaVersion = format;
    if (format !== '1.10.0') delete state.roundFlow!.completedMajorAction;
    if (format === '1.6.0') delete state.roundFlow;
    if (format === '1.7.0') for (const role of state.roundFlow!.rolesByPlayer) delete role.used;
    const next = run(f, mercenary('remove'), state); expect(next.schemaVersion).toBe(format); expect(validateGameState(next, f.definition).success).toBe(true); expect(next).not.toHaveProperty('facilityEntry');
  });
  it('does not call a missing entry handler or permit unpictured variants after capability expansion', () => {
    const f = fixture('FAC-004'); errorCode(() => run(f, removal([])), 'UNSUPPORTED_ENTRY_EFFECT');
    const g = fixture('FAC-010'), state = gameStateSchema.parse(g.state), supply = state.facilities!.supply, blue = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-010' && card.color === 'blue')!.id;
    const at = supply.drawPile.indexOf(blue); const replaced = supply.supply[0]!; supply.supply[0] = blue; supply.drawPile[at] = replaced;
    errorCode(() => applyConstructionCommand(state, g.definition, { authenticatedPlayerId: 'p1' }, { ...command(g, undefined, state), cardId: blue }), 'UNCONFIRMED_COLOR_VARIANT');
  });
  it.each([2, 3, 4])('keeps the new built facility valid through role use, both cycles, harvest and the next round for %i players', count => {
    const f = fixture('FAC-003', count), built = run(f, mercenary('remove'));
    const afterRole = applyBaseRoleCommand(built, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(built), type: 'use-base-role', roleId: 'ROLE-04', mode: 'scheme', schemeChoice: { kind: 'forced-sale', asset: 'iron' } });
    expect(afterRole.roundFlow!.completedMajorAction).toBe('construct'); expect(afterRole.construction).toBeUndefined(); let state = roundSend(afterRole, f.definition, { type: 'finish-player-turn' });
    while (state.roundFlow!.stage === 'player-actions') state = dispatchTurn(state, f.definition);
    state = openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: 1 });
    for (const player of f.definition.players) state = applyHarvestCommand(state, f.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
    const next = finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }); expect(next.roundFlow!.roundNumber).toBe(2); expect(next.schemaVersion).toBe('1.10.0'); expect(next.facilities!.panels[0]!.placements).toContainEqual({ cardId: f.cardId, cellId: 'CP-1-1' }); expect(validateGameState(next, f.definition).success).toBe(true);
  });
});
