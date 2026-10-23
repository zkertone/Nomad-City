import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { FOUNDERS_FACILITY_STOCK, FacilityConstructionError, getFoundersFacilityFace, settleFacilityConstruction } from '../facilities/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects,
  applyRoundCommand, getRoundTurn, applyInfluenceCommand, applyBaseRoleCommand, getGamePosition, getMarkerLedger,
  gameStateSchema, parseGameState, validateGameState, applyConstructionCommand, getConstructionQuote,
  openHarvestPhase, applyHarvestCommand, finishManagedRound, openDeploymentWindow, openDispatchWindow, openExplorationWindow, openCityMoveWindow, openConstructionWindow,
  applyExplorationCommand, enableWarehouseEntries, applyWarehouseEntryCommand, getPendingWarehouseEventRequirements, getWarehouseEntryFinalSlotIds, WarehouseEntryError,
} from './index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';
const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = (state: GameState) => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const cardOf = (id: string) => FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === id && card.color === getFoundersFacilityFace(id).observedColor)!;
function roundSend(state: GameState, definition: GameDefinition, payload: Record<string, unknown>) {
  return applyRoundCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), ...payload });
}
function dispatchTurn(state: GameState, definition: GameDefinition) {
  state = roundSend(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction!.status === 'ready') state = applyInfluenceCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), type: 'finish-dispatch' });
  return roundSend(state, definition, { type: 'finish-player-turn' });
}
function fixture(facilityId = 'FAC-001', count = 3) {
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
  const legacy = state; state = enableWarehouseEntries(state, setup.definition, { expectedVersion: state.stateVersion });
  const board = loadFoundersBoard(count === 4 ? 'four-player' : 'three-player'), slots = Object.values(board.routes).flatMap(route => route.influenceSlotIds);
  return { definition: setup.definition, state, legacy, board, slots, facilityId, cardId };
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
function errorCode(fn: () => unknown, code: string, kind: typeof FacilityConstructionError | typeof WarehouseEntryError = FacilityConstructionError) {
  try { fn(); throw Error('Expected rejection'); } catch (error) { expect(error).toBeInstanceOf(kind); expect((error as { code: string }).code).toBe(code); }
}
const influence = (a?: string, source?: string, target?: string) => ({ kind: 'warehouse-influence', ...(a === undefined ? {} : { placeSlotId: a }), ...(source === undefined ? {} : { move: { sourceSlotId: source, targetSlotId: target } }) });
const targetPath = { nodeId: 'B-01', path: [{ routeId: 'R-route-02', toNodeId: 'B-01' }] };
function explore(f: Fixture, state: GameState = f.state, target = targetPath) {
  return applyConstructionCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...command(f, { kind: 'warehouse-explore' }, state), warehouseExploration: target });
}
const entry = (state: GameState) => state.construction!.warehouseEntry!;
function sendEntry(f: Fixture, state: GameState, payload: Record<string, unknown>, actor = 'p1') {
  return applyWarehouseEntryCommand(state, f.definition, { authenticatedPlayerId: actor }, { ...env(state), ...payload });
}
function choose(f: Fixture, state: GameState, suffix = '1') {
  const choiceId = `${entry(state).cardId}:${suffix}`, req = getPendingWarehouseEventRequirements(state, f.definition, 'p1', choiceId);
  return sendEntry(f, state, { type: 'choose-exploration-event', choice: { choiceId, ...(req.requiresCostDecision ? { costDecision: 'pay' } : {}), ...(req.legalInfluenceSlotIds.length ? { influenceSlotId: req.legalInfluenceSlotIds[0] } : {}) } });
}
function complete(f: Fixture, state: GameState) {
  state = choose(f, state);
  if (state.construction!.status === 'entry-pending') state = sendEntry(f, state, { type: 'place-exploration-influence', slotId: getWarehouseEntryFinalSlotIds(state, f.definition, 'p1')[0] });
  return state;
}

describe('warehouse explicit format, physical construction and immediate branch', () => {
  it.each([2, 3, 4])('upgrades %i players without resetting facts or the active construction', count => {
    const f = fixture('FAC-001', count), before = structuredClone(f.legacy), upgraded = enableWarehouseEntries(f.legacy, f.definition, { expectedVersion: f.legacy.stateVersion });
    expect(upgraded.schemaVersion).toBe('1.11.0'); expect(upgraded.stateVersion).toBe(before.stateVersion + 1); expect(upgraded.construction).toEqual(before.construction); expect(upgraded.board).toEqual(before.board); expect(upgraded.roundFlow).toEqual(before.roundFlow); expect(upgraded.facilities).toEqual(before.facilities); expect(f.legacy).toEqual(before);
    errorCode(() => enableWarehouseEntries(upgraded, f.definition, { expectedVersion: upgraded.stateVersion }), 'WAREHOUSE_FORMAT', WarehouseEntryError);
    errorCode(() => enableWarehouseEntries(f.legacy, f.definition, { expectedVersion: 0 }), 'STALE_VERSION', WarehouseEntryError);
  });
  it('requires the explicit format before either warehouse branch', () => { const f = fixture(); errorCode(() => run(f, influence(f.slots[0], f.slots[0], f.slots[1]), f.legacy), 'WAREHOUSE_FORMAT'); });
  it.each([2, 3, 4])('places once then moves the same new physical marker for %i players', count => {
    const f = fixture('FAC-001', count), before = structuredClone(f.state), id = f.state.markerSupplyByPlayer.p1![0]!, next = run(f, influence(f.slots[0], f.slots[0], f.slots[1]));
    expect(next.schemaVersion).toBe('1.11.0'); expect(next.players.p1!.balances['columbia-voucher']).toBe(41); expect(next.players.p1!.score).toBe(f.state.players.p1!.score); expect(next.board.influenceBySlot[f.slots[0]!]).toBe(null); expect(next.board.influenceBySlot[f.slots[1]!]).toEqual({ markerId: id, ownerPlayerId: 'p1' }); expect(next.markerSupplyByPlayer.p1).toHaveLength(before.markerSupplyByPlayer.p1!.length - 1);
    expect(next.construction).toMatchObject({ status: 'complete', constructionsCompleted: 1, builtCardId: f.cardId }); expect(next.construction!.warehouseEntry).toBeUndefined(); expect(next.eventDecks).toEqual(before.eventDecks); expect(f.state).toEqual(before); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(count * 30);
  });
  it('may move an existing own marker instead of the newly placed one', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), [a, b, c] = f.slots, id = put(state, a!); const next = run(f, influence(b, a, c), state); expect(next.board.influenceBySlot[c!]!.markerId).toBe(id); expect(next.board.influenceBySlot[b!]!.ownerPlayerId).toBe('p1');
  });
  it('skips an impossible placement but still moves existing influence with empty supply', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); for (const slot of f.slots) { if (!state.markerSupplyByPlayer.p1!.length) break; put(state, slot); }
    const empty = f.slots.find(slot => state.board.influenceBySlot[slot] === null)!; const id = state.board.influenceBySlot[f.slots[0]!]!.markerId; const next = run(f, influence(undefined, f.slots[0], empty), state); expect(next.board.influenceBySlot[empty]!.markerId).toBe(id); expect(next.markerSupplyByPlayer.p1).toHaveLength(0);
  });
  it('skips both when every legal empty target is unavailable', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state);
    for (const slot of [...f.slots, ...f.board.resourceNodes['A-01']!.influenceSlotIds]) put(state, slot, state.markerSupplyByPlayer.p1!.length ? 'p1' : 'p2');
    expect(run(f, influence(), state).construction!.status).toBe('complete');
  });
  it.each(['omit-placement', 'omit-move', 'opponent-source', 'same-target', 'opponent-city'] as const)('rejects %s atomically', reason => {
    const f = fixture(), state = gameStateSchema.parse(f.state), [a, b, c] = f.slots; put(state, c!, 'p2');
    const choice = reason === 'omit-placement' ? influence() : reason === 'omit-move' ? influence(a) : influence(a, reason === 'opponent-source' ? c : a, reason === 'same-target' ? a : reason === 'opponent-city' ? f.board.resourceNodes['A-02']!.influenceSlotIds[0] : b);
    const before = structuredClone(state); errorCode(() => run(f, choice, state), reason === 'omit-placement' ? 'PLACEMENT_TARGET' : reason === 'omit-move' ? 'MOVE_REQUIRED' : reason === 'opponent-source' ? 'MOVE_SOURCE' : 'MOVE_TARGET'); expect(state).toEqual(before);
  });
  it('keeps synchronous settlement from pretending the exploration branch has completed', () => { const f = fixture(); errorCode(() => settle(f, { kind: 'warehouse-explore' }), 'ENTRY_REQUIRES_CONTINUATION'); });
});

describe('construction-owned exploration payment, draw, choice and final influence', () => {
  it.each([2, 3, 4])('commits construction plus paid exploration and restores pending event for %i players', count => {
    const f = fixture('FAC-001', count), before = structuredClone(f.state), next = explore(f);
    expect(next.phase).toBe('construction'); expect(next.exploration).toBeUndefined(); expect(next.stateVersion).toBe(before.stateVersion + 1); expect(next.players.p1!.balances['columbia-voucher']).toBe(39); expect(next.construction).toMatchObject({ status: 'entry-pending', constructionsCompleted: 1, builtCardId: f.cardId }); expect(entry(next).status).toBe('event-choice');
    expect(next.facilities!.panels[0]!.placements).toContainEqual({ cardId: f.cardId, cellId: 'CP-1-1' }); expect(next.facilities!.supply.revision).toBe(before.facilities!.supply.revision + 1); expect(next.facilities!.supply.supply).toHaveLength(6);
    expect(next.eventDecks!.green).toHaveLength(before.eventDecks!.green.length - 1); expect(next.board.resourceMarkerByNode['B-01']!.markerDefinitionId).toBe(entry(next).cardId); expect(f.state).toEqual(before); expect(parseGameState(JSON.parse(JSON.stringify(next)), f.definition)).toEqual(next); expect(getRoundTurn(next, f.definition).majorActionStatus).toBe('pending');
    const done = complete(f, next); expect(done.construction!.status).toBe('complete'); expect(done.eventDecks).toEqual(next.eventDecks); expect(getRoundTurn(done, f.definition).majorActionStatus).toBe('complete'); expect(Object.keys(getMarkerLedger(done, f.definition))).toHaveLength(count * 30);
  });
  it('deduplicates a revisited three-end route and allows undiscovered intermediate nodes', () => {
    const f = fixture(), next = explore(f, f.state, { nodeId: 'A-03', path: [{ routeId: 'A-route-01', toNodeId: 'A-02' }, { routeId: 'A-route-02', toNodeId: 'B-03' }, { routeId: 'A-route-02', toNodeId: 'A-03' }] });
    expect(next.players.p1!.balances['columbia-voucher']).toBe(37); expect(next.board.resourceMarkerByNode['B-03']).toBe(null); expect(entry(next).cardId![0]).toBe('Y');
  });
  it('uses a four-end route once despite visiting different incident nodes', () => {
    const f = fixture(), next = explore(f, f.state, { nodeId: 'A-03', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }, { routeId: 'D-route-01', toNodeId: 'D-02' }, { routeId: 'D-route-01', toNodeId: 'A-03' }] }); expect(f.board.routes['D-route-01']!.incidentNodeIds).toHaveLength(4); expect(next.players.p1!.balances['columbia-voucher']).toBe(37);
  });
  it('pays actual route influence owner, or travels free when own influence controls the route', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), slot = f.board.routes['R-route-02']!.influenceSlotIds[0]!; put(state, slot, 'p2');
    const next = explore(f, state); expect(next.players.p2!.balances['columbia-voucher']).toBe(52); expect(next.players.p1!.balances['columbia-voucher']).toBe(39);
    const own = gameStateSchema.parse(f.state); put(own, slot); expect(explore(f, own).players.p1!.balances['columbia-voucher']).toBe(41);
  });
  it('quotes targets from post-construction funds and skips only an impossible exploration', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 9;
    const quote = getConstructionQuote(state, f.definition, { authenticatedPlayerId: 'p1' }, command(f, { kind: 'warehouse-explore' }, state)); expect(quote).toHaveProperty('warehouseExplorationTargets', []);
    const next = run(f, { kind: 'warehouse-explore' }, state); expect(next.construction!.status).toBe('complete'); expect(entry(next).status).toBe('skipped'); expect(next.eventDecks).toEqual(state.eventDecks); expect(next.players.p1!.balances['columbia-voucher']).toBe(0);
    errorCode(() => explore(f, state), 'EXPLORATION_IMPOSSIBLE');
  });
  it('cannot skip zero-money exploration when own influence makes the path free', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 9; put(state, f.board.routes['R-route-02']!.influenceSlotIds[0]!);
    errorCode(() => run(f, { kind: 'warehouse-explore' }, state), 'EXPLORATION_REQUIRED'); expect(explore(f, state).construction!.status).toBe('entry-pending');
  });
  it.each(['path', 'end', 'already-revealed', 'red-closed', 'missing-target'] as const)('rejects invalid initial %s without keeping construction or revealing an event', reason => {
    const f = fixture(), before = structuredClone(f.state);
    if (reason === 'missing-target') errorCode(() => run(f, { kind: 'warehouse-explore' }), 'EXPLORATION_REQUIRED');
    else errorCode(() => explore(f, f.state, reason === 'already-revealed' ? { ...targetPath, nodeId: 'A-02' } : reason === 'red-closed' ? { ...targetPath, nodeId: 'F-01' } : reason === 'path' ? { ...targetPath, path: [{ routeId: 'A-route-02', toNodeId: 'B-01' }] } : { ...targetPath, nodeId: 'C-02' }), reason === 'already-revealed' ? 'EXPLORATION_TARGET' : reason === 'red-closed' ? 'RED_CLOSED' : reason === 'path' ? 'PATH_CONNECTION' : 'PATH_TARGET'); expect(f.state).toEqual(before);
  });
  it('does not use event rewards to pay an unaffordable chosen route', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 10;
    // A free alternative exists, but the chosen path costs two after paying nine.
    put(state, f.board.routes['A-route-01']!.influenceSlotIds[0]!); put(state, f.board.routes['R-route-07']!.influenceSlotIds[0]!);
    const before = structuredClone(state); errorCode(() => explore(f, state), 'CANNOT_PAY'); expect(state).toEqual(before);
  });
  it('keeps already-paid construction and draw when a later event choice fails, then resumes exactly once', () => {
    const f = fixture(), pending = explore(f), before = structuredClone(pending);
    errorCode(() => sendEntry(f, pending, { type: 'choose-exploration-event', choice: { choiceId: 'Y01:1' } }), 'EVENT_CHOICE', WarehouseEntryError);
    expect(pending).toEqual(before); const done = complete(f, parseGameState(JSON.parse(JSON.stringify(pending)), f.definition)); expect(done.facilities!.supply).toEqual(pending.facilities!.supply); expect(done.eventDecks).toEqual(pending.eventDecks);
  });
  it('separately resolves an event influence and the final target influence', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), deck = state.eventDecks!.yellow; deck.splice(deck.indexOf('Y05'), 1); deck.unshift('Y05');
    let next = explore(f, state, { nodeId: 'A-03', path: [{ routeId: 'A-route-01', toNodeId: 'A-02' }, { routeId: 'A-route-02', toNodeId: 'A-03' }] });
    expect(entry(next).cardId).toBe('Y05'); const req = getPendingWarehouseEventRequirements(next, f.definition, 'p1', 'Y05:1'); expect(req.requiresCostDecision).toBe(true);
    next = sendEntry(f, next, { type: 'choose-exploration-event', choice: { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: req.legalInfluenceSlotIds[0] } }); expect(next.construction!.status).toBe('entry-pending'); expect(entry(next).status).toBe('final-influence');
    const saved = parseGameState(JSON.parse(JSON.stringify(next)), f.definition); next = sendEntry(f, saved, { type: 'place-exploration-influence', slotId: getWarehouseEntryFinalSlotIds(saved, f.definition, 'p1')[0] }); expect(next.markerSupplyByPlayer.p1).toHaveLength(state.markerSupplyByPlayer.p1!.length - 2); expect(next.players.p1!.balances['columbia-voucher']).toBe(33);
  });
  it('completes after the event when no supply marker remains for final placement', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); for (const slot of f.slots) { if (!state.markerSupplyByPlayer.p1!.length) break; put(state, slot); }
    const next = choose(f, explore(f, state)); expect(next.construction!.status).toBe('complete'); expect(entry(next).status).toBe('complete'); expect(next.markerSupplyByPlayer.p1).toHaveLength(0);
  });
});

describe('pending entry is authoritative, non-bypassable and versioned', () => {
  it.each(['finish-turn', 'cancel', 'major', 'role', 'harvest', 'finish-round', 'old-exploration'] as const)('blocks %s while the event is pending', action => {
    const f = fixture(), state = explore(f), before = structuredClone(state);
    const attempt = () => action === 'finish-turn' ? roundSend(state, f.definition, { type: 'finish-player-turn' }) : action === 'cancel' ? roundSend(state, f.definition, { type: 'cancel-major-preparation' }) : action === 'major' ? roundSend(state, f.definition, { type: 'choose-major-action', action: 'dispatch' }) : action === 'role' ? applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-04', mode: 'scheme', schemeChoice: { kind: 'forced-sale', asset: 'iron' } }) : action === 'harvest' ? openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: 1 }) : action === 'finish-round' ? finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }) : applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'choose-exploration-event', choice: { choiceId: `${entry(state).cardId}:1` } });
    expect(attempt).toThrow(); expect(state).toEqual(before);
  });
  it.each([openDeploymentWindow, openDispatchWindow, openExplorationWindow, openCityMoveWindow, openConstructionWindow])('blocks a legacy grant during nested entry', grant => { const f = fixture(), state = explore(f); expect(() => grant(state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion })).toThrow(); });
  it.each(['stale', 'game', 'actor', 'restart', 'override', 'overflow'] as const)('refuses %s without a second payment/draw or changing pending state', reason => {
    const f = fixture(), state = gameStateSchema.parse(explore(f)), before = structuredClone(state); let payload: Record<string, unknown> = { type: 'choose-exploration-event', choice: { choiceId: `${entry(state).cardId}:1` }, ...env(state) }, actor = 'p1', expected = '';
    if (reason === 'stale') { payload.expectedVersion = 0; expected = 'STALE_VERSION'; }
    if (reason === 'game') { payload.gameId = 'other'; expected = 'GAME_REFERENCE'; }
    if (reason === 'actor') { actor = 'p2'; expected = 'WRONG_ACTOR'; }
    if (reason === 'restart') { payload = { ...env(state), type: 'explore', ...targetPath }; expected = 'ENTRY_STAGE'; }
    if (reason === 'override') { payload.actorId = 'p2'; expected = 'COMMAND_SCHEMA'; }
    if (reason === 'overflow') { payload.expectedVersion = state.stateVersion = Number.MAX_SAFE_INTEGER; expected = 'VERSION_OVERFLOW'; }
    const input = reason === 'overflow' ? structuredClone(state) : before; errorCode(() => applyWarehouseEntryCommand(state, f.definition, { authenticatedPlayerId: actor }, payload), expected, WarehouseEntryError); expect(state).toEqual(input);
  });
  it.each(['old-format', 'missing-entry', 'premature-complete', 'wrong-card', 'wrong-marker', 'resolved-pending'] as const)('rejects saved-state tampering: %s', tamper => {
    const f = fixture(), state = gameStateSchema.parse(explore(f));
    if (tamper === 'old-format') state.schemaVersion = '1.10.0';
    if (tamper === 'missing-entry') delete state.construction!.warehouseEntry;
    if (tamper === 'premature-complete') state.construction!.status = 'complete';
    if (tamper === 'wrong-card') state.construction!.warehouseEntry!.cardId = 'Y01';
    if (tamper === 'wrong-marker') state.construction!.warehouseEntry!.targetNodeId = 'A-02';
    if (tamper === 'resolved-pending') state.construction!.warehouseEntry!.resolvedChoiceId = `${entry(state).cardId}:1`;
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('rejects invalid final slots and repeated event/final commands with immutable continuation state', () => {
    const f = fixture(), pending = explore(f), payload = { ...env(pending), type: 'choose-exploration-event', choice: { choiceId: `${entry(pending).cardId}:1` } }, chosen = applyWarehouseEntryCommand(pending, f.definition, { authenticatedPlayerId: 'p1' }, payload), before = structuredClone(chosen);
    errorCode(() => applyWarehouseEntryCommand(chosen, f.definition, { authenticatedPlayerId: 'p1' }, payload), 'STALE_VERSION', WarehouseEntryError);
    errorCode(() => sendEntry(f, chosen, { type: 'place-exploration-influence', slotId: f.slots[0] }), 'FINAL_SLOT', WarehouseEntryError); expect(chosen).toEqual(before);
    const done = sendEntry(f, chosen, { type: 'place-exploration-influence', slotId: getWarehouseEntryFinalSlotIds(chosen, f.definition, 'p1')[0] }); errorCode(() => sendEntry(f, done, { type: 'place-exploration-influence', slotId: f.slots[0] }), 'ENTRY_STAGE', WarehouseEntryError);
  });
  it.each([2, 3, 4])('resumes, finishes one major action and carries the built warehouse through harvest into round two for %i players', count => {
    const f = fixture('FAC-001', count), built = complete(f, explore(f));
    const afterRole = applyBaseRoleCommand(built, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(built), type: 'use-base-role', roleId: 'ROLE-04', mode: 'scheme', schemeChoice: { kind: 'forced-sale', asset: 'iron' } }); expect(afterRole.construction).toBeUndefined(); expect(afterRole.roundFlow!.completedMajorAction).toBe('construct');
    let state = roundSend(afterRole, f.definition, { type: 'finish-player-turn' }); while (state.roundFlow!.stage === 'player-actions') state = dispatchTurn(state, f.definition);
    state = openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: 1 }); for (const player of f.definition.players) state = applyHarvestCommand(state, f.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
    state = finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }); expect(state.schemaVersion).toBe('1.11.0'); expect(state.roundFlow!.roundNumber).toBe(2); expect(state.facilities!.panels[0]!.placements).toContainEqual({ cardId: f.cardId, cellId: 'CP-1-1' }); expect(validateGameState(state, f.definition).success).toBe(true);
  });
});

describe('additional continuation and opening-round regressions', () => {
  it.each([2, 3, 4])('explores a red target in its actually open round for %i players', count => {
    const f = fixture('FAC-001', count), state = gameStateSchema.parse(f.state), roundNumber = count === 2 ? 6 : count === 3 ? 5 : 4;
    state.roundFlow!.roundNumber = roundNumber; state.construction!.roundNumber = roundNumber;
    const next = explore(f, state, { nodeId: 'F-03', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }, { routeId: 'D-route-01', toNodeId: 'D-02' }, { routeId: 'F-route-02', toNodeId: 'F-01' }, { routeId: 'F-route-01', toNodeId: 'F-03' }] });
    expect(entry(next).cardId![0]).toBe('R'); expect(complete(f, next).construction!.status).toBe('complete');
  });
  it('rejects an unknown actor in a skipped snapshot without throwing from the validator', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 9;
    const skipped = gameStateSchema.parse(run(f, { kind: 'warehouse-explore' }, state)); skipped.construction!.actorId = 'unknown'; expect(validateGameState(skipped, f.definition).success).toBe(false);
  });
  it('rejects malformed upgrade options and upgrade version overflow', () => {
    const f = fixture(); errorCode(() => enableWarehouseEntries(f.legacy, f.definition, { expectedVersion: f.legacy.stateVersion, actorId: 'p1' } as { expectedVersion: number }), 'OPTIONS_SCHEMA', WarehouseEntryError);
    const state = gameStateSchema.parse(f.legacy); state.stateVersion = Number.MAX_SAFE_INTEGER; errorCode(() => enableWarehouseEntries(state, f.definition, { expectedVersion: state.stateVersion }), 'VERSION_OVERFLOW', WarehouseEntryError);
  });
  it('pays exact warehouse resource cost before performing its complete influence branch', () => {
    const f = fixture(), next = run(f, influence(f.slots[0], f.slots[0], f.slots[1]), f.state, 'resources'); expect(next.players.p1!.balances).toEqual({ ...f.state.players.p1!.balances, orirock: 29, originium: 28 }); expect(next.players.p1!.score).toBe(0);
  });
  it('does not allow initial exploration data on the influence branch or another facility', () => {
    const f = fixture(); errorCode(() => applyConstructionCommand(f.state, f.definition, { authenticatedPlayerId: 'p1' }, { ...command(f, influence(f.slots[0], f.slots[0], f.slots[1])), warehouseExploration: targetPath }), 'ENTRY_CHOICE');
    const other = fixture('FAC-003'); errorCode(() => applyConstructionCommand(other.state, other.definition, { authenticatedPlayerId: 'p1' }, { ...command(other, { kind: 'mercenary-influence', effect: 'remove' }), warehouseExploration: targetPath }), 'ENTRY_CHOICE');
  });
  it('rolls back the whole initial construction if the selected toll recipient overflows', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); put(state, f.board.routes['R-route-02']!.influenceSlotIds[0]!, 'p2'); state.players.p2!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(state); errorCode(() => explore(f, state), 'BALANCE_OVERFLOW'); expect(state).toEqual(before);
  });
  it('does not accept a warehouse already built in a downgraded historical format', () => {
    const f = fixture(), state = gameStateSchema.parse(run(f, influence(f.slots[0], f.slots[0], f.slots[1]))); state.schemaVersion = '1.10.0'; expect(validateGameState(state, f.definition).success).toBe(false);
  });
});

describe('entry decisions after construction refill is public', () => {
  it('commits payment/refill before asking for a branch, with no predetermined target', () => {
    const f = fixture(), next = run(f, { kind: 'warehouse-entry' }); expect(next.construction!.status).toBe('entry-pending'); expect(entry(next)).toMatchObject({ kind: 'warehouse-choice', status: 'branch-choice', cardId: null }); expect(next.players.p1!.balances['columbia-voucher']).toBe(41); expect(next.facilities!.supply.supply).toContain(f.state.facilities!.supply.drawPile[0]); expect(next.eventDecks).toEqual(f.state.eventDecks); expect(parseGameState(JSON.parse(JSON.stringify(next)), f.definition)).toEqual(next);
  });
  it('chooses the complete influence branch after seeing the refilled market', () => {
    const f = fixture(), state = run(f, { kind: 'warehouse-entry' }), next = sendEntry(f, state, { type: 'choose-warehouse-entry', entryChoice: influence(f.slots[0], f.slots[0], f.slots[1]) }); expect(next.construction!.status).toBe('complete'); expect(next.players.p1!.balances['columbia-voucher']).toBe(41); expect(next.facilities).toEqual(state.facilities); expect(next.board.influenceBySlot[f.slots[1]!]!.ownerPlayerId).toBe('p1');
  });
  it('chooses and restores the exploration branch after construction, without paying for construction again', () => {
    const f = fixture(), state = run(f, { kind: 'warehouse-entry' }), pending = sendEntry(f, parseGameState(JSON.parse(JSON.stringify(state)), f.definition), { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' }, warehouseExploration: targetPath }); expect(pending.players.p1!.balances['columbia-voucher']).toBe(39); expect(pending.facilities).toEqual(state.facilities); expect(complete(f, pending).construction!.status).toBe('complete');
  });
  it('retains a paid construction when an invalid branch attempt fails, allowing a different valid choice', () => {
    const f = fixture(), state = run(f, { kind: 'warehouse-entry' }), before = structuredClone(state); errorCode(() => sendEntry(f, state, { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' } }), 'EXPLORATION_REQUIRED', WarehouseEntryError); expect(state).toEqual(before); expect(sendEntry(f, state, { type: 'choose-warehouse-entry', entryChoice: influence(f.slots[0], f.slots[0], f.slots[1]) }).construction!.status).toBe('complete');
  });
  it('skips an actually impossible exploration chosen after construction', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 9; const paid = run(f, { kind: 'warehouse-entry' }, state); expect(entry(sendEntry(f, paid, { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' } })).status).toBe('skipped');
  });
  it('blocks event commands, other actors and duplicate branch choices at the branch-selection boundary', () => {
    const f = fixture(), state = run(f, { kind: 'warehouse-entry' }); errorCode(() => sendEntry(f, state, { type: 'choose-exploration-event', choice: { choiceId: 'G06:1' } }), 'ENTRY_STAGE', WarehouseEntryError); errorCode(() => sendEntry(f, state, { type: 'choose-warehouse-entry', entryChoice: influence(f.slots[0], f.slots[0], f.slots[1]) }, 'p2'), 'WRONG_ACTOR', WarehouseEntryError);
    const pending = sendEntry(f, state, { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' }, warehouseExploration: targetPath }); errorCode(() => sendEntry(f, pending, { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' }, warehouseExploration: targetPath }), 'ENTRY_STAGE', WarehouseEntryError);
  });
});
