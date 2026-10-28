import { describe, expect, it } from 'vitest';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_FACILITY_STOCK, getFoundersFacilityFace, getFacilityConstructionSupport, FacilityConstructionError, settleFacilityConstruction } from '../facilities/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects,
  enableWarehouseEntries, enableNestedFacilityEntries, applyRoundCommand, getRoundTurn, applyConstructionCommand, applyNestedFacilityEntryCommand,
  getNestedFacilityEntryOptions, getPendingFacilityEventRequirements, parseGameState, gameStateSchema, validateGameState, FacilityEntryError,
  applyInfluenceCommand, openHarvestPhase, applyHarvestCommand, finishManagedRound, getMarkerLedger, applyBaseRoleCommand,
  applyWarehouseEntryCommand, getWarehouseEntryFinalSlotIds, openManagedCleanup, applyRoleCleanupCommand, getRoleCleanupOptions,
} from './index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';
const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = (state: GameState) => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const cardOf = (id: string) => FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === id && card.color === getFoundersFacilityFace(id).observedColor)!;
const deferred = { kind: 'deferred-entry' };
type Mutable = ReturnType<typeof gameStateSchema.parse>;
function round(state: GameState, definition: GameDefinition, payload: Record<string, unknown>) {
  return applyRoundCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), ...payload });
}
function fixture(id = 'FAC-016', count = 3, extras: string[] = []) {
  const setup = createPreEntryGame('remaining-facilities', seats.slice(0, count));
  const ids = (color: 'green' | 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(row => row.id), expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: seats[i]!.id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: seats[i]!.id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  const funded = gameStateSchema.parse(state);
  // Explicit arithmetic/board fixtures; the compiled smoke uses only actual entry and role income.
  for (const player of Object.values(funded.players)) player.balances = { orirock: 30, originium: 30, iron: 30, 'pure-originium': 2, 'columbia-voucher': 100 };
  const cardId = cardOf(id).id, priority = [cardId, ...extras.map(id => cardOf(id).id)];
  state = beginRoundFlow(funded, setup.definition, { expectedVersion: funded.stateVersion, facilityDeckOrder: [...priority, ...ordinary.filter(id => !priority.includes(id))], deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects, enableWarehouseEntries]) state = upgrade(state, setup.definition, { expectedVersion: state.stateVersion });
  const legacy = state; state = enableNestedFacilityEntries(state, setup.definition, { expectedVersion: state.stateVersion });
  while (state.roundFlow!.stage === 'role-removal') state = round(state, setup.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply.find(id => !priority.includes(id)) });
  while (state.roundFlow!.stage === 'role-placement') state = round(state, setup.definition, { type: 'place-round-role', roleId: 'ROLE-03' });
  state = round(state, setup.definition, { type: 'choose-major-action', action: 'construct' });
  return { state, definition: setup.definition, cardId, legacy, board: loadFoundersBoard(count === 4 ? 'four-player' : 'three-player') };
}
type Fixture = ReturnType<typeof fixture>;
function build(f: Fixture, state: GameState = f.state, cellId = 'CP-1-1', paymentMode = 'vouchers') {
  return applyConstructionCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'construct-facility', cardId: f.cardId, cellId, paymentMode, entryChoice: deferred });
}
function send(f: Fixture, state: GameState, payload: Record<string, unknown>, actor = 'p1') {
  return applyNestedFacilityEntryCommand(state, f.definition, { authenticatedPlayerId: actor }, { ...env(state), ...payload });
}
function addBuilt(state: Mutable, id: string, cellId: string, actor = 'p1', color = getFoundersFacilityFace(id).observedColor) {
  const card = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === id && card.color === color && !state.facilities!.supply.playerHoldings.some(row => row.cardIds.includes(card.id)))!;
  const supply = state.facilities!.supply;
  for (const zone of [supply.supply, supply.drawPile, supply.extensionReserve, supply.returnedToBox]) { const index = zone.indexOf(card.id); if (index >= 0) zone.splice(index, 1); }
  if (supply.supply.length < 6) supply.supply.push(supply.drawPile.shift()!);
  supply.playerHoldings.find(row => row.playerId === actor)!.cardIds.push(card.id);
  state.facilities!.panels.find(row => row.playerId === actor)!.placements.push({ cardId: card.id, cellId }); return card.id;
}
function put(state: Mutable, slot: string, actor = 'p2') { state.board.influenceBySlot[slot] = { markerId: state.markerSupplyByPlayer[actor]!.shift()!, ownerPlayerId: actor }; }
function code(fn: () => unknown, expected: string) {
  try { fn(); throw Error('Expected rejection'); } catch (error) { expect(error).toBeInstanceOf(Error); expect((error as { code: string }).code).toBe(expected); }
}
const saved = (state: GameState, definition: GameDefinition) => parseGameState(JSON.parse(JSON.stringify(state)), definition);
const mining = { kind: 'resource-allocation', gains: { orirock: 2, originium: 2, iron: 1 } };
function finishTurns(state: GameState, definition: GameDefinition) {
  if (state.phase === 'construction') state = round(state, definition, { type: 'finish-player-turn' });
  while (state.roundFlow!.stage === 'player-actions') {
    state = round(state, definition, { type: 'choose-major-action', action: 'dispatch' });
    if (state.influenceAction!.status === 'ready') state = applyInfluenceCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), type: 'finish-dispatch' });
    state = round(state, definition, { type: 'finish-player-turn' });
  }
  state = openHarvestPhase(state, definition, { expectedVersion: state.stateVersion, roundNumber: state.roundFlow!.roundNumber });
  for (const player of definition.players) state = applyHarvestCommand(state, definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return finishManagedRound(state, definition, { expectedVersion: state.stateVersion });
}

describe('complete pictured base facilities and explicit 1.12 upgrade', () => {
  it('reports sixteen ordinary types /41 physical cards and all confirmed colour variants', () => {
    const support = getFacilityConstructionSupport(); expect(support.supportedFacilityIds).toEqual(Array.from({ length: 16 }, (_, i) => `FAC-${String(i + 1).padStart(3, '0')}`));
    expect(support.supportedPhysicalCardIds).toHaveLength(41); expect(support.picturedOrdinaryTypesImplemented).toBe(true); expect(support.allFacilitiesImplemented).toBe(true);
  });
  it('upgrades without replacing facts, decks, role inventory or an existing action', () => {
    const f = fixture(); const next = enableNestedFacilityEntries(f.legacy, f.definition, { expectedVersion: f.legacy.stateVersion });
    expect(next.schemaVersion).toBe('1.12.0'); expect(next.stateVersion).toBe(f.legacy.stateVersion + 1); expect(next.board).toEqual(f.legacy.board); expect(next.players).toEqual(f.legacy.players); expect(next.facilities).toEqual(f.legacy.facilities); expect(next.roundFlow!.startingPlayerOverride).toBe(null);
    code(() => enableNestedFacilityEntries(next, f.definition, { expectedVersion: next.stateVersion }), 'FACILITY_FORMAT');
    code(() => enableNestedFacilityEntries(f.legacy, f.definition, { expectedVersion: 0 }), 'STALE_VERSION');
  });
  it.each(['FAC-004', 'FAC-007', 'FAC-014', 'FAC-015', 'FAC-016'])('rejects %s on old format before charging, then supports its real pending entry', id => {
    const f = fixture(id), old = gameStateSchema.parse(f.state); old.schemaVersion = '1.11.0'; delete old.roundFlow!.startingPlayerOverride;
    const before = structuredClone(old); code(() => build(f, old), 'FACILITY_FORMAT'); expect(old).toEqual(before);
    const next = build(f); expect(next.schemaVersion).toBe('1.12.0'); expect(next.construction!.constructionsCompleted).toBe(1); expect(validateGameState(next, f.definition).success).toBe(true);
  });
  it.each(['FAC-004', 'FAC-007', 'FAC-014', 'FAC-015', 'FAC-016'])('synchronous internal API cannot silently skip %s effects', id => {
    const f = fixture(id), state = f.state;
    expect(() => settleFacilityConstruction({ position: { gameId: state.gameId, board: state.board, players: state.players, markerSupplyByPlayer: state.markerSupplyByPlayer }, ...state.facilities! }, f.definition,
      { gameId: state.gameId, actorId: 'p1', expectedPanelRevision: 0, expectedSupplyRevision: state.facilities!.supply.revision }, { cardId: f.cardId, cellId: 'CP-1-1', paymentMode: 'vouchers', entryChoice: deferred })).toThrow(FacilityConstructionError);
  });
});

describe('logistics and the reserve-only extension', () => {
  it.each([2, 3, 4])('builds the pictured extension once, scores -1 and changes no market/deck/cost in %i players', count => {
    const f = fixture('FAC-004', count), started = build(f), reserve = started.facilities!.supply.extensionReserve, extension = cardOf('FAC-018').id;
    expect(started.players.p1!.score).toBe(2); expect(started.players.p1!.balances['columbia-voucher']).toBe(76); expect(started.construction!.status).toBe('entry-pending');
    const next = send(f, saved(started, f.definition), { type: 'build-logistics-extension', placement: { cardId: extension, cellId: 'CP-2-1' } });
    expect(next.players.p1!.score).toBe(1); expect(next.players.p1!.balances).toEqual(started.players.p1!.balances); expect(next.facilities!.supply.supply).toEqual(started.facilities!.supply.supply); expect(next.facilities!.supply.drawPile).toEqual(started.facilities!.supply.drawPile);
    expect(next.facilities!.supply.extensionReserve).toEqual(reserve.filter(id => id !== extension)); expect(next.construction!.status).toBe('complete'); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(count * 30);
    expect(finishTurns(next, f.definition).schemaVersion).toBe('1.12.0');
  });
  it('may decline the explicitly optional extension without consuming it', () => {
    const f = fixture('FAC-004'), state = build(f), next = send(f, state, { type: 'build-logistics-extension', placement: null });
    expect(next.construction!.status).toBe('complete'); expect(next.facilities).toEqual(state.facilities); expect(next.players).toEqual(state.players);
  });
  it.each(['already-owned', 'market', 'occupied', 'unknown-cell'])('rejects %s extension transaction without losing the committed logistics', problem => {
    const f = fixture('FAC-004'), state = build(f), before = structuredClone(state);
    const placement = { cardId: problem === 'already-owned' ? f.cardId : problem === 'market' ? state.facilities!.supply.supply[0]! : cardOf('FAC-018').id,
      cellId: problem === 'occupied' ? 'CP-3-2' : problem === 'unknown-cell' ? 'CP-9-9' : 'CP-2-1' };
    code(() => send(f, state, { type: 'build-logistics-extension', placement }), problem === 'already-owned' || problem === 'market' ? 'EXTENSION_SOURCE' : 'EXTENSION_CELL'); expect(state).toEqual(before);
  });
  it('does not permit ordinary construction from the extension reserve', () => {
    const f = fixture(); code(() => applyConstructionCommand(f.state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(f.state), type: 'construct-facility', cardId: cardOf('FAC-018').id, cellId: 'CP-1-1', paymentMode: 'vouchers' }), 'CARD_SOURCE');
  });
});

describe('engineering camp pays for an actual additional construction, with nested completion', () => {
  it('pays twice, refills twice and settles the child gain without another major-action grant', () => {
    const f = fixture('FAC-016', 3, ['FAC-008']), state = build(f); expect(state.players.p1!.score).toBe(-1);
    const next = send(f, saved(state, f.definition), { type: 'construct-entry-facility', cardId: cardOf('FAC-008').id, cellId: 'CP-2-1', paymentMode: 'vouchers', entryChoice: mining });
    expect(next.players.p1!.balances['columbia-voucher']).toBe(82); expect(next.players.p1!.balances.orirock).toBe(32); expect(next.players.p1!.balances.originium).toBe(32); expect(next.players.p1!.balances.iron).toBe(31);
    expect(next.facilities!.supply.drawPile).toHaveLength(f.state.facilities!.supply.drawPile.length - 2); expect(next.facilities!.supply.revision).toBe(state.facilities!.supply.revision + 1); expect(next.construction!.builtCardId).toBe(f.cardId); expect(next.construction!.constructionsCompleted).toBe(1); expect(next.construction!.status).toBe('complete');
    code(() => round(next, f.definition, { type: 'choose-major-action', action: 'construct' }), 'MAJOR_ACTION_USED');
  });
  it('uses the just-revealed refill as its child card, not a pre-refill fixed target', () => {
    const f = fixture(), mutable = gameStateSchema.parse(f.state), chosen = cardOf('FAC-011').id, pile = mutable.facilities!.supply.drawPile, market = mutable.facilities!.supply.supply;
    const index = market.indexOf(chosen); if (index >= 0) [market[index], pile[0]] = [pile[0]!, chosen]; else { pile.splice(pile.indexOf(chosen), 1); pile.unshift(chosen); }
    const state = build(f, mutable); expect(state.facilities!.supply.supply).toContain(chosen);
    const next = send(f, state, { type: 'construct-entry-facility', cardId: chosen, cellId: 'CP-2-1', paymentMode: 'vouchers' }); expect(next.players.p1!.balances.originium).toBe(36); expect(next.construction!.status).toBe('complete');
  });
  it('saves camp → logistics → extension, then unwinds both entries once', () => {
    const f = fixture('FAC-016', 3, ['FAC-004']), state = build(f);
    const child = send(f, state, { type: 'construct-entry-facility', cardId: cardOf('FAC-004').id, cellId: 'CP-2-1', paymentMode: 'vouchers', entryChoice: deferred });
    expect(child.construction!.entryStack).toHaveLength(2); expect(child.players.p1!.balances['columbia-voucher']).toBe(68); expect(child.players.p1!.score).toBe(1);
    code(() => round(child, f.definition, { type: 'finish-player-turn' }), 'ACTION_PENDING');
    const next = send(f, saved(child, f.definition), { type: 'build-logistics-extension', placement: { cardId: cardOf('FAC-018').id, cellId: 'CP-1-2' } }); expect(next.construction!.status).toBe('complete'); expect(next.players.p1!.score).toBe(0); expect(next.construction!.entryStack).toEqual([]);
  });
  it('camp → warehouse waits for paid exploration, event and final influence before completion', () => {
    const f = fixture('FAC-016', 3, ['FAC-001']); let state = build(f);
    state = send(f, state, { type: 'construct-entry-facility', cardId: cardOf('FAC-001').id, cellId: 'CP-2-1', paymentMode: 'vouchers', entryChoice: { kind: 'warehouse-entry' } });
    state = send(f, saved(state, f.definition), { type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-explore' } });
    state = send(f, saved(state, f.definition), { type: 'explore', nodeId: 'B-01', path: [{ routeId: 'R-route-02', toNodeId: 'B-01' }] });
    expect(state.players.p1!.balances['columbia-voucher']).toBe(81); const frame = state.construction!.entryStack!.at(-1)!; if (frame.kind !== 'exploration') throw Error('Expected exploration');
    expect(getPendingFacilityEventRequirements(state, f.definition, 'p1', `${frame.progress.cardId}:1`)).toBeDefined();
    state = send(f, saved(state, f.definition), { type: 'choose-exploration-event', choice: { choiceId: `${frame.progress.cardId}:1` } });
    const options = getNestedFacilityEntryOptions(state, f.definition, 'p1'); if (!('finalSlotIds' in options)) throw Error('Expected placement');
    state = send(f, saved(state, f.definition), { type: 'place-exploration-influence', slotId: options.finalSlotIds[0] }); expect(state.construction!.status).toBe('complete'); expect(state.construction!.entryStack).toEqual([]);
  });
  it('rejects unaffordable child construction and preserves the paid parent, refilled market and pending choice', () => {
    const f = fixture('FAC-016', 3, ['FAC-013']), mutable = gameStateSchema.parse(f.state); mutable.players.p1!.balances['columbia-voucher'] = 9;
    const state = build(f, mutable), before = structuredClone(state);
    code(() => send(f, state, { type: 'construct-entry-facility', cardId: cardOf('FAC-013').id, cellId: 'CP-2-1', paymentMode: 'vouchers' }), 'CANNOT_PAY'); expect(state).toEqual(before);
  });
  it('skips impossible extra building when the camp fills the last panel cell', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state);
    const candidates = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary' && card.id !== f.cardId && card.color === getFoundersFacilityFace(card.facilityId).observedColor && !getFoundersFacilityFace(card.facilityId).effect.uniqueMarker);
    const cells = ['CP-1-2', 'CP-1-3', 'CP-4-1', 'CP-2-1', 'CP-2-2', 'CP-2-3', 'CP-4-2', 'CP-3-1', 'CP-3-3', 'CP-4-3'];
    for (const [i, cell] of cells.entries()) addBuilt(state, candidates[i]!.facilityId, cell);
    expect(build(f, state).construction!.status).toBe('complete');
  });
});

describe('energy facility copies entry only, using actual logical orthogonal adjacency', () => {
  it.each([['FAC-010', 'iron', 4], ['FAC-011', 'originium', 6], ['FAC-012', 'orirock', 7]] as const)('copies %s entry with no second cost, print points or supply movement', (id, asset, gain) => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, id, 'CP-2-1'), state = build(f, raw);
    const next = send(f, saved(state, f.definition), { type: 'copy-facility-entry', targetCardId: target });
    expect(next.players.p1!.balances[asset]).toBe(state.players.p1!.balances[asset] + gain); expect(next.players.p1!.score).toBe(1); expect(next.facilities).toEqual(state.facilities); expect(next.construction!.status).toBe('complete');
  });
  it('does not turn an adjacent industrial continuous/self-construction discount into an entry', () => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, 'FAC-009', 'CP-2-1'), state = build(f, raw);
    expect(send(f, state, { type: 'copy-facility-entry', targetCardId: target }).players).toEqual(state.players);
  });
  it('copies mining with a fresh choice after construction, and checks a wrong effect kind', () => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, 'FAC-008', 'CP-2-1'); let state = build(f, raw);
    state = send(f, state, { type: 'copy-facility-entry', targetCardId: target }); expect(state.construction!.status).toBe('entry-pending');
    code(() => send(f, state, { type: 'resolve-facility-entry', entryChoice: { kind: 'remove-influence', slotIds: [] } }), 'ENTRY_CHOICE');
    const next = send(f, saved(state, f.definition), { type: 'resolve-facility-entry', entryChoice: mining }); expect(next.players.p1!.balances.orirock).toBe(32); expect(next.players.p1!.score).toBe(1); expect(next.construction!.status).toBe('complete');
  });
  it('copies logistics and builds its extension without paying or re-scoring logistics', () => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, 'FAC-004', 'CP-2-1'); let state = build(f, raw);
    state = send(f, state, { type: 'copy-facility-entry', targetCardId: target }); state = send(f, state, { type: 'build-logistics-extension', placement: { cardId: cardOf('FAC-018').id, cellId: 'CP-1-2' } });
    expect(state.players.p1!.balances['columbia-voucher']).toBe(77); expect(state.players.p1!.score).toBe(0); expect(state.construction!.status).toBe('complete');
  });
  it.each(['rainbow', 'diagonal', 'foreign', 'unknown'])('rejects %s copy target', problem => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state);
    const target = problem === 'unknown' ? 'FC:fake' : addBuilt(raw, problem === 'rainbow' ? 'FAC-015' : 'FAC-008', problem === 'diagonal' ? 'CP-2-2' : 'CP-2-1', problem === 'foreign' ? 'p2' : 'p1');
    // Keep one eligible neighbour so an invalid target can be rejected at an actual choice point.
    addBuilt(raw, 'FAC-010', 'CP-1-2'); const state = build(f, raw), before = structuredClone(state);
    code(() => send(f, state, { type: 'copy-facility-entry', targetCardId: target }), 'COPY_TARGET'); expect(state).toEqual(before);
  });
  it('automatically completes when there is no eligible adjacent non-rainbow facility', () => {
    const f = fixture('FAC-014'); expect(build(f).construction!.status).toBe('complete');
  });
});

describe('power system runs the entire free movement before extra route placement', () => {
  it.each([2, 3, 4])('clears exactly the chosen route/target, resolves event and places at target then route in %i players', count => {
    const f = fixture('FAC-007', count), raw = gameStateSchema.parse(f.state), route = f.board.routes['R-route-02']!, target = f.board.resourceNodes['B-01']!, unrelated = Object.values(f.board.routes).find(row => row.id !== route.id && row.influenceSlotIds.length)!;
    put(raw, route.influenceSlotIds[0]!); put(raw, target.influenceSlotIds[0]!); put(raw, unrelated.influenceSlotIds[0]!);
    raw.players.p1!.balances.originium = 0; let state = build(f, raw); const orig = state.players.p1!.balances.originium, supply = state.markerSupplyByPlayer.p2!.length;
    state = send(f, saved(state, f.definition), { type: 'move-city', nodeId: 'B-01', routeId: route.id });
    expect(state.board.cityNodeByPlayer.p1).toBe('B-01'); expect(state.markerSupplyByPlayer.p2).toHaveLength(supply + 2); expect(state.board.influenceBySlot[unrelated.influenceSlotIds[0]!]?.ownerPlayerId).toBe('p2'); expect(state.players.p1!.balances.originium).toBe(orig); expect(state.players.p1!.balances['columbia-voucher']).toBe(80);
    code(() => send(f, state, { type: 'place-entry-route-influence', slotId: route.influenceSlotIds[0] }), 'ENTRY_STAGE');
    const frame = state.construction!.entryStack!.at(-1)!; if (frame.kind !== 'city-move') throw Error('Expected move');
    state = send(f, saved(state, f.definition), { type: 'choose-city-move-event', choice: { choiceId: `${frame.progress.cardId}:1` } });
    let options = getNestedFacilityEntryOptions(state, f.definition, 'p1'); if (!('finalSlotIds' in options)) throw Error('Expected move options');
    state = send(f, saved(state, f.definition), { type: 'place-city-move-influence', slotId: options.finalSlotIds[0] });
    expect(state.construction!.status).toBe('entry-pending'); options = getNestedFacilityEntryOptions(state, f.definition, 'p1'); if (!('routeSlotIds' in options)) throw Error('Expected route');
    code(() => send(f, state, { type: 'place-entry-route-influence', slotId: target.influenceSlotIds[1] }), 'ROUTE_SLOT');
    state = send(f, saved(state, f.definition), { type: 'place-entry-route-influence', slotId: options.routeSlotIds[0] }); expect(state.construction!.status).toBe('complete'); expect(state.board.influenceBySlot[target.influenceSlotIds[0]!]?.ownerPlayerId).toBe('p1'); expect(state.board.influenceBySlot[route.influenceSlotIds[0]!]?.ownerPlayerId).toBe('p1');
  });
  it.each(['own-node', 'opponent-city', 'wrong-route', 'closed-red'])('rejects %s movement without charging or moving', problem => {
    const f = fixture('FAC-007'), raw = gameStateSchema.parse(f.state);
    if (problem === 'closed-red') { const cardId = raw.eventDecks!.yellow.shift()!, card = FOUNDERS_EVENT_CATALOG.cards.find(card => card.id === cardId)!; raw.board.resourceMarkerByNode['D-02'] = { markerDefinitionId: cardId, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount }; raw.board.cityNodeByPlayer.p1 = 'D-02'; }
    const state = build(f, raw); let nodeId = 'B-01', routeId = 'R-route-02';
    if (problem === 'own-node') nodeId = 'A-01'; if (problem === 'opponent-city') { nodeId = 'A-02'; routeId = 'R-route-01'; } if (problem === 'wrong-route') routeId = 'R-route-01'; if (problem === 'closed-red') { nodeId = 'F-01'; routeId = 'F-route-02'; }
    const before = structuredClone(state); code(() => send(f, state, { type: 'move-city', nodeId, routeId }), 'MOVE_TARGET'); expect(state).toEqual(before);
  });
  it('copying power also waits for movement/event/final/route and never gains its printed points twice', () => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, 'FAC-007', 'CP-2-1'); let state = build(f, raw);
    state = send(f, state, { type: 'copy-facility-entry', targetCardId: target }); expect(getNestedFacilityEntryOptions(state, f.definition, 'p1').kind).toBe('city-move'); expect(state.construction!.entryStack).toHaveLength(3); expect(state.players.p1!.score).toBe(1);
    expect(saved(state, f.definition)).toEqual(state);
  });
});

describe('council last-built override, round cleanup and replay boundaries', () => {
  it.each([2, 3, 4])('keeps the current order, grants the next start to the builder, and consumes the override once in %i players', count => {
    const f = fixture('FAC-015', count), state = build(f);
    expect(state.playerOrder).toEqual(f.state.playerOrder); expect(state.roundFlow!.startingPlayerOverride).toEqual({ playerId: 'p1', cardId: f.cardId }); expect(state.construction!.status).toBe('complete');
    const next = finishTurns(saved(state, f.definition), f.definition); expect(next.playerOrder![0]).toBe('p1'); expect(next.roundFlow!.startingPlayerOverride).toBe(null); expect(next.schemaVersion).toBe('1.12.0');
  });
  it('the actual later council by a different player replaces the previous effect without global uniqueness', () => {
    const f = fixture('FAC-015'), raw = gameStateSchema.parse(f.state), second = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-015' && card.id !== f.cardId)!.id;
    const pile = raw.facilities!.supply.drawPile; if (!raw.facilities!.supply.supply.includes(second)) { pile.splice(pile.indexOf(second), 1); const replaced = raw.facilities!.supply.supply.pop()!; pile.unshift(replaced); raw.facilities!.supply.supply.push(second); }
    let state = build(f, raw); state = round(state, f.definition, { type: 'finish-player-turn' }); state = round(state, f.definition, { type: 'choose-major-action', action: 'construct' });
    state = applyConstructionCommand(state, f.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'construct-facility', cardId: second, cellId: 'CP-1-1', paymentMode: 'vouchers', entryChoice: deferred });
    expect(state.roundFlow!.startingPlayerOverride).toEqual({ playerId: 'p2', cardId: second }); expect(finishTurns(state, f.definition).playerOrder).toEqual(['p2', 'p3', 'p1']);
  });
  it.each(['wrong-game', 'stale', 'other-player', 'free', 'premature-finish', 'second-major', 'role-interrupt'])('rejects %s while a real entry is pending', problem => {
    const f = fixture(), state = build(f), before = structuredClone(state), payload: Record<string, unknown> = { type: 'construct-entry-facility', cardId: state.facilities!.supply.supply[0], cellId: 'CP-2-1', paymentMode: 'vouchers' };
    if (problem === 'wrong-game') payload.gameId = 'other'; if (problem === 'stale') payload.expectedVersion = 0; if (problem === 'free') payload.free = true;
    if (problem === 'premature-finish' || problem === 'second-major') expect(() => round(state, f.definition, { type: problem === 'premature-finish' ? 'finish-player-turn' : 'choose-major-action', action: 'construct' })).toThrow();
    else if (problem === 'role-interrupt') expect(() => applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: state.facilities!.supply.supply[0] } })).toThrow();
    else code(() => send(f, state, payload, problem === 'other-player' ? 'p2' : 'p1'), problem === 'wrong-game' ? 'GAME_REFERENCE' : problem === 'stale' ? 'STALE_VERSION' : problem === 'free' ? 'COMMAND_SCHEMA' : 'WRONG_ACTOR');
    expect(state).toEqual(before);
  });
  it.each(['root', 'missing-child', 'actor', 'fake-complete', 'old-format', 'unknown-source', 'override'])('rejects forged %s stored continuation facts', problem => {
    const f = fixture('FAC-007'), state = gameStateSchema.parse(build(f));
    if (problem === 'root') state.construction!.entryStack![0]!.sourceCardId = cardOf('FAC-008').id;
    if (problem === 'missing-child') state.construction!.entryStack!.pop();
    if (problem === 'actor') { const frame = state.construction!.entryStack!.at(-1)!; if (frame.kind === 'city-move') frame.progress.actorId = 'ghost'; }
    if (problem === 'fake-complete') state.construction!.status = 'complete';
    if (problem === 'old-format') state.schemaVersion = '1.11.0';
    if (problem === 'unknown-source') state.construction!.entryStack![0]!.sourceCardId = 'FC:unknown';
    if (problem === 'override') state.roundFlow!.startingPlayerOverride = { playerId: 'p2', cardId: f.cardId };
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('reports errors as typed domain errors and leaves the original snapshot frozen', () => {
    const f = fixture(), state = build(f); expect(Object.isFrozen(state.construction!.entryStack)).toBe(true);
    expect(() => send(f, state, { type: 'build-logistics-extension', placement: null })).toThrow(FacilityEntryError);
  });
});

function reveal(state: Mutable, f: Fixture, nodeId: string): void {
  if (state.board.resourceMarkerByNode[nodeId]) return;
  const color = f.board.resourceNodes[nodeId]!.eventDeckColor, id = state.eventDecks![color].shift()!, card = FOUNDERS_EVENT_CATALOG.cards.find(card => card.id === id)!;
  state.board.resourceMarkerByNode[nodeId] = { markerDefinitionId: id, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
}
function resolveMove(f: Fixture, input: GameState): GameState {
  let state = input;
  const frame = state.construction!.entryStack!.at(-1)!; if (frame.kind !== 'city-move') throw Error('Expected move');
  if (frame.progress.status === 'event-choice') state = send(f, saved(state, f.definition), { type: 'choose-city-move-event', choice: { choiceId: `${frame.progress.cardId}:1` } });
  let options = getNestedFacilityEntryOptions(state, f.definition, 'p1');
  if ('finalSlotIds' in options && options.finalSlotIds.length) state = send(f, saved(state, f.definition), { type: 'place-city-move-influence', slotId: options.finalSlotIds[0] });
  if (state.construction!.status === 'entry-pending') {
    options = getNestedFacilityEntryOptions(state, f.definition, 'p1');
    if ('routeSlotIds' in options && options.routeSlotIds.length) state = send(f, saved(state, f.definition), { type: 'place-entry-route-influence', slotId: options.routeSlotIds[0] });
  }
  return state;
}
describe('complete nested effect regressions and physical bounds', () => {
  it.each([
    ['FAC-004', 0, 0, 0, 1, 2, 2], ['FAC-007', 0, 4, 2, 0, 0, 0], ['FAC-014', 2, 2, 3, 0, 0, 1], ['FAC-015', 4, 2, 0, 0, 0, 0], ['FAC-016', 2, 1, 0, 0, 0, -1],
  ] as const)('applies the exact independently transcribed resource cost and score for %s', (id, rock, ori, iron, pure, vouchers, score) => {
    const f = fixture(id), next = build(f, f.state, 'CP-1-1', 'resources');
    expect(next.players.p1!.balances).toEqual({ orirock: 30 - rock, originium: 30 - ori, iron: 30 - iron, 'pure-originium': 2 - pure, 'columbia-voucher': 100 - vouchers }); expect(next.players.p1!.score).toBe(score);
  });
  it('lets a camp child mining decision occur after the child refill is public', () => {
    const f = fixture('FAC-016', 3, ['FAC-008']), state = build(f), child = send(f, state, { type: 'construct-entry-facility', cardId: cardOf('FAC-008').id, cellId: 'CP-2-1', paymentMode: 'vouchers', entryChoice: deferred });
    expect(child.players.p1!.balances.orirock).toBe(30); expect(child.facilities!.supply.supply).toContain(state.facilities!.supply.drawPile[0]); expect(child.construction!.status).toBe('entry-pending');
    const next = send(f, saved(child, f.definition), { type: 'resolve-facility-entry', entryChoice: mining }); expect(next.players.p1!.balances.orirock).toBe(32); expect(next.construction!.status).toBe('complete');
  });
  it('can defer ordinary mining in 1.12 while rejecting the new choice on 1.11', () => {
    const f = fixture('FAC-008'), old = gameStateSchema.parse(f.state); old.schemaVersion = '1.11.0'; delete old.roundFlow!.startingPlayerOverride;
    code(() => build(f, old), 'FACILITY_FORMAT'); const next = send(f, build(f), { type: 'resolve-facility-entry', entryChoice: mining }); expect(next.construction!.status).toBe('complete');
  });
  it('finishes a copied power entry completely before unwinding its energy parent', () => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, 'FAC-007', 'CP-2-1'); let state = build(f, raw);
    state = send(f, state, { type: 'copy-facility-entry', targetCardId: target }); state = send(f, state, { type: 'move-city', nodeId: 'B-01', routeId: 'R-route-02' });
    state = resolveMove(f, state); expect(state.construction!.status).toBe('complete'); expect(state.players.p1!.balances['columbia-voucher']).toBe(77); expect(state.players.p1!.score).toBe(1); expect(state.construction!.entryStack).toEqual([]);
  });
  it('camp can build energy and copy an existing warehouse, preserving three levels of unfinished effects', () => {
    const f = fixture('FAC-016', 3, ['FAC-014']), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, 'FAC-001', 'CP-1-2'); let state = build(f, raw, 'CP-2-3');
    state = send(f, state, { type: 'construct-entry-facility', cardId: cardOf('FAC-014').id, cellId: 'CP-1-1', paymentMode: 'vouchers', entryChoice: deferred });
    state = send(f, state, { type: 'copy-facility-entry', targetCardId: target }); expect(state.construction!.entryStack).toHaveLength(3);
    const slots = Object.values(f.board.routes).flatMap(route => route.influenceSlotIds);
    state = send(f, saved(state, f.definition), { type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-influence', placeSlotId: slots[0], move: { sourceSlotId: slots[0], targetSlotId: slots[1] } } });
    expect(state.construction!.status).toBe('complete'); expect(state.players.p1!.balances['columbia-voucher']).toBe(69); expect(state.players.p1!.score).toBe(0); expect(state.board.influenceBySlot[slots[1]!]!.ownerPlayerId).toBe('p1');
  });
  it('moving to an already revealed node never draws or resolves its old event again', () => {
    const f = fixture('FAC-007'), raw = gameStateSchema.parse(f.state); reveal(raw, f, 'B-01'); const start = build(f, raw), decks = start.eventDecks;
    let state = send(f, start, { type: 'move-city', nodeId: 'B-01', routeId: 'R-route-02' }); const frame = state.construction!.entryStack!.at(-1)!;
    if (frame.kind !== 'city-move') throw Error('Expected move'); expect(frame.progress.cardId).toBe(null); expect(frame.progress.status).toBe('final-influence'); expect(state.eventDecks).toEqual(decks);
    code(() => send(f, state, { type: 'choose-city-move-event', choice: { choiceId: 'G01:1' } }), 'ACTION_STAGE'); state = resolveMove(f, state); expect(state.construction!.status).toBe('complete'); expect(state.eventDecks).toEqual(decks);
  });
  it('skips both placements only when the player truly has no remaining markers', () => {
    const f = fixture('FAC-007'), raw = gameStateSchema.parse(f.state); reveal(raw, f, 'B-01');
    const unused = Object.values(f.board.routes).filter(route => route.id !== 'R-route-02').flatMap(route => route.influenceSlotIds);
    while (raw.markerSupplyByPlayer.p1!.length) put(raw, unused.shift()!, 'p1');
    let state = build(f, raw); state = send(f, state, { type: 'move-city', nodeId: 'B-01', routeId: 'R-route-02' }); expect(state.construction!.status).toBe('complete'); expect(state.markerSupplyByPlayer.p1).toHaveLength(0);
  });
  it('a full chosen route preserves own influence and skips only the additional route placement', () => {
    const f = fixture('FAC-007'), raw = gameStateSchema.parse(f.state); reveal(raw, f, 'B-01'); const route = f.board.routes['R-route-02']!;
    for (const slot of route.influenceSlotIds) put(raw, slot, 'p1'); let state = build(f, raw); state = send(f, state, { type: 'move-city', nodeId: 'B-01', routeId: route.id });
    const target = f.board.resourceNodes['B-01']!.influenceSlotIds[0]; state = send(f, state, { type: 'place-city-move-influence', slotId: target }); expect(state.construction!.status).toBe('complete'); for (const slot of route.influenceSlotIds) expect(state.board.influenceBySlot[slot]!.ownerPlayerId).toBe('p1');
  });
  it('does not invent a second ordinary build without an extra-construction parent', () => {
    const f = fixture('FAC-004'), state = build(f); code(() => send(f, state, { type: 'construct-entry-facility', cardId: state.facilities!.supply.supply[0], cellId: 'CP-2-1', paymentMode: 'vouchers' }), 'ENTRY_STAGE');
  });
  it('rejects extension score underflow atomically, leaving it in reserve for a later valid request', () => {
    const f = fixture('FAC-004'), raw = gameStateSchema.parse(build(f)); raw.players.p1!.score = Number.MIN_SAFE_INTEGER; const before = structuredClone(raw);
    code(() => send(f, raw, { type: 'build-logistics-extension', placement: { cardId: cardOf('FAC-018').id, cellId: 'CP-2-1' } }), 'SCORE_OVERFLOW'); expect(raw).toEqual(before);
  });
  it('rejects overflow in a copied refinery without recharging the energy facility', () => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, 'FAC-011', 'CP-2-1'); raw.players.p1!.balances.originium = Number.MAX_SAFE_INTEGER;
    const state = build(f, raw), before = structuredClone(state); code(() => send(f, state, { type: 'copy-facility-entry', targetCardId: target }), 'BALANCE_OVERFLOW'); expect(state).toEqual(before);
  });
  it('rejects a replay with the updated version after a completed entry, too', () => {
    const f = fixture('FAC-004'), state = send(f, build(f), { type: 'build-logistics-extension', placement: null }); code(() => send(f, state, { type: 'build-logistics-extension', placement: null }), 'ENTRY_STAGE');
  });
  it('preserves the delayed council through role-after-action retirement and then the next action', () => {
    const f = fixture('FAC-015'); let state = build(f);
    state = applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: state.facilities!.supply.supply[0] } });
    expect(state.roundFlow!.completedMajorAction).toBe('construct'); expect(state.roundFlow!.startingPlayerOverride?.playerId).toBe('p1'); expect(state.construction).toBeUndefined();
    state = round(state, f.definition, { type: 'finish-player-turn' }); expect(finishTurns(state, f.definition).playerOrder![0]).toBe('p1');
  });
});


describe('upgrade and delayed-effect integration', () => {
  it('upgrades a real unresolved legacy warehouse without replaying payment, draw or entry', () => {
    const f = fixture('FAC-001'), old = gameStateSchema.parse(f.state); old.schemaVersion = '1.11.0'; delete old.roundFlow!.startingPlayerOverride;
    const started = applyConstructionCommand(old, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(old), type: 'construct-facility', cardId: f.cardId, cellId: 'CP-1-1', paymentMode: 'vouchers', entryChoice: { kind: 'warehouse-entry' } });
    const choosing = applyWarehouseEntryCommand(started, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(started), type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' }, warehouseExploration: { nodeId: 'B-01', path: [{ routeId: 'R-route-02', toNodeId: 'B-01' }] } });
    let state = enableNestedFacilityEntries(choosing, f.definition, { expectedVersion: choosing.stateVersion }); expect(state.players).toEqual(choosing.players); expect(state.eventDecks).toEqual(choosing.eventDecks); expect(state.facilities).toEqual(choosing.facilities); expect(state.construction).toEqual(choosing.construction);
    state = applyWarehouseEntryCommand(saved(state, f.definition), f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'choose-exploration-event', choice: { choiceId: `${state.construction!.warehouseEntry!.cardId}:1` } });
    state = applyWarehouseEntryCommand(saved(state, f.definition), f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'place-exploration-influence', slotId: getWarehouseEntryFinalSlotIds(state, f.definition, 'p1')[0] });
    expect(state.construction!.status).toBe('complete'); expect(state.schemaVersion).toBe('1.12.0'); expect(state.players.p1!.balances['columbia-voucher']).toBe(89);
  });
  it.each(['invalid-cell', 'missing-holding', 'duplicate-card'])('returns validation issues instead of throwing on %s in a pending copied entry', problem => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state); addBuilt(raw, 'FAC-008', 'CP-2-1'); const state = gameStateSchema.parse(build(f, raw));
    if (problem === 'invalid-cell') state.facilities!.panels[0]!.placements[0]!.cellId = 'CP-99-99';
    if (problem === 'missing-holding') state.facilities!.supply.playerHoldings[0]!.cardIds.pop();
    if (problem === 'duplicate-card') state.facilities!.supply.drawPile.push(f.cardId);
    expect(() => validateGameState(state, f.definition)).not.toThrow(); expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('council passes the marker only after a real Liskarm cleanup, using the old order for that cleanup', () => {
    const f = fixture('FAC-015'), raw = gameStateSchema.parse(f.state), roles = raw.roundFlow!.rolesByPlayer.find(row => row.playerId === 'p2')!;
    roles.hand.splice(roles.hand.indexOf('ROLE-01'), 1); roles.hand.push('ROLE-03'); roles.placed = 'ROLE-01';
    let state = build(f, raw); state = round(state, f.definition, { type: 'finish-player-turn' });
    const slots = Object.values(f.board.routes).flatMap(route => route.influenceSlotIds);
    state = applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: slots.slice(0, 2) } });
    while (state.roundFlow!.stage === 'player-actions') {
      state = round(state, f.definition, { type: 'choose-major-action', action: 'dispatch' });
      if (state.influenceAction!.status === 'ready') state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: getRoundTurn(state, f.definition).actorId! }, { ...env(state), type: 'finish-dispatch' });
      state = round(state, f.definition, { type: 'finish-player-turn' });
    }
    state = openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: 1 });
    for (const player of f.definition.players) state = applyHarvestCommand(state, f.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
    code(() => finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), 'CLEANUP_PENDING');
    state = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion }); expect(state.playerOrder).toEqual(['p1', 'p2', 'p3']); expect(getRoundTurn(state, f.definition).actorId).toBe('p2');
    state = applyRoleCleanupCommand(saved(state, f.definition), f.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'resolve-role-cleanup', slotId: getRoleCleanupOptions(state, f.definition, 'p2')[0] });
    state = finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }); expect(state.playerOrder![0]).toBe('p1'); expect(state.roundFlow!.startingPlayerOverride).toBe(null);
  });
});


it('skips a genuinely impossible free move without inventing a traversed route', () => {
  const f = fixture('FAC-007', 4), raw = gameStateSchema.parse(f.state);
  raw.roundFlow!.roundNumber = raw.construction!.roundNumber = 4;
  for (const [actor, node] of [['p1', 'G-04'], ['p2', 'G-03'], ['p3', 'F-03'], ['p4', 'F-01']]) { reveal(raw, f, node!); raw.board.cityNodeByPlayer[actor!] = node!; }
  const board = structuredClone(raw.board), next = build(f, raw); expect(next.construction!.status).toBe('complete'); expect(next.board).toEqual(board); expect(next.construction!.entryStack).toEqual([]);
});
it('rejects a persisted ready warehouse child whose exploration is actually unaffordable', () => {
  const f = fixture('FAC-016', 3, ['FAC-001']); let state = build(f);
  state = send(f, state, { type: 'construct-entry-facility', cardId: cardOf('FAC-001').id, cellId: 'CP-2-1', paymentMode: 'vouchers', entryChoice: deferred });
  state = send(f, state, { type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-explore' } });
  const raw = gameStateSchema.parse(state); raw.players.p1!.balances['columbia-voucher'] = 0; expect(validateGameState(raw, f.definition).success).toBe(false);
});


describe('confirmed colours through resumable facility entries', () => {
  it.each(['red', 'blue', 'yellow'] as const)('offers and builds the %s extension, then restores and advances the round', color => {
    const f = fixture('FAC-004'), state = build(f), extension = FOUNDERS_FACILITY_STOCK.cards.find(card => card.group === 'extension-hub' && card.color === color)!;
    const options = getNestedFacilityEntryOptions(state, f.definition, 'p1');
    expect('extensionCardIds' in options && options.extensionCardIds).toEqual(state.facilities!.supply.extensionReserve);
    const next = send(f, saved(state, f.definition), { type: 'build-logistics-extension', placement: { cardId: extension.id, cellId: 'CP-2-1' } });
    expect(next.players.p1!.score).toBe(1); expect(next.players.p1!.balances).toEqual(state.players.p1!.balances);
    expect(next.facilities!.supply.drawPile).toEqual(state.facilities!.supply.drawPile); expect(next.facilities!.supply.supply).toEqual(state.facilities!.supply.supply);
    expect(saved(next, f.definition)).toEqual(next); expect(finishTurns(next, f.definition).roundFlow!.roundNumber).toBe(2);
    code(() => send(f, next, { type: 'build-logistics-extension', placement: { cardId: extension.id, cellId: 'CP-1-2' } }), 'ENTRY_STAGE');
  });
  it.each([['FAC-010', 'blue', 'iron', 4], ['FAC-011', 'yellow', 'originium', 6], ['FAC-012', 'red', 'orirock', 7]] as const)('copies the %s/%s entry after save and restore', (id, color, asset, gain) => {
    const f = fixture('FAC-014'), raw = gameStateSchema.parse(f.state), target = addBuilt(raw, id, 'CP-2-1', 'p1', color), state = build(f, raw);
    const next = send(f, saved(state, f.definition), { type: 'copy-facility-entry', targetCardId: target });
    expect(next.players.p1!.balances[asset]).toBe(state.players.p1!.balances[asset] + gain); expect(next.facilities).toEqual(state.facilities);
    expect(next.players.p1!.score).toBe(state.players.p1!.score); expect(next.construction!.constructionsCompleted).toBe(1); expect(saved(next, f.definition)).toEqual(next);
  });
  it('extra construction offers and builds the newly confirmed blue iron card', () => {
    const f = fixture('FAC-016'), raw = gameStateSchema.parse(f.state), blue = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-010' && card.color === 'blue')!.id;
    const market = raw.facilities!.supply.supply, pile = raw.facilities!.supply.drawPile;
    const at = pile.indexOf(blue); if (at >= 0) [market[1], pile[at]] = [blue, market[1]!];
    const state = build(f, raw), options = getNestedFacilityEntryOptions(state, f.definition, 'p1');
    expect('constructionOptions' in options && options.constructionOptions.choices).toContainEqual({ cardId: blue, paymentMode: 'vouchers' });
    const next = send(f, saved(state, f.definition), { type: 'construct-entry-facility', cardId: blue, cellId: 'CP-2-1', paymentMode: 'vouchers' });
    expect(next.players.p1!.balances.iron).toBe(34); expect(next.players.p1!.balances['columbia-voucher']).toBe(77);
    expect(next.construction!.constructionsCompleted).toBe(1); expect(next.construction!.status).toBe('complete'); expect(saved(next, f.definition)).toEqual(next);
  });
});
