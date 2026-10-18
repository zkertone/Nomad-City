import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { getFoundersEventCard, FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, openExplorationWindow, applyExplorationCommand,
  getExplorationTollQuote, getExplorationFinalSlotIds, getPendingExplorationChoiceRequirements,
  gameStateSchema, validateGameState, parseGameState, getMarkerLedger,
  ExplorationCommandError, redExplorationOpeningRound,
} from './index.js';
import type { GameDefinition, GameState, PlayerSetup } from './types.js';
import type { ExplorationPathStep } from './exploration.js';

const seats: readonly PlayerSetup[] = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
function finishedEntry(count = 4, players: readonly PlayerSetup[] = seats.slice(0, count), startingPlayerId = players[0]!.id) {
  const game = createPreEntryGame('exploration-game', players);
  let state = beginEntry(game.state, game.definition, { startingPlayerId,
    clockwisePlayerIds: players.map(player => player.id), expectedVersion: 0,
    greenDeckOrder: FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === 'green' && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id),
  });
  const nodes = ['A-01', 'A-02', 'B-02', 'C-01'];
  for (const [index, actorId] of state.entry!.playerOrder.entries()) {
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: actorId }, {
      gameId: state.gameId, expectedVersion: state.stateVersion, type: 'select-initial-node', nodeId: nodes[index],
    });
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: actorId }, {
      gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1`,
    });
  }
  if (count === 2) state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: state.entry!.playerOrder[1]! }, {
    gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-entry-influence', slotId: null,
  });
  return { definition: game.definition, state };
}
function fixture(count = 4, cardId = 'Y01', roundNumber = 1, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const game = finishedEntry(count, players);
  const deck = (color: 'yellow' | 'red') => {
    const ids = FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
    return ids.includes(cardId) ? [cardId, ...ids.filter(id => id !== cardId)] : ids;
  };
  const state = openExplorationWindow(game.state, game.definition, { actorId: players[0]!.id, roundNumber,
    expectedVersion: game.state.stateVersion, deckOrder: { yellow: deck('yellow'), red: deck('red') } });
  return { ...game, state, board: loadFoundersBoard(count === 4 ? 'four-player' : 'three-player') };
}
type Fixture = ReturnType<typeof fixture>;
const copy = (f: Fixture) => gameStateSchema.parse(f.state);
const pathToD01: readonly ExplorationPathStep[] = [{ routeId: 'R-route-01', toNodeId: 'D-01' }];
function send(state: GameState, definition: GameDefinition, command: Record<string, unknown>, actorId = 'p1') {
  return applyExplorationCommand(state, definition, { authenticatedPlayerId: actorId }, {
    gameId: state.gameId, expectedVersion: state.stateVersion, ...command,
  });
}
const explore = (f: Fixture, state = f.state, nodeId = 'D-01', path = pathToD01) => send(state, f.definition, { type: 'explore', nodeId, path });
function choose(f: Fixture, state: GameState, choice: Record<string, unknown>) { return send(state, f.definition, { type: 'choose-exploration-event', choice }); }
function placeMarker(f: Fixture, state: ReturnType<typeof copy>, slotId: string, ownerId = 'p2') {
  expect(state.board.influenceBySlot[slotId]).toBeNull();
  const markerId = state.markerSupplyByPlayer[ownerId]!.shift()!;
  if (!markerId) throw new Error('Fixture exhausted');
  state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: ownerId };
  expect(validateGameState(state, f.definition).success).toBe(true);
}
function exhaustSupply(f: Fixture, state: ReturnType<typeof copy>, leave = 0) {
  const slots = Object.entries(f.board.influenceSlots).filter(([id, slot]) => slot.kind === 'route' && state.board.influenceBySlot[id] === null).map(([id]) => id);
  const amount = state.markerSupplyByPlayer.p1!.length - leave;
  for (const id of slots.slice(0, amount)) placeMarker(f, state, id, 'p1');
  expect(state.markerSupplyByPlayer.p1).toHaveLength(leave);
}
function code(fn: () => unknown, expected: string) {
  try { fn(); throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(ExplorationCommandError); expect((error as ExplorationCommandError).code).toBe(expected); }
}
function pathBetween(f: Fixture, from: string, to: string): ExplorationPathStep[] {
  const queue: [string, ExplorationPathStep[]][] = [[from, []]]; const visited = new Set([from]);
  for (let i = 0; i < queue.length; i++) {
    const [nodeId, path] = queue[i]!;
    if (nodeId === to) return path;
    for (const route of Object.values(f.board.routes).filter(route => route.incidentNodeIds.includes(nodeId))) {
      for (const next of route.incidentNodeIds) if (!visited.has(next)) {
        visited.add(next); queue.push([next, [...path, { routeId: route.id, toNodeId: next }]]);
      }
    }
  }
  throw new Error('No path');
}

describe('trusted exploration integration boundary', () => {
  it.each([2, 3, 4])('opens an independently granted action for %i players after actual entry', count => {
    const entry = finishedEntry(count); const f = fixture(count);
    expect(f.state.schemaVersion).toBe('1.2.0'); expect(f.state.phase).toBe('exploration');
    expect(f.state.stateVersion).toBe(entry.state.stateVersion + 1);
    expect(f.state.entry).toBeUndefined(); expect(f.state.players).toEqual(entry.state.players);
    expect(f.state.eventDecks!.green).toEqual(entry.state.entry!.remainingGreenEventIds);
    expect(f.state.exploration).toEqual({ actorId: 'p1', roundNumber: 1, status: 'ready', targetNodeId: null, cardId: null, resolvedChoiceId: null });
    for (const color of ['yellow', 'red'] as const) expect(f.state.eventDecks![color]).toHaveLength(color === 'yellow' ? (count === 4 ? 10 : 8) : (count === 4 ? 6 : 5));
  });
  it('does not grant an exploration before entry finishes or while another action is pending', () => {
    const game = createPreEntryGame('before-entry', seats.slice(0, 3));
    code(() => openExplorationWindow(game.state, game.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: 0 }), 'ACTION_PENDING');
    const f = fixture(); code(() => openExplorationWindow(f.state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: f.state.stateVersion }), 'ACTION_PENDING');
  });
  it('uses real shuffled eligible decks when the server supplies no deterministic order', () => {
    const game = finishedEntry(3);
    const state = openExplorationWindow(game.state, game.definition, { actorId: 'p2', roundNumber: 2, expectedVersion: game.state.stateVersion });
    expect(state.eventDecks!.green).toEqual(game.state.entry!.remainingGreenEventIds);
    expect([...state.eventDecks!.yellow].sort()).toEqual(['Y01', 'Y02', 'Y03', 'Y04', 'Y05', 'Y06', 'Y07', 'Y09']);
  });
  it('preserves the actual starting/clockwise order across format transition and JSON reload', () => {
    const game = finishedEntry(4, seats, 'p3');
    const state = openExplorationWindow(game.state, game.definition, { actorId: 'p3', roundNumber: 1, expectedVersion: game.state.stateVersion });
    expect(state.playerOrder).toEqual(['p3', 'p4', 'p1', 'p2']);
    expect(parseGameState(JSON.parse(JSON.stringify(state)), game.definition).playerOrder).toEqual(game.state.entry!.playerOrder);
  });
  it.each(['ghost', 'duplicate', 'excluded'])('rejects invalid trusted setup %s', kind => {
    const game = finishedEntry(3);
    const yellow = ['Y01', 'Y02', 'Y03', 'Y04', 'Y05', 'Y06', 'Y07', 'Y09'];
    if (kind === 'duplicate') yellow[1] = 'Y01'; if (kind === 'excluded') yellow[1] = 'Y08';
    code(() => openExplorationWindow(game.state, game.definition, { actorId: kind === 'ghost' ? 'ghost' : 'p1', roundNumber: 1,
      expectedVersion: game.state.stateVersion, deckOrder: { yellow, red: ['R02', 'R03', 'R04', 'R05', 'R06'] } }), kind === 'ghost' ? 'ACTOR_REFERENCE' : 'EVENT_DECK');
  });
  it.each([0, 9, 1.5])('rejects invalid trusted round %s', roundNumber => {
    const game = finishedEntry(); code(() => openExplorationWindow(game.state, game.definition, { actorId: 'p1', roundNumber, expectedVersion: game.state.stateVersion }), 'WINDOW_SCHEMA');
  });
  it('rejects stale or overflowing trusted grants without modifying the entry snapshot', () => {
    const game = finishedEntry(); const original = structuredClone(game.state);
    code(() => openExplorationWindow(game.state, game.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: 0 }), 'STALE_VERSION');
    expect(game.state).toEqual(original);
    const state = gameStateSchema.parse(game.state); state.stateVersion = Number.MAX_SAFE_INTEGER;
    code(() => openExplorationWindow(state, game.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion }), 'VERSION_OVERFLOW');
    expect(state.phase).toBe('entry');
  });
});

describe('server recomputes route identities, connectivity and tolls', () => {
  it('charges an empty four-ended route once and does not move the city', () => {
    const f = fixture(); const before = f.state.players.p1!.balances['columbia-voucher'];
    expect(getExplorationTollQuote(f.state, f.definition, 'p1', 'D-01', pathToD01)).toEqual({ total: 2, legs: [{ routeId: 'R-route-01', amount: 2, recipientPlayerIds: [], toSupply: true }] });
    const state = explore(f);
    expect(state.players.p1!.balances['columbia-voucher']).toBe(before - 2);
    expect(state.board.cityNodeByPlayer).toEqual(f.state.board.cityNodeByPlayer);
    expect(state.exploration!.status).toBe('event-choice'); expect(state.exploration!.cardId).toBe('Y01');
    expect(state.board.resourceMarkerByNode['D-01']!.markerDefinitionId).toBe('Y01');
    expect(state.eventDecks!.yellow).toHaveLength(9);
  });
  it('own influence makes the route free even with an opponent on the same route', () => {
    const f = fixture(); const state = copy(f); const slots = f.board.routes['R-route-01']!.influenceSlotIds;
    placeMarker(f, state, slots[0]!, 'p1'); placeMarker(f, state, slots[1]!, 'p2');
    const result = explore(f, state);
    expect(getExplorationTollQuote(state, f.definition, 'p1', 'D-01', pathToD01).total).toBe(0);
    expect(result.players).toEqual(state.players);
  });
  it('pays 2 to the unique opposing owner, not 2 per marker', () => {
    const f = fixture(); const state = copy(f); const slots = f.board.routes['R-route-01']!.influenceSlotIds;
    for (const slot of slots) placeMarker(f, state, slot, 'p2');
    const result = explore(f, state);
    expect(result.players.p2!.balances['columbia-voucher'] - state.players.p2!.balances['columbia-voucher']).toBe(2);
    expect(state.players.p1!.balances['columbia-voucher'] - result.players.p1!.balances['columbia-voucher']).toBe(2);
  });
  it('requires the player to choose one actual owner when a route has multiple opponents', () => {
    const f = fixture(); const state = copy(f); const slots = f.board.routes['R-route-01']!.influenceSlotIds;
    placeMarker(f, state, slots[0]!, 'p2'); placeMarker(f, state, slots[1]!, 'p3');
    code(() => explore(f, state), 'TOLL_RECIPIENT');
    code(() => explore(f, state, 'D-01', [{ ...pathToD01[0]!, payeePlayerId: 'p4' }]), 'TOLL_RECIPIENT');
    const result = explore(f, state, 'D-01', [{ ...pathToD01[0]!, payeePlayerId: 'p3' }]);
    expect(result.players.p2).toEqual(state.players.p2);
    expect(result.players.p3!.balances['columbia-voucher']).toBe(state.players.p3!.balances['columbia-voucher'] + 2);
  });
  it('does not double-charge a route identity revisited in a continuous walk', () => {
    const f = fixture(); const path = [{ routeId: 'R-route-01', toNodeId: 'G-02' }, { routeId: 'R-route-01', toNodeId: 'D-01' }];
    expect(getExplorationTollQuote(f.state, f.definition, 'p1', 'D-01', path).total).toBe(2);
    expect(explore(f, f.state, 'D-01', path).players.p1!.balances['columbia-voucher']).toBe(f.state.players.p1!.balances['columbia-voucher'] - 2);
  });
  it('rejects conflicting payees on the same reused route', () => {
    const f = fixture(); const state = copy(f); const slots = f.board.routes['R-route-01']!.influenceSlotIds;
    placeMarker(f, state, slots[0]!, 'p2'); placeMarker(f, state, slots[1]!, 'p3');
    code(() => explore(f, state, 'D-01', [
      { routeId: 'R-route-01', toNodeId: 'G-02', payeePlayerId: 'p2' },
      { routeId: 'R-route-01', toNodeId: 'D-01', payeePlayerId: 'p3' },
    ]), 'TOLL_RECIPIENT');
  });
  it.each(['supply', 'own'])('rejects an unsolicited player payee on a %s route', kind => {
    const f = fixture(); const state = copy(f);
    if (kind === 'own') placeMarker(f, state, f.board.routes['R-route-01']!.influenceSlotIds[0]!, 'p1');
    code(() => explore(f, state, 'D-01', [{ ...pathToD01[0]!, payeePlayerId: 'p2' }]), 'TOLL_RECIPIENT');
  });
  it('supports a multi-route path through unexplored nodes and charges its unique routes', () => {
    const f = fixture(); const path = [
      { routeId: 'R-route-01', toNodeId: 'D-01' }, { routeId: 'D-route-01', toNodeId: 'D-03' }, { routeId: 'R-route-06', toNodeId: 'E-01' },
    ];
    expect(getExplorationTollQuote(f.state, f.definition, 'p1', 'E-01', path).total).toBe(6);
    const result = explore(f, f.state, 'E-01', path);
    expect(result.board.resourceMarkerByNode['D-01']).toBeNull(); expect(result.board.resourceMarkerByNode['D-03']).toBeNull();
    expect(result.board.resourceMarkerByNode['E-01']!.markerDefinitionId).toBe('Y01');
  });
  it.each([
    ['missing route', [{ routeId: 'A-route-99', toNodeId: 'D-01' }], 'PATH_CONNECTION'],
    ['disconnected route', [{ routeId: 'F-route-03', toNodeId: 'F-01' }], 'PATH_CONNECTION'],
    ['wrong endpoint', [{ routeId: 'R-route-01', toNodeId: 'B-03' }], 'PATH_CONNECTION'],
    ['zero step', [{ routeId: 'R-route-01', toNodeId: 'A-01' }], 'PATH_CONNECTION'],
    ['wrong final target', [{ routeId: 'R-route-01', toNodeId: 'G-02' }], 'PATH_TARGET'],
    ['empty path', [], 'PATH_SCHEMA'],
    ['prototype route', [{ routeId: 'constructor', toNodeId: 'D-01' }], 'PATH_SCHEMA'],
  ] as const)('rejects %s', (_label, path, expected) => {
    const f = fixture(); code(() => getExplorationTollQuote(f.state, f.definition, 'p1', 'D-01', path), expected);
  });
  it('checks affordability before drawing and cannot use future event vouchers to pay', () => {
    const f = fixture(4, 'Y05'); const state = copy(f); state.players.p1!.balances['columbia-voucher'] = 1;
    const original = structuredClone(state); code(() => explore(f, state), 'CANNOT_PAY'); expect(state).toEqual(original);
  });
  it('rejects a toll credit overflow without debiting, drawing or mutating the input', () => {
    const f = fixture(); const state = copy(f); placeMarker(f, state, f.board.routes['R-route-01']!.influenceSlotIds[0]!, 'p2');
    state.players.p2!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER;
    const original = structuredClone(state); code(() => explore(f, state), 'BALANCE_OVERFLOW'); expect(state).toEqual(original);
  });
});

describe('player-count red restrictions and independent decks', () => {
  it.each([[2, 6], [3, 5], [4, 4]])('opens red exploration at exactly round %i-player/%i', (count, opening) => {
    expect(redExplorationOpeningRound(count)).toBe(opening);
    const closed = fixture(count, 'R06', opening - 1); const opened = fixture(count, 'R06', opening);
    const path = pathBetween(opened, 'A-01', 'F-01');
    code(() => explore(closed, closed.state, 'F-01', path), 'RED_CLOSED');
    expect(explore(opened, opened.state, 'F-01', path).exploration!.cardId).toBe('R06');
  });
  it('can use a red-region route to explore an open yellow target before red nodes open', () => {
    const f = fixture();
    const path = [
      { routeId: 'R-route-01', toNodeId: 'D-01' }, { routeId: 'D-route-01', toNodeId: 'D-02' },
      { routeId: 'F-route-02', toNodeId: 'F-01' }, { routeId: 'F-route-03', toNodeId: 'F-02' },
      { routeId: 'E-route-02', toNodeId: 'E-01' },
    ];
    const result = explore(f, f.state, 'E-01', path);
    expect(result.board.resourceMarkerByNode['F-01']).toBeNull(); expect(result.board.resourceMarkerByNode['E-01']).not.toBeNull();
  });
  it.each([2, 3, 4])('can explore a remaining green point using preserved green order with %i players', count => {
    const f = fixture(count); const expected = f.state.eventDecks!.green[0]!;
    const state = explore(f, f.state, 'B-01', [{ routeId: 'R-route-02', toNodeId: 'B-01' }]);
    expect(state.exploration!.cardId).toBe(expected); expect(state.eventDecks!.yellow).toEqual(f.state.eventDecks!.yellow);
    expect(state.players.p1!.balances.orirock).toBe(f.state.players.p1!.balances.orirock); // No B-01 entry bonus during exploration.
  });
});

describe('persisted event and separate action-end placement', () => {
  it.each([2, 3, 4])('completes the actual %i-player entry -> yellow exploration chain', count => {
    const f = fixture(count); const pending = explore(f);
    const resolved = choose(f, pending, { choiceId: 'Y01:1' });
    expect(resolved.exploration!.status).toBe('final-influence');
    expect(resolved.players.p1!.balances.iron).toBe(pending.players.p1!.balances.iron + 3);
    const slot = getExplorationFinalSlotIds(resolved, f.definition, 'p1')[0]!;
    const result = send(resolved, f.definition, { type: 'place-exploration-influence', slotId: slot });
    expect(result.exploration!.status).toBe('complete'); expect(result.stateVersion).toBe(f.state.stateVersion + 3);
    expect(result.markerSupplyByPlayer.p1).toHaveLength(28);
    expect(Object.keys(getMarkerLedger(result, f.definition))).toHaveLength(count * 30);
  });
  it('persists the revealed choice across JSON reload without redrawing/recharging', () => {
    const f = fixture(4, 'Y06'); const pending = explore(f); const restored = parseGameState(JSON.parse(JSON.stringify(pending)), f.definition);
    const resolved = choose(f, restored, { choiceId: 'Y06:2' });
    expect(resolved.eventDecks).toEqual(pending.eventDecks);
    expect(resolved.players.p1!.balances['columbia-voucher']).toBe(pending.players.p1!.balances['columbia-voucher'] + 13);
    for (const id of ['p2', 'p3', 'p4']) expect(resolved.players[id]!.balances.iron).toBe(pending.players[id]!.balances.iron + 1);
    const again = send.bind(null, resolved, f.definition, { type: 'choose-exploration-event', choice: { choiceId: 'Y06:2' } });
    code(again, 'ACTION_STAGE');
  });
  it('Y05 event placement does not swallow the later target placement', () => {
    const f = fixture(4, 'Y05'); const pending = explore(f);
    const routeSlot = f.board.routes['A-route-02']!.influenceSlotIds[0]!;
    expect(getPendingExplorationChoiceRequirements(pending, f.definition, 'p1', 'Y05:1').legalInfluenceSlotIds).toContain(routeSlot);
    const resolved = choose(f, pending, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: routeSlot });
    expect(resolved.players.p1!.balances['columbia-voucher']).toBe(pending.players.p1!.balances['columbia-voucher'] - 4);
    expect(resolved.markerSupplyByPlayer.p1).toHaveLength(28); expect(resolved.exploration!.status).toBe('final-influence');
    const result = send(resolved, f.definition, { type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(resolved, f.definition, 'p1')[0] });
    expect(result.markerSupplyByPlayer.p1).toHaveLength(27); expect(result.board.influenceBySlot[routeSlot]).not.toBeNull();
  });
  it('Y05 can decline its cost and still performs mandatory final placement', () => {
    const f = fixture(4, 'Y05'); const pending = explore(f); const resolved = choose(f, pending, { choiceId: 'Y05:1', costDecision: 'decline' });
    expect(resolved.players).toEqual(pending.players); expect(resolved.exploration!.status).toBe('final-influence');
    expect(getExplorationFinalSlotIds(resolved, f.definition, 'p1')).toHaveLength(2);
  });
  it('event placement in the last target slot makes final placement impossible without undoing the event', () => {
    const f = fixture(4, 'Y05'); const pending = gameStateSchema.parse(explore(f));
    const slots = f.board.resourceNodes['D-01']!.influenceSlotIds; placeMarker(f, pending, slots[0]!);
    const resolved = choose(f, pending, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: slots[1] });
    expect(resolved.exploration!.status).toBe('complete'); expect(resolved.players.p1!.balances['columbia-voucher']).toBe(pending.players.p1!.balances['columbia-voucher'] - 4);
    expect(resolved.markerSupplyByPlayer.p1).toHaveLength(28);
  });
  it('the event can consume the last supply marker; final placement is skipped without creating a new one', () => {
    const f = fixture(4, 'Y05'); const pending = gameStateSchema.parse(explore(f)); exhaustSupply(f, pending, 1);
    const slotId = f.board.resourceNodes['D-01']!.influenceSlotIds[0]!;
    const resolved = choose(f, pending, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: slotId });
    expect(resolved.markerSupplyByPlayer.p1).toHaveLength(0); expect(resolved.exploration!.status).toBe('complete');
    expect(Object.keys(getMarkerLedger(resolved, f.definition))).toHaveLength(120);
  });
  it('without supply, both event and final placements skip but R06 rewards remain', () => {
    const f = fixture(4, 'R06', 4); const source = copy(f); exhaustSupply(f, source);
    const pending = explore(f, source, 'F-01', pathBetween(f, 'A-01', 'F-01'));
    const resolved = choose(f, pending, { choiceId: 'R06:3' });
    expect(resolved.players.p1!.balances['columbia-voucher']).toBe(pending.players.p1!.balances['columbia-voucher'] + 6);
    expect(resolved.exploration!.status).toBe('complete'); expect(resolved.markerSupplyByPlayer.p1).toHaveLength(0);
  });
  it('rechecks final slots after reload and rejects a route or another node', () => {
    const f = fixture(); const pending = explore(f); const resolved = choose(f, pending, { choiceId: 'Y01:1' });
    const restored = parseGameState(JSON.parse(JSON.stringify(resolved)), f.definition);
    for (const slotId of [f.board.routes['R-route-01']!.influenceSlotIds[0], f.board.resourceNodes['A-01']!.influenceSlotIds[0]]) {
      code(() => send(restored, f.definition, { type: 'place-exploration-influence', slotId }), 'FINAL_SLOT');
    }
    expect(getExplorationFinalSlotIds(restored, f.definition, 'p2')).toEqual([]);
  });
  it('does not allow a new exploration, event skip or final placement out of order', () => {
    const f = fixture(); const pending = explore(f);
    code(() => explore(f, pending), 'ACTION_STAGE');
    code(() => send(pending, f.definition, { type: 'place-exploration-influence', slotId: f.board.resourceNodes['D-01']!.influenceSlotIds[0] }), 'ACTION_STAGE');
    code(() => choose(f, f.state, { choiceId: 'Y01:1' }), 'ACTION_STAGE');
    code(() => choose(f, pending, { choiceId: 'Y02:1' }), 'EVENT_CHOICE');
  });
  it('requires a new trusted grant after completion and never resets or redraws decks', () => {
    const f = fixture(); let state = choose(f, explore(f), { choiceId: 'Y01:1' });
    state = send(state, f.definition, { type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(state, f.definition, 'p1')[0] });
    code(() => explore(f, state), 'ACTION_STAGE');
    const next = openExplorationWindow(state, f.definition, { actorId: 'p2', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(next.eventDecks).toEqual(state.eventDecks); expect(next.exploration!.actorId).toBe('p2');
    expect(next.stateVersion).toBe(state.stateVersion + 1);
    code(() => openExplorationWindow(state, f.definition, { actorId: 'p2', roundNumber: 1, expectedVersion: state.stateVersion,
      deckOrder: { yellow: [], red: [] } }), 'WINDOW_RESET');
    const round2 = gameStateSchema.parse(state); round2.exploration!.roundNumber = 2;
    code(() => openExplorationWindow(round2, f.definition, { actorId: 'p2', roundNumber: 1, expectedVersion: round2.stateVersion }), 'WINDOW_RESET');
  });
});

describe('request identity, versions and persisted integrity', () => {
  it.each(['explore', 'choose', 'final'])('rejects wrong actors and stale retries at %s stage', stage => {
    const f = fixture(); let state = f.state;
    let command: Record<string, unknown> = { type: 'explore', nodeId: 'D-01', path: pathToD01 };
    if (stage !== 'explore') { state = explore(f); command = { type: 'choose-exploration-event', choice: { choiceId: 'Y01:1' } }; }
    if (stage === 'final') { state = choose(f, state, { choiceId: 'Y01:1' }); command = { type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(state, f.definition, 'p1')[0] }; }
    code(() => send(state, f.definition, command, 'p2'), 'WRONG_ACTOR');
    const payload = { gameId: state.gameId, expectedVersion: state.stateVersion, ...command };
    const result = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, payload);
    code(() => applyExplorationCommand(result, f.definition, { authenticatedPlayerId: 'p1' }, payload), 'STALE_VERSION');
  });
  it.each(['actorId', 'roundNumber', 'cardId', 'eventDecks', 'reward', 'totalFee'])('rejects player-supplied %s', key => {
    const f = fixture(); code(() => send(f.state, f.definition, { type: 'explore', nodeId: 'D-01', path: pathToD01, [key]: 999 }), 'COMMAND_SCHEMA');
  });
  it('rejects a wrong game, occupied target and unknown target', () => {
    const f = fixture(); code(() => send(f.state, f.definition, { gameId: 'other-game', type: 'explore', nodeId: 'D-01', path: pathToD01 }), 'GAME_REFERENCE');
    for (const nodeId of ['A-01', 'Z-99', 'constructor']) code(() => getExplorationTollQuote(f.state, f.definition, 'p1', nodeId, pathToD01), 'EXPLORATION_TARGET');
  });
  it.each([
    ['missing deck entry', (s: ReturnType<typeof copy>) => { s.eventDecks!.yellow.pop(); }],
    ['duplicate deck entry', (s: ReturnType<typeof copy>) => { s.eventDecks!.yellow[1] = s.eventDecks!.yellow[0]!; }],
    ['cross-color deck', (s: ReturnType<typeof copy>) => { s.eventDecks!.yellow[0] = 'G05'; }],
    ['absent city', (s: ReturnType<typeof copy>) => { s.board.cityNodeByPlayer.p2 = null; }],
    ['duplicated order', (s: ReturnType<typeof copy>) => { s.playerOrder![1] = s.playerOrder![0]!; }],
    ['unknown actor', (s: ReturnType<typeof copy>) => { s.exploration!.actorId = 'ghost'; }],
    ['legacy format', (s: ReturnType<typeof copy>) => { s.schemaVersion = '1.1.0'; }],
    ['spurious target', (s: ReturnType<typeof copy>) => { s.exploration!.targetNodeId = 'D-01'; }],
    ['spurious entry progress', (s: ReturnType<typeof copy>) => { s.entry = gameStateSchema.parse(finishedEntry().state).entry!; }],
  ] as const)('rejects persisted %s', (_label, change) => {
    const f = fixture(); const state = copy(f); change(state);
    expect(validateGameState(state, f.definition).success).toBe(false); expect(() => parseGameState(state, f.definition)).toThrow();
  });
  it.each(['card', 'choice', 'target', 'stage', 'duplicate'])('rejects inconsistent pending event %s', kind => {
    const f = fixture(); const state = gameStateSchema.parse(explore(f));
    if (kind === 'card') state.exploration!.cardId = 'Y99';
    if (kind === 'choice') state.exploration!.resolvedChoiceId = 'Y01:1';
    if (kind === 'target') state.exploration!.targetNodeId = 'D-02';
    if (kind === 'stage') state.exploration!.status = 'final-influence';
    if (kind === 'duplicate') state.eventDecks!.yellow.push('Y01');
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('returns frozen results, leaves input unchanged and rejects version overflow atomically', () => {
    const f = fixture(); const state = copy(f); const original = structuredClone(state);
    const result = explore(f, state); expect(state).toEqual(original); expect(Object.isFrozen(state)).toBe(false);
    const visit = (v: unknown): void => { if (v && typeof v === 'object') { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(visit); } };
    visit(result); visit(getExplorationTollQuote(f.state, f.definition, 'p1', 'D-01', pathToD01));
    state.stateVersion = Number.MAX_SAFE_INTEGER;
    const overflowing = structuredClone(state); code(() => explore(f, state), 'VERSION_OVERFLOW'); expect(state).toEqual(overflowing);
  });
  it('supports special registered IDs through a real exploration/choice/final chain', () => {
    const players: readonly PlayerSetup[] = [{ id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' }];
    const f = fixture(2, 'Y01', 1, players); const actor: string = 'constructor';
    let state = send(f.state, f.definition, { type: 'explore', nodeId: 'D-01', path: pathToD01 }, actor);
    state = send(state, f.definition, { type: 'choose-exploration-event', choice: { choiceId: 'Y01:1' } }, actor);
    state = send(state, f.definition, { type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(state, f.definition, actor)[0] }, actor);
    expect(state.exploration!.status).toBe('complete'); expect(state.players[actor]!.balances.iron).toBe(f.state.players[actor]!.balances.iron + 3);
  });
  it('keeps failed event choice input and previously paid road fees intact', () => {
    const f = fixture(4, 'Y05'); const pending = gameStateSchema.parse(explore(f)); pending.players.p1!.balances['columbia-voucher'] = 3;
    const original = structuredClone(pending);
    code(() => choose(f, pending, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: f.board.resourceNodes['D-01']!.influenceSlotIds[0] }), 'CANNOT_PAY');
    expect(pending).toEqual(original); expect(pending.exploration!.status).toBe('event-choice');
    const result = choose(f, pending, { choiceId: 'Y05:1', costDecision: 'decline' }); expect(result.players.p1!.balances['columbia-voucher']).toBe(3);
  });
  it('rejects reward overflow without consuming the pending event or applying partial rewards', () => {
    const f = fixture(4, 'Y06'); const pending = gameStateSchema.parse(explore(f));
    pending.players.p3!.balances.iron = Number.MAX_SAFE_INTEGER;
    const original = structuredClone(pending);
    code(() => choose(f, pending, { choiceId: 'Y06:2' }), 'BALANCE_OVERFLOW');
    expect(pending).toEqual(original); expect(pending.exploration!.status).toBe('event-choice');
  });
  it('guards choice requirement queries by pending stage and actor', () => {
    const f = fixture();
    code(() => getPendingExplorationChoiceRequirements(f.state, f.definition, 'p1', 'Y01:1'), 'ACTION_STAGE');
    const pending = explore(f);
    code(() => getPendingExplorationChoiceRequirements(pending, f.definition, 'p2', 'Y01:1'), 'WRONG_ACTOR');
    code(() => getExplorationTollQuote(f.state, f.definition, 'p2', 'D-01', pathToD01), 'WRONG_ACTOR');
  });
  it('keeps resource marker kind/quantity exactly equal to the revealed red card', () => {
    const f = fixture(4, 'R06', 4); const state = explore(f, f.state, 'F-01', pathBetween(f, 'A-01', 'F-01'));
    const card = getFoundersEventCard('R06');
    expect(state.board.resourceMarkerByNode['F-01']).toEqual({ markerDefinitionId: 'R06', resourceKind: card.resourceMarker.resource, harvestAmount: 2 });
  });
});
