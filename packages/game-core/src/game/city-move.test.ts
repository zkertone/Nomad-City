import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_EVENT_CATALOG, getFoundersEventCard } from '../events/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, openCityMoveWindow, applyCityMoveCommand,
  getCityMoveOptions, getCityMoveFinalSlotIds, getPendingCityMoveChoiceRequirements, CityMoveCommandError,
  openExplorationWindow, applyExplorationCommand, getExplorationFinalSlotIds,
  gameStateSchema, parseGameState, validateGameState, getMarkerLedger,
} from './index.js';
import type { GameDefinition, GameState, PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
function finishedEntry(count = 4, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const setup = createPreEntryGame('city-move-test', players);
  const ids = FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === 'green' && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(setup.state, setup.definition, { startingPlayerId: players[0]!.id, clockwisePlayerIds: players.map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids.filter(id => id !== 'G03')] });
  for (const [index, player] of players.entries()) {
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: player.id }, {
      gameId: state.gameId, expectedVersion: state.stateVersion, type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index],
    });
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: player.id }, {
      gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1`,
    });
  }
  if (count === 2) state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: players[1]!.id }, {
    gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-entry-influence', slotId: null,
  });
  return { definition: setup.definition, state };
}
function fixture(count = 4, cardId = 'Y01', roundNumber = 1, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const entry = finishedEntry(count, players);
  const deck = (color: 'yellow' | 'red') => {
    const ids = FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
    return ids.includes(cardId) ? [cardId, ...ids.filter(id => id !== cardId)] : ids;
  };
  return { ...entry, state: openCityMoveWindow(entry.state, entry.definition, { actorId: players[0]!.id, roundNumber,
    expectedVersion: entry.state.stateVersion, deckOrder: { yellow: deck('yellow'), red: deck('red') } }),
  board: loadFoundersBoard(count === 4 ? 'four-player' : 'three-player') };
}
type Fixture = ReturnType<typeof fixture>;
type MutableState = ReturnType<typeof gameStateSchema.parse>;
const copy = (f: Fixture) => gameStateSchema.parse(f.state);
function reveal(f: Fixture, state: MutableState, nodeId: string, cardId: string) {
  const card = getFoundersEventCard(cardId);
  expect(f.board.resourceNodes[nodeId]!.eventDeckColor).toBe(card.color);
  expect(state.eventDecks![card.color]).toContain(cardId);
  state.eventDecks![card.color] = state.eventDecks![card.color].filter(id => id !== cardId);
  state.board.resourceMarkerByNode[nodeId] = { markerDefinitionId: card.id, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
}
function put(state: MutableState, slotId: string, owner = 'p2') {
  expect(state.board.influenceBySlot[slotId]).toBeNull();
  const markerId = state.markerSupplyByPlayer[owner]!.shift()!;
  if (!markerId) throw new Error('Fixture exhausted');
  state.board.influenceBySlot[slotId] = { ownerPlayerId: owner, markerId };
  return markerId;
}
function exhaust(f: Fixture, state: MutableState, leave = 0) {
  const slots = Object.entries(f.board.influenceSlots).filter(([id, slot]) => slot.kind === 'route' && state.board.influenceBySlot[id] === null).map(([id]) => id);
  const count = state.markerSupplyByPlayer.p1!.length - leave;
  for (const id of slots.slice(0, count)) put(state, id, 'p1');
  expect(state.markerSupplyByPlayer.p1).toHaveLength(leave);
}
function send(state: GameState, definition: GameDefinition, command: Record<string, unknown>, actorId = 'p1') {
  return applyCityMoveCommand(state, definition, { authenticatedPlayerId: actorId }, { gameId: state.gameId, expectedVersion: state.stateVersion, ...command });
}
const move = (f: Fixture, state: GameState = f.state, nodeId = 'D-01', routeId = 'R-route-01') => send(state, f.definition, { type: 'move-city', nodeId, routeId });
const choose = (f: Fixture, state: GameState, choice: Record<string, unknown>) => send(state, f.definition, { type: 'choose-city-move-event', choice });
function finish(f: Fixture, state: GameState): GameState {
  return state.cityMove!.status === 'final-influence' ? send(state, f.definition, { type: 'place-city-move-influence', slotId: getCityMoveFinalSlotIds(state, f.definition, 'p1')[0] }) : state;
}
function code(fn: () => unknown, expected: string) {
  try { fn(); throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(CityMoveCommandError); expect((error as CityMoveCommandError).code).toBe(expected); }
}

describe('trusted city-move grants and format compatibility', () => {
  it.each([2, 3, 4])('opens after actual %i-player entry, preserving decks/order/inventory', count => {
    const entry = finishedEntry(count), f = fixture(count);
    expect(f.state.schemaVersion).toBe('1.3.0'); expect(f.state.phase).toBe('city-move');
    expect(f.state.stateVersion).toBe(entry.state.stateVersion + 1);
    expect(f.state.playerOrder).toEqual(entry.state.entry!.playerOrder);
    expect(f.state.eventDecks!.green).toEqual(entry.state.entry!.remainingGreenEventIds);
    expect(f.state.players).toEqual(entry.state.players); expect(f.state.markerSupplyByPlayer).toEqual(entry.state.markerSupplyByPlayer);
    expect(f.state.entry).toBeUndefined(); expect(f.state.exploration).toBeUndefined();
    expect(f.state.cityMove).toEqual({ actorId: 'p1', roundNumber: 1, status: 'ready', sourceNodeId: null, targetNodeId: null, routeId: null, cardId: null, resolvedChoiceId: null });
  });
  it('requires completed entry/action and cannot replace an unfinished exploration grant', () => {
    const game = createPreEntryGame('unready', seats.slice(0, 3));
    code(() => openCityMoveWindow(game.state, game.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: 0 }), 'ACTION_PENDING');
    const entry = finishedEntry(); const state = openExplorationWindow(entry.state, entry.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: entry.state.stateVersion });
    code(() => openCityMoveWindow(state, entry.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion }), 'ACTION_PENDING');
  });
  it.each(['actor', 'version', 'round', 'deck'])('rejects invalid trusted %s', kind => {
    const entry = finishedEntry(3);
    const options = { actorId: kind === 'actor' ? 'ghost' : 'p1', roundNumber: kind === 'round' ? 9 : 1, expectedVersion: kind === 'version' ? 0 : entry.state.stateVersion,
      ...(kind === 'deck' ? { deckOrder: { yellow: ['Y08'], red: ['R01'] } } : {}) };
    code(() => openCityMoveWindow(entry.state, entry.definition, options), { actor: 'ACTOR_REFERENCE', version: 'STALE_VERSION', round: 'WINDOW_SCHEMA', deck: 'EVENT_DECK' }[kind]!);
  });
  it('does not reset decks or move backwards when granting the next completed move', () => {
    const f = fixture(); const completed = finish(f, choose(f, move(f), { choiceId: 'Y01:2' }));
    code(() => openCityMoveWindow(completed, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: completed.stateVersion, deckOrder: { yellow: [], red: [] } }), 'WINDOW_RESET');
    const round2 = gameStateSchema.parse(completed); round2.cityMove!.roundNumber = 2;
    code(() => openCityMoveWindow(round2, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: round2.stateVersion }), 'WINDOW_RESET');
    const next = openCityMoveWindow(completed, f.definition, { actorId: 'p2', roundNumber: 2, expectedVersion: completed.stateVersion });
    expect(next.eventDecks).toEqual(completed.eventDecks); expect(next.playerOrder).toEqual(completed.playerOrder);
  });
});

describe('exact resource cost and chosen single-route connection', () => {
  it.each([0, 2, 3, 9])('uses exactly 3 originium with %i available, before moving or drawing', amount => {
    const f = fixture(); const state = copy(f); state.players.p1!.balances.originium = amount;
    const original = structuredClone(state);
    if (amount < 3) { expect(getCityMoveOptions(state, f.definition, 'p1')).toEqual([]); code(() => move(f, state), 'CANNOT_PAY'); }
    else {
      const result = move(f, state);
      expect(result.players.p1!.balances.originium).toBe(amount - 3);
      expect(result.board.cityNodeByPlayer.p1).toBe('D-01'); expect(result.cityMove!.sourceNodeId).toBe('A-01');
      expect(result.players.p1!.balances['columbia-voucher']).toBe(state.players.p1!.balances['columbia-voucher']);
    }
    expect(state).toEqual(original);
  });
  it('does not collect tolls even when multiple opponents occupy the selected route', () => {
    const f = fixture(); const state = copy(f); const slots = f.board.routes['R-route-01']!.influenceSlotIds;
    put(state, slots[0]!, 'p2'); put(state, slots[1]!, 'p3'); state.players.p1!.balances['columbia-voucher'] = 0;
    const result = move(f, state);
    for (const player of f.definition.players) expect(result.players[player.id]!.balances['columbia-voucher']).toBe(state.players[player.id]!.balances['columbia-voucher']);
  });
  it.each([
    ['same node', 'A-01', 'R-route-01'], ['occupied city', 'A-02', 'A-route-01'],
    ['wrong target endpoint', 'B-03', 'R-route-01'], ['wrong source endpoint', 'D-02', 'D-route-01'],
    ['unknown node', 'A-99', 'R-route-01'], ['unknown route', 'D-01', 'R-route-99'],
  ])('rejects %s', (_label, nodeId, routeId) => {
    const f = fixture(); code(() => move(f, f.state, nodeId, routeId), 'MOVE_TARGET');
  });
  it.each([['Z-99', 'R-route-01'], ['constructor', 'R-route-01'], ['D-01', 'constructor']])('rejects malformed node/route IDs %s/%s before reference lookup', (nodeId, routeId) => {
    const f = fixture(); code(() => move(f, f.state, nodeId, routeId), 'COMMAND_SCHEMA');
  });
  it('retains distinct options for two routes joining the same node pair and clears only the selected route', () => {
    const f = fixture(2); const state = copy(f);
    reveal(f, state, 'B-02', 'G05'); reveal(f, state, 'C-01', 'G06'); state.board.cityNodeByPlayer.p1 = 'B-02';
    const first = f.board.routes['B-route-02']!.influenceSlotIds[0]!, second = f.board.routes['C-route-02']!.influenceSlotIds[0]!;
    const cleared = put(state, first), retained = put(state, second);
    const options = getCityMoveOptions(state, f.definition, 'p1').filter(option => option.nodeId === 'C-01');
    expect(options).toEqual(expect.arrayContaining([{ nodeId: 'C-01', routeId: 'B-route-02' }, { nodeId: 'C-01', routeId: 'C-route-02' }]));
    const result = move(f, state, 'C-01', 'B-route-02');
    expect(result.board.influenceBySlot[first]).toBeNull(); expect(result.markerSupplyByPlayer.p2).toContain(cleared);
    expect(result.board.influenceBySlot[second]!.markerId).toBe(retained);
  });
});

describe('clearing opponents is exact, conserved and precedes events', () => {
  it('returns all opponents on the chosen route and target while retaining own, source and outside influence', () => {
    const f = fixture(); const state = copy(f); reveal(f, state, 'D-01', 'Y01'); reveal(f, state, 'G-02', 'Y02');
    const route = f.board.routes['R-route-01']!.influenceSlotIds, target = f.board.resourceNodes['D-01']!.influenceSlotIds;
    const returned2 = put(state, route[0]!, 'p2'), ownRoute = put(state, route[1]!, 'p1');
    const returned3 = put(state, target[0]!, 'p3'), ownTarget = put(state, target[1]!, 'p1');
    const source = f.board.resourceNodes['A-01']!.influenceSlotIds[0]!, otherEnd = f.board.resourceNodes['G-02']!.influenceSlotIds[0]!, outside = f.board.routes['R-route-02']!.influenceSlotIds[0]!;
    const sourceMarker = put(state, source, 'p1'), otherMarker = put(state, otherEnd, 'p2'), outsideMarker = put(state, outside, 'p3');
    const result = move(f, state);
    expect(result.board.influenceBySlot[route[0]!]).toBeNull(); expect(result.board.influenceBySlot[target[0]!]).toBeNull();
    expect(result.markerSupplyByPlayer.p2).toContain(returned2); expect(result.markerSupplyByPlayer.p3).toContain(returned3);
    for (const [slot, id] of [[route[1]!, ownRoute], [target[1]!, ownTarget], [source, sourceMarker], [otherEnd, otherMarker], [outside, outsideMarker]] as const) expect(result.board.influenceBySlot[slot]!.markerId).toBe(id);
    expect(Object.keys(getMarkerLedger(result, f.definition))).toHaveLength(120);
  });
  it('clears every opponent marker, not just one per player or one per object', () => {
    const f = fixture(); const state = copy(f); reveal(f, state, 'D-01', 'Y01');
    const ids = [...f.board.routes['R-route-01']!.influenceSlotIds, ...f.board.resourceNodes['D-01']!.influenceSlotIds];
    const markers = ids.map((id, index) => put(state, id, index % 2 ? 'p3' : 'p2'));
    const result = move(f, state);
    for (const id of ids) expect(result.board.influenceBySlot[id]).toBeNull();
    for (const marker of markers) expect(getMarkerLedger(result, f.definition)[marker]!.location.kind).toBe('supply');
    expect(result.markerSupplyByPlayer.p2).toHaveLength(29); expect(result.markerSupplyByPlayer.p3).toHaveLength(29);
  });
  it.each([3, 4])('keeps other endpoint nodes of a %i-ended route intact', ends => {
    const f = fixture(); const state = copy(f);
    const routeId = ends === 3 ? 'R-route-02' : 'D-route-01';
    const source = ends === 3 ? 'A-01' : 'D-02', target = ends === 3 ? 'B-01' : 'A-03', other = ends === 3 ? 'G-01' : 'D-03';
    if (source !== 'A-01') { reveal(f, state, source, 'Y02'); state.board.cityNodeByPlayer.p1 = source; }
    reveal(f, state, other, ends === 3 ? 'G06' : 'Y03');
    const otherSlot = f.board.resourceNodes[other]!.influenceSlotIds[0]!, markerId = put(state, otherSlot);
    for (const slot of f.board.routes[routeId]!.influenceSlotIds) put(state, slot);
    const result = move(f, state, target, routeId);
    expect(result.board.influenceBySlot[otherSlot]!.markerId).toBe(markerId);
    for (const slot of f.board.routes[routeId]!.influenceSlotIds) expect(result.board.influenceBySlot[slot]).toBeNull();
  });
  it('Y08 receives the cleared route slots when querying the new event', () => {
    const f = fixture(4, 'Y08'); const state = copy(f); const slots = f.board.routes['R-route-01']!.influenceSlotIds;
    for (const slot of slots) put(state, slot);
    const pending = move(f, state);
    expect(getPendingCityMoveChoiceRequirements(pending, f.definition, 'p1', 'Y08:1').legalInfluenceSlotIds).toEqual(expect.arrayContaining([...slots]));
    const resolved = choose(f, pending, { choiceId: 'Y08:1', influenceSlotId: slots[0] });
    expect(resolved.board.influenceBySlot[slots[0]!]!.ownerPlayerId).toBe('p1'); expect(resolved.cityMove!.status).toBe('final-influence');
  });
});

describe('destination exploration, final placement and restoration', () => {
  it.each([2, 3, 4])('completes an unexplored destination move with %i players', count => {
    const f = fixture(count); const pending = move(f);
    expect(pending.cityMove!.status).toBe('event-choice'); expect(pending.cityMove!.cardId).toBe('Y01'); expect(pending.eventDecks!.yellow).toHaveLength(count === 4 ? 9 : 7);
    const restored = parseGameState(JSON.parse(JSON.stringify(pending)), f.definition);
    const resolved = choose(f, restored, { choiceId: 'Y01:2' });
    expect(resolved.players.p1!.balances.originium).toBe(4);
    const result = finish(f, parseGameState(JSON.parse(JSON.stringify(resolved)), f.definition));
    expect(result.cityMove!.status).toBe('complete'); expect(result.board.cityNodeByPlayer.p1).toBe('D-01'); expect(result.markerSupplyByPlayer.p1).toHaveLength(28);
    expect(result.stateVersion).toBe(f.state.stateVersion + 3); expect(Object.keys(getMarkerLedger(result, f.definition))).toHaveLength(count * 30);
  });
  it('already explored targets do not draw or repeat their event', () => {
    const f = fixture(4, 'Y05'); const state = copy(f); reveal(f, state, 'D-01', 'Y06');
    const result = move(f, state);
    expect(result.cityMove!.cardId).toBeNull(); expect(result.cityMove!.resolvedChoiceId).toBeNull(); expect(result.cityMove!.status).toBe('final-influence');
    expect(result.eventDecks).toEqual(state.eventDecks);
    for (const id of ['p2', 'p3', 'p4']) expect(result.players[id]).toEqual(state.players[id]);
    expect(result.players.p1!.balances['columbia-voucher']).toBe(state.players.p1!.balances['columbia-voucher']);
    code(() => choose(f, result, { choiceId: 'Y06:2' }), 'ACTION_STAGE');
  });
  it('own influence occupying both target slots skips final placement without removing it', () => {
    const f = fixture(); const state = copy(f); reveal(f, state, 'D-01', 'Y01');
    const slots = f.board.resourceNodes['D-01']!.influenceSlotIds; const markers = slots.map(slot => put(state, slot, 'p1'));
    const result = move(f, state); expect(result.cityMove!.status).toBe('complete'); expect(result.markerSupplyByPlayer.p1).toHaveLength(27);
    slots.forEach((slot, index) => expect(result.board.influenceBySlot[slot]!.markerId).toBe(markers[index]));
  });
  it('without own supply, returning opponent markers does not fund the actor final placement', () => {
    const f = fixture(); const state = copy(f); reveal(f, state, 'D-01', 'Y01');
    const routeSlots = f.board.routes['R-route-01']!.influenceSlotIds; for (const slot of routeSlots) put(state, slot, 'p2');
    exhaust(f, state); const result = move(f, state);
    expect(result.cityMove!.status).toBe('complete'); expect(result.markerSupplyByPlayer.p1).toHaveLength(0); expect(result.markerSupplyByPlayer.p2).toHaveLength(29);
  });
  it('an event using the last marker still resolves and skips the separate final placement', () => {
    const f = fixture(4, 'Y05'); const pending = gameStateSchema.parse(move(f)); exhaust(f, pending, 1);
    const result = choose(f, pending, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: f.board.resourceNodes['D-01']!.influenceSlotIds[0] });
    expect(result.players.p1!.balances['columbia-voucher']).toBe(pending.players.p1!.balances['columbia-voucher'] - 4);
    expect(result.markerSupplyByPlayer.p1).toHaveLength(0); expect(result.cityMove!.status).toBe('complete');
  });
  it('event placement and final placement remain two transfers at the new city', () => {
    const f = fixture(4, 'Y05'); const pending = move(f); const slots = f.board.resourceNodes['D-01']!.influenceSlotIds;
    const resolved = choose(f, pending, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: slots[0] });
    expect(getCityMoveFinalSlotIds(resolved, f.definition, 'p1')).toEqual([slots[1]]);
    const result = finish(f, resolved); expect(result.markerSupplyByPlayer.p1).toHaveLength(27);
    expect(slots.map(slot => result.board.influenceBySlot[slot]!.ownerPlayerId)).toEqual(['p1', 'p1']);
  });
  it('retains the moved city, paid originium and cleared board after an invalid event choice', () => {
    const f = fixture(4, 'Y05'); const state = copy(f); const slot = f.board.routes['R-route-01']!.influenceSlotIds[0]!; const returned = put(state, slot);
    const pending = gameStateSchema.parse(move(f, state)); pending.players.p1!.balances['columbia-voucher'] = 3;
    const original = structuredClone(pending);
    code(() => choose(f, pending, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: f.board.resourceNodes['D-01']!.influenceSlotIds[0] }), 'CANNOT_PAY');
    expect(pending).toEqual(original); expect(pending.players.p1!.balances.originium).toBe(0); expect(pending.markerSupplyByPlayer.p2).toContain(returned);
    const result = choose(f, pending, { choiceId: 'Y05:1', costDecision: 'decline' }); expect(result.board.cityNodeByPlayer.p1).toBe('D-01');
  });
  it('final influence cannot go back to the source, a route or another node', () => {
    const f = fixture(); const resolved = choose(f, move(f), { choiceId: 'Y01:2' });
    for (const slotId of [f.board.resourceNodes['A-01']!.influenceSlotIds[0], f.board.routes['R-route-01']!.influenceSlotIds[0]]) code(() => send(resolved, f.definition, { type: 'place-city-move-influence', slotId }), 'FINAL_SLOT');
    expect(getCityMoveFinalSlotIds(resolved, f.definition, 'p2')).toEqual([]);
  });
});

describe('red and green target rules', () => {
  it.each([[2, 6], [3, 5], [4, 4]])('respects %i-player red opening round %i for moves', (count, opening) => {
    for (const roundNumber of [opening - 1, opening]) {
      const f = fixture(count, 'R06', roundNumber); const state = copy(f); reveal(f, state, 'D-02', 'Y02'); state.board.cityNodeByPlayer.p1 = 'D-02';
      if (roundNumber < opening) code(() => move(f, state, 'F-01', 'F-route-02'), 'MOVE_TARGET');
      else {
        const pending = move(f, state, 'F-01', 'F-route-02'); expect(pending.cityMove!.cardId).toBe('R06');
        expect(pending.board.resourceMarkerByNode['F-01']!.harvestAmount).toBe(2);
        const resolved = choose(f, pending, { choiceId: 'R06:3', influenceSlotId: f.board.resourceNodes['F-01']!.influenceSlotIds[0] });
        expect(resolved.players.p1!.balances['columbia-voucher']).toBe(state.players.p1!.balances['columbia-voucher'] + 6);
      }
    }
  });
  it.each([2, 3, 4])('can newly reveal green B-01 with %i players without its entry bonus', count => {
    const f = fixture(count); const pending = move(f, f.state, 'B-01', 'R-route-02');
    expect(pending.cityMove!.cardId).toBe(f.state.eventDecks!.green[0]);
    expect(pending.players.p1!.balances).toEqual({ ...f.state.players.p1!.balances, originium: 0 });
  });
});

describe('cross-action continuation uses the actual city and one persistent deck', () => {
  it.each([2, 3, 4])('runs move -> explore -> move with %i players without format downgrade', count => {
    const f = fixture(count); let state = finish(f, choose(f, move(f), { choiceId: 'Y01:2' }));
    const order = state.playerOrder, decks = state.eventDecks;
    state = openExplorationWindow(state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion });
    expect(state.schemaVersion).toBe('1.3.0'); expect(state.cityMove).toBeUndefined(); expect(state.eventDecks).toEqual(decks);
    const exp = (command: Record<string, unknown>) => { state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { gameId: state.gameId, expectedVersion: state.stateVersion, ...command }); };
    exp({ type: 'explore', nodeId: 'D-02', path: [{ routeId: 'D-route-01', toNodeId: 'D-02' }] });
    exp({ type: 'choose-exploration-event', choice: { choiceId: 'Y02:2' } });
    exp({ type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(state, f.definition, 'p1')[0] });
    const remaining = state.eventDecks;
    state = openCityMoveWindow(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(state.exploration).toBeUndefined(); state = move(f, state, 'D-02', 'D-route-01');
    expect(state.cityMove!.cardId).toBeNull(); state = finish(f, state);
    expect(state.eventDecks).toEqual(remaining); expect(state.playerOrder).toEqual(order); expect(state.players.p1!.balances.originium).toBe(5);
    expect(state.markerSupplyByPlayer.p1).toHaveLength(26); expect(state.cityMove!.status).toBe('complete');
    expect(validateGameState(state, f.definition).success).toBe(true);
  });
});

describe('identity, stage, strict requests and recoverable snapshots', () => {
  it.each(['move', 'event', 'final'])('guards actor and old-version retries at %s', stage => {
    const f = fixture(); let state = f.state; let command: Record<string, unknown> = { type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' };
    if (stage !== 'move') { state = move(f); command = { type: 'choose-city-move-event', choice: { choiceId: 'Y01:2' } }; }
    if (stage === 'final') { state = choose(f, state, { choiceId: 'Y01:2' }); command = { type: 'place-city-move-influence', slotId: getCityMoveFinalSlotIds(state, f.definition, 'p1')[0] }; }
    code(() => send(state, f.definition, command, 'p2'), 'WRONG_ACTOR');
    const payload = { gameId: state.gameId, expectedVersion: state.stateVersion, ...command };
    const next = applyCityMoveCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, payload);
    code(() => applyCityMoveCommand(next, f.definition, { authenticatedPlayerId: 'p1' }, payload), 'STALE_VERSION');
  });
  it.each(['actorId', 'roundNumber', 'cardId', 'cost', 'sourceNodeId', 'clearSlotIds', 'payeePlayerId', 'path'])('rejects player-supplied %s', key => {
    const f = fixture(); code(() => send(f.state, f.definition, { type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01', [key]: 123 }), 'COMMAND_SCHEMA');
  });
  it('rejects a different game and out-of-order actions', () => {
    const f = fixture(); code(() => send(f.state, f.definition, { gameId: 'other', type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' }), 'GAME_REFERENCE');
    code(() => choose(f, f.state, { choiceId: 'Y01:2' }), 'ACTION_STAGE'); const pending = move(f);
    code(() => move(f, pending), 'ACTION_STAGE');
    code(() => send(pending, f.definition, { type: 'place-city-move-influence', slotId: f.board.resourceNodes['D-01']!.influenceSlotIds[0] }), 'ACTION_STAGE');
    const completed = finish(f, choose(f, pending, { choiceId: 'Y01:2' })); code(() => move(f, completed), 'ACTION_STAGE');
  });
  it('guards pending queries and does not allow an already explored target to resolve again', () => {
    const f = fixture(); code(() => getPendingCityMoveChoiceRequirements(f.state, f.definition, 'p1', 'Y01:1'), 'ACTION_STAGE');
    const pending = move(f); code(() => getPendingCityMoveChoiceRequirements(pending, f.definition, 'p2', 'Y01:1'), 'WRONG_ACTOR');
    expect(getCityMoveOptions(f.state, f.definition, 'p2')).toEqual([]);
    code(() => choose(f, pending, { choiceId: 'Y02:1' }), 'EVENT_CHOICE');
  });
  it('cannot replace an unfinished city move with another move or exploration grant', () => {
    const f = fixture(); const pending = move(f);
    code(() => openCityMoveWindow(pending, f.definition, { actorId: 'p2', roundNumber: 2, expectedVersion: pending.stateVersion }), 'ACTION_PENDING');
    expect(() => openExplorationWindow(pending, f.definition, { actorId: 'p2', roundNumber: 2, expectedVersion: pending.stateVersion })).toThrow(/Finish entry or the existing action/);
  });
  it.each([
    ['wrong city', (s: MutableState) => { s.board.cityNodeByPlayer.p1 = 'A-01'; }],
    ['unknown source', (s: MutableState) => { s.cityMove!.sourceNodeId = 'Z-99'; }],
    ['wrong route', (s: MutableState) => { s.cityMove!.routeId = 'F-route-01'; }],
    ['unknown card', (s: MutableState) => { s.cityMove!.cardId = 'Y99'; }],
    ['already resolved', (s: MutableState) => { s.cityMove!.resolvedChoiceId = 'Y01:1'; }],
    ['old format', (s: MutableState) => { s.schemaVersion = '1.2.0'; }],
    ['mixed exploration', (s: MutableState) => { s.exploration = { actorId: 'p1', roundNumber: 1, status: 'ready', targetNodeId: null, cardId: null, resolvedChoiceId: null }; }],
    ['revealed card in deck', (s: MutableState) => { s.eventDecks!.yellow.push('Y01'); }],
    ['wrong order', (s: MutableState) => { s.playerOrder![0] = 'p2'; }],
  ] as const)('rejects invalid move snapshot: %s', (_label, mutate) => {
    const f = fixture(); const pending = gameStateSchema.parse(move(f)); mutate(pending);
    expect(validateGameState(pending, f.definition).success).toBe(false); expect(() => parseGameState(pending, f.definition)).toThrow();
  });
  it('rejects a surviving opponent in the cleared range while retaining inventory consistency', () => {
    const f = fixture(); const pending = gameStateSchema.parse(move(f)); put(pending, f.board.routes['R-route-01']!.influenceSlotIds[0]!);
    const checked = validateGameState(pending, f.definition); expect(checked.success).toBe(false);
    if (!checked.success) expect(checked.issues.map(issue => issue.code)).toContain('CITY_MOVE_PROGRESS');
  });
  it('does not allow null event metadata when an event choice is pending', () => {
    const f = fixture(); const pending = gameStateSchema.parse(move(f)); pending.cityMove!.cardId = null;
    expect(validateGameState(pending, f.definition).success).toBe(false);
  });
  it.each(['actor', 'ready-fields'])('rejects an inconsistent ready snapshot %s', kind => {
    const f = fixture(); const state = copy(f);
    if (kind === 'actor') state.cityMove!.actorId = 'ghost'; else state.cityMove!.routeId = 'R-route-01';
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('rejects event reward overflow without leaking partial payouts or reversing the move', () => {
    const f = fixture(4, 'Y06'); const pending = gameStateSchema.parse(move(f)); pending.players.p3!.balances.iron = Number.MAX_SAFE_INTEGER;
    const original = structuredClone(pending);
    code(() => choose(f, pending, { choiceId: 'Y06:2' }), 'BALANCE_OVERFLOW');
    expect(pending).toEqual(original); expect(pending.board.cityNodeByPlayer.p1).toBe('D-01'); expect(pending.players.p1!.balances.originium).toBe(0);
  });
  it('rejects overflow atomically and freezes result copies without mutating inputs', () => {
    const f = fixture(); const state = copy(f); const original = structuredClone(state); const result = move(f, state);
    expect(state).toEqual(original); expect(Object.isFrozen(state)).toBe(false);
    const visit = (v: unknown): void => { if (v && typeof v === 'object') { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(visit); } }; visit(result); visit(getCityMoveOptions(f.state, f.definition, 'p1'));
    state.stateVersion = Number.MAX_SAFE_INTEGER; const large = structuredClone(state); code(() => move(f, state), 'VERSION_OVERFLOW'); expect(state).toEqual(large);
  });
  it('supports prototype-like registered players in an actual move chain', () => {
    const players: readonly PlayerSetup[] = [{ id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' }];
    const f = fixture(2, 'Y01', 1, players), actor: string = 'constructor';
    let state = send(f.state, f.definition, { type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' }, actor);
    state = send(state, f.definition, { type: 'choose-city-move-event', choice: { choiceId: 'Y01:2' } }, actor);
    state = send(state, f.definition, { type: 'place-city-move-influence', slotId: getCityMoveFinalSlotIds(state, f.definition, actor)[0] }, actor);
    expect(state.cityMove!.status).toBe('complete'); expect(state.board.cityNodeByPlayer[actor]).toBe('D-01');
  });
});
