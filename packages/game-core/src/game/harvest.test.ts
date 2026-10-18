import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_EVENT_CATALOG, getFoundersEventCard } from '../events/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, gameStateSchema, parseGameState, validateGameState,
  openHarvestPhase, applyHarvestCommand, getHarvestQuote, getHarvestEligibleNodeIds, HarvestError,
  openDeploymentWindow, openDispatchWindow, openCityMoveWindow, openExplorationWindow,
} from './index.js';
import type { GameDefinition, GameState, PlayerSetup, HarvestPlan } from './types.js';
const seats: readonly PlayerSetup[] = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
function entry(count = 3, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const setup = createPreEntryGame('harvest-test', players);
  const greens = FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === 'green' && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(setup.state, setup.definition, { startingPlayerId: players[0]!.id, clockwisePlayerIds: players.map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...greens.filter(id => id !== 'G03')] });
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

function fixture(count = 3, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const e = entry(count, players);
  const ids = (color: 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  const state = openHarvestPhase(e.state, e.definition, { roundNumber: 1, expectedVersion: e.state.stateVersion,
    deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  return { ...e, state, board: loadFoundersBoard(count === 4 ? 'four-player' : 'three-player') };
}
type MutableState = ReturnType<typeof gameStateSchema.parse>;
const empty: HarvestPlan = { nodeIds: [], routeIds: [] };
const city: HarvestPlan = { nodeIds: ['A-01'], routeIds: [] };
const remote: HarvestPlan = { nodeIds: ['D-01'], routeIds: ['R-route-01'] };
function put(state: MutableState, slotId: string, owner = 'p1') {
  const markerId = state.markerSupplyByPlayer[owner]!.shift()!;
  if (!markerId || state.board.influenceBySlot[slotId]) throw new Error('Invalid fixture');
  state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: owner };
}
function reveal(state: MutableState, nodeId: string, cardId: string) {
  const card = getFoundersEventCard(cardId);
  state.eventDecks![card.color] = state.eventDecks![card.color].filter(id => id !== cardId);
  state.board.resourceMarkerByNode[nodeId] = { markerDefinitionId: cardId, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
}
function remoteState(count = 3) {
  const f = fixture(count), state = gameStateSchema.parse(f.state);
  reveal(state, 'D-01', 'Y01'); put(state, 'node:D-01:slot:1');
  return { ...f, state };
}
function send(state: GameState, definition: GameDefinition, plan: HarvestPlan = empty, actorId = 'p1', extras: Record<string, unknown> = {}) {
  return applyHarvestCommand(state, definition, { authenticatedPlayerId: actorId }, { type: 'set-harvest-plan',
    gameId: state.gameId, expectedVersion: state.stateVersion, plan, ...extras });
}
function finish(state: GameState, definition: GameDefinition): GameState {
  for (const player of definition.players) if (state.harvest!.plansByPlayer[player.id] === null) state = send(state, definition, empty, player.id);
  return state;
}
function code(fn: () => unknown, expected: string) {
  try { fn(); throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(HarvestError); expect((error as HarvestError).code).toBe(expected); }
}

describe('simultaneous harvest with one authoritative position', () => {
  it.each([2, 3, 4])('collects each %i-player city only after all plans, preserving board/decks/supply/order', count => {
    const f = fixture(count); let state = f.state;
    expect(state.schemaVersion).toBe('1.5.0'); expect(state.entry).toBeUndefined();
    for (const player of f.definition.players) {
      const nodeId = state.board.cityNodeByPlayer[player.id]!;
      state = send(state, f.definition, { nodeIds: [nodeId], routeIds: [] }, player.id);
      if (state.harvest!.status === 'planning') expect(state.players).toEqual(f.state.players);
    }
    for (const player of f.definition.players) {
      const marker = state.board.resourceMarkerByNode[state.board.cityNodeByPlayer[player.id]!]!;
      expect(state.players[player.id]!.balances[marker.resourceKind]).toBe(f.state.players[player.id]!.balances[marker.resourceKind] + marker.harvestAmount);
    }
    expect(state.harvest!.status).toBe('complete'); expect(state.board).toEqual(f.state.board);
    expect(state.markerSupplyByPlayer).toEqual(f.state.markerSupplyByPlayer); expect(state.eventDecks).toEqual(f.state.eventDecks);
    expect(state.playerOrder).toEqual(f.state.playerOrder); expect(state.stateVersion).toBe(f.state.stateVersion + count);
    expect(validateGameState(JSON.parse(JSON.stringify(state)), f.definition).success).toBe(true);
  });
  it('can skip all nodes at no cost', () => {
    const f = fixture(), result = finish(f.state, f.definition);
    expect(result.players).toEqual(f.state.players); expect(result.harvest!.status).toBe('complete');
  });
  it('allows replacing your plan and JSON resuming before the last submission', () => {
    const f = fixture(); let state = send(f.state, f.definition, city);
    state = parseGameState(JSON.parse(JSON.stringify(state)), f.definition);
    state = send(state, f.definition, empty); state = finish(state, f.definition);
    expect(state.players).toEqual(f.state.players); expect(state.harvest!.plansByPlayer.p1).toEqual(empty);
  });
  it('does not multiply city yield for two own influence markers', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state);
    put(state, 'node:A-01:slot:1'); put(state, 'node:A-01:slot:2');
    const marker = state.board.resourceMarkerByNode['A-01']!;
    expect(getHarvestQuote(state, f.definition, 'p1', city).gains[marker.resourceKind]).toBe(marker.harvestAmount);
  });
  it('uses the actual moved city instead of initial entry position', () => {
    const f = remoteState(); f.state.board.cityNodeByPlayer.p1 = 'D-01';
    expect(getHarvestQuote(f.state, f.definition, 'p1', { nodeIds: ['D-01'], routeIds: [] }).total).toBe(0);
    code(() => getHarvestQuote(f.state, f.definition, 'p1', city), 'HARVEST_TARGET');
  });
  it('only revealed own city or node influence grants eligibility', () => {
    const f = remoteState(); put(f.state, 'route:A-route-01:slot:1');
    expect(getHarvestEligibleNodeIds(f.state, f.definition, 'p1')).toEqual(['A-01', 'D-01']);
    expect(getHarvestEligibleNodeIds(f.state, f.definition, 'ghost')).toEqual([]);
    for (const nodeId of ['A-02', 'A-03', 'A-99']) code(() => getHarvestQuote(f.state, f.definition, 'p1', { nodeIds: [nodeId], routeIds: ['A-route-01'] }), 'HARVEST_TARGET');
  });
  it.each([
    ['orirock', 'R05', 'F-03', 2], ['originium', 'Y01', 'D-02', 1],
    ['iron', 'R02', 'F-03', 1], ['pure-originium', 'R03', 'F-03', 1],
  ] as const)('credits printed %s marker amount, with no extra red harvest round gate', (resource, cardId, nodeId, amount) => {
    const f = fixture(), state = gameStateSchema.parse(f.state);
    reveal(state, nodeId, cardId); put(state, `node:${nodeId}:slot:1`);
    const plan = { nodeIds: [nodeId], routeIds: ['R-route-01', 'D-route-01', 'F-route-02', 'F-route-01'] };
    const quote = getHarvestQuote(state, f.definition, 'p1', plan);
    expect(quote.gains[resource]).toBe(amount); const result = finish(send(state, f.definition, plan), f.definition);
    expect(result.players.p1!.balances[resource]).toBe(state.players.p1!.balances[resource] + amount);
  });
});

describe('independent hyperedges and connected selected networks', () => {
  it.each([3, 4])('charges a common trunk and four-end route once for %i players', count => {
    const f = remoteState(count); reveal(f.state, 'D-02', 'Y02'); reveal(f.state, 'D-03', 'Y03');
    put(f.state, 'node:D-02:slot:1'); put(f.state, 'node:D-03:slot:1');
    const plan = { nodeIds: ['D-01', 'D-02', 'D-03'], routeIds: ['D-route-01', 'R-route-01', 'D-route-01'] };
    const quote = getHarvestQuote(f.state, f.definition, 'p1', plan);
    expect(quote.total).toBe(4); expect(quote.legs).toHaveLength(2);
    expect(finish(send(f.state, f.definition, plan), f.definition).players.p1!.balances['columbia-voucher']).toBe(6);
  });
  it.each([3, 4])('uses the three-end A-route-02 as one identity on the %i-player map', count => {
    const f = fixture(count), state = gameStateSchema.parse(f.state);
    reveal(state, 'A-03', 'Y01'); reveal(state, 'B-03', 'Y02');
    put(state, 'node:A-03:slot:1'); put(state, 'node:B-03:slot:1');
    expect(getHarvestQuote(state, f.definition, 'p1', { nodeIds: ['A-03', 'B-03'], routeIds: ['A-route-01', 'A-route-02'] }).total).toBe(4);
  });
  it('preserves the three-player-only gray route', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); reveal(state, 'E-01', 'Y01'); put(state, 'node:E-01:slot:1');
    expect(getHarvestQuote(state, f.definition, 'p1', { nodeIds: ['E-01'], routeIds: ['A-route-01', 'B-route-01', 'C-route-02', 'R-route-09'] }).total).toBe(8);
    const four = fixture(4); code(() => getHarvestQuote(four.state, four.definition, 'p1', { nodeIds: ['A-01'], routeIds: ['R-route-09'] }), 'ROUTE_REFERENCE');
  });
  it.each([
    ['missing connection', { nodeIds: ['D-01'], routeIds: [] }, 'HARVEST_CONNECTION'],
    ['disconnected branch', { nodeIds: ['D-01'], routeIds: ['R-route-01', 'F-route-01'] }, 'HARVEST_CONNECTION'],
    ['unknown route', { nodeIds: ['D-01'], routeIds: ['A-route-99'] }, 'ROUTE_REFERENCE'],
    ['duplicate node', { nodeIds: ['D-01', 'D-01'], routeIds: ['R-route-01'] }, 'DUPLICATE_TARGET'],
    ['routes without targets', { nodeIds: [], routeIds: ['R-route-01'] }, 'EMPTY_PLAN'],
  ] as const)('rejects %s', (_name, plan, expected) => {
    const f = remoteState(); code(() => getHarvestQuote(f.state, f.definition, 'p1', plan), expected);
  });
  it('allows route order independent traversal through unexplored intermediate nodes', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); reveal(state, 'F-03', 'R03'); put(state, 'node:F-03:slot:1');
    const quote = getHarvestQuote(state, f.definition, 'p1', { nodeIds: ['F-03'], routeIds: ['F-route-01', 'F-route-02', 'D-route-01', 'R-route-01'] });
    expect(quote.total).toBe(8); expect(state.board.resourceMarkerByNode['D-02']).toBeNull();
  });
});

describe('toll ownership, payment and atomic settlement', () => {
  it('pays empty route fees to supply with no opposing balance changes', () => {
    const f = remoteState(); const result = finish(send(f.state, f.definition, remote), f.definition);
    expect(result.players.p1!.balances['columbia-voucher']).toBe(8); expect(result.players.p2).toEqual(f.state.players.p2);
  });
  it('prioritizes own influence over opponents on the same route', () => {
    const f = remoteState(4); put(f.state, 'route:R-route-01:slot:1', 'p2'); put(f.state, 'route:R-route-01:slot:2');
    const quote = getHarvestQuote(f.state, f.definition, 'p1', remote); expect(quote.total).toBe(0); expect(quote.legs[0]!.recipientPlayerIds).toEqual([]);
    expect(finish(send(f.state, f.definition, remote), f.definition).players.p1!.balances['columbia-voucher']).toBe(10);
  });
  it('automatically pays the only opponent owner once', () => {
    const f = remoteState(); put(f.state, 'route:R-route-01:slot:1', 'p2');
    const result = finish(send(f.state, f.definition, remote), f.definition);
    expect(result.players.p1!.balances['columbia-voucher']).toBe(8); expect(result.players.p2!.balances['columbia-voucher']).toBe(f.state.players.p2!.balances['columbia-voucher'] + 2);
  });
  it('requires choosing one real owner when multiple opponents control a route', () => {
    const f = remoteState(4); put(f.state, 'route:R-route-01:slot:1', 'p2'); put(f.state, 'route:R-route-01:slot:2', 'p3');
    code(() => send(f.state, f.definition, remote), 'TOLL_RECIPIENT');
    const result = finish(send(f.state, f.definition, { ...remote, tollRecipients: [{ routeId: 'R-route-01', payeePlayerId: 'p3' }] }), f.definition);
    expect(result.players.p2).toEqual(f.state.players.p2); expect(result.players.p3!.balances['columbia-voucher']).toBe(f.state.players.p3!.balances['columbia-voucher'] + 2);
  });
  it.each(['free', 'supply', 'other-route', 'non-owner', 'duplicate'])('rejects %s recipient instructions', kind => {
    const f = remoteState(4);
    if (kind === 'free') put(f.state, 'route:R-route-01:slot:1');
    else if (kind !== 'supply') put(f.state, 'route:R-route-01:slot:1', 'p2');
    const instruction = { routeId: kind === 'other-route' ? 'A-route-01' : 'R-route-01', payeePlayerId: kind === 'non-owner' ? 'p3' : 'p2' };
    code(() => send(f.state, f.definition, { ...remote, tollRecipients: kind === 'duplicate' ? [instruction, instruction] : [instruction] }), 'TOLL_RECIPIENT');
  });
  it('cannot finance a plan from incoming same-phase toll vouchers', () => {
    const f = remoteState(), state = f.state; put(state, 'route:A-route-01:slot:1', 'p1'); put(state, 'node:A-01:slot:1', 'p2');
    state.players.p1!.balances['columbia-voucher'] = 0;
    const waiting = send(state, f.definition, { nodeIds: ['A-01'], routeIds: ['A-route-01'] }, 'p2');
    expect(waiting.players.p1!.balances['columbia-voucher']).toBe(0);
    code(() => send(waiting, f.definition, remote), 'INSUFFICIENT_VOUCHERS');
    const result = finish(send(waiting, f.definition, empty), f.definition);
    expect(result.players.p1!.balances['columbia-voucher']).toBe(2);
  });
  it('charges the same network separately for each player rather than once globally', () => {
    const f = remoteState(); put(f.state, 'node:D-01:slot:2', 'p2');
    let state = send(f.state, f.definition, remote);
    state = send(state, f.definition, { nodeIds: ['D-01'], routeIds: ['A-route-01', 'R-route-01'] }, 'p2');
    const result = finish(state, f.definition);
    expect(result.players.p1!.balances['columbia-voucher']).toBe(8); expect(result.players.p2!.balances['columbia-voucher']).toBe(f.state.players.p2!.balances['columbia-voucher'] - 4);
  });
  it.each([0, 1, 2])('enforces complete pre-harvest toll affordability with %i vouchers', amount => {
    const f = remoteState(); f.state.players.p1!.balances['columbia-voucher'] = amount;
    const original = structuredClone(f.state);
    if (amount < 2) code(() => send(f.state, f.definition, remote), 'INSUFFICIENT_VOUCHERS');
    else expect(finish(send(f.state, f.definition, remote), f.definition).players.p1!.balances['columbia-voucher']).toBe(0);
    expect(f.state).toEqual(original);
  });
  it.each(['resource', 'recipient'])('rejects %s overflow with no partial debits or gains', kind => {
    const f = remoteState();
    if (kind === 'recipient') { put(f.state, 'route:R-route-01:slot:1', 'p2'); f.state.players.p2!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER; }
    else f.state.players.p1!.balances[getFoundersEventCard('Y01').resourceMarker.resource] = Number.MAX_SAFE_INTEGER;
    let state = send(f.state, f.definition, remote); state = send(state, f.definition, empty, 'p2');
    const original = structuredClone(state); code(() => send(state, f.definition, empty, 'p3'), 'BALANCE_OVERFLOW'); expect(state).toEqual(original);
  });
  it('debits all players before crediting opposing tolls near the safe integer boundary', () => {
    const f = remoteState(); put(f.state, 'route:R-route-01:slot:1', 'p2'); put(f.state, 'node:A-01:slot:1', 'p2');
    f.state.players.p2!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER;
    let state = send(f.state, f.definition, remote);
    state = send(state, f.definition, { nodeIds: ['A-01'], routeIds: ['A-route-01'] }, 'p2');
    expect(finish(state, f.definition).players.p2!.balances['columbia-voucher']).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('identity, phase grants and persisted integrity', () => {
  it.each(['actorId', 'roundNumber', 'amount', 'gains', 'balances', 'playerId'])('rejects player-supplied %s', key => {
    const f = fixture(); code(() => send(f.state, f.definition, city, 'p1', { [key]: 99 }), 'COMMAND_SCHEMA');
  });
  it('rejects unknown actor, wrong game and stale retry', () => {
    const f = fixture(); code(() => send(f.state, f.definition, empty, 'ghost'), 'WRONG_ACTOR');
    code(() => send(f.state, f.definition, empty, 'p1', { gameId: 'another' }), 'GAME_REFERENCE');
    const next = send(f.state, f.definition, city); code(() => send(next, f.definition, city, 'p1', { expectedVersion: f.state.stateVersion }), 'STALE_VERSION');
  });
  it('cannot repeat rewards or reopen a completed harvest in the same round', () => {
    const f = fixture(), complete = finish(send(f.state, f.definition, city), f.definition);
    code(() => send(complete, f.definition, city), 'HARVEST_STAGE');
    code(() => openHarvestPhase(complete, f.definition, { roundNumber: 1, expectedVersion: complete.stateVersion }), 'WINDOW_RESET');
    expect(openHarvestPhase(complete, f.definition, { roundNumber: 2, expectedVersion: complete.stateVersion }).harvest!.status).toBe('planning');
  });
  it.each([openDeploymentWindow, openDispatchWindow, openCityMoveWindow, openExplorationWindow])('blocks unfinished harvest and preserves 1.5.0 in next-round action %#', opener => {
    const f = fixture(); expect(() => opener(f.state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: f.state.stateVersion })).toThrow(/existing action/);
    const state = finish(f.state, f.definition);
    expect(() => opener(state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion })).toThrow(/reset/);
    const next = opener(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(next.schemaVersion).toBe('1.5.0'); expect(next.harvest).toBeUndefined(); expect(next.eventDecks).toEqual(state.eventDecks); expect(next.playerOrder).toEqual(state.playerOrder);
  });
  it('does not bypass an unfinished action', () => {
    const e = entry(), state = openDeploymentWindow(e.state, e.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: e.state.stateVersion });
    code(() => openHarvestPhase(state, e.definition, { roundNumber: 1, expectedVersion: state.stateVersion }), 'ACTION_PENDING');
  });
  it.each([
    ['old format', (s: MutableState) => { s.schemaVersion = '1.4.0'; }],
    ['missing player', (s: MutableState) => { delete s.harvest!.plansByPlayer.p2; }],
    ['extra player', (s: MutableState) => { s.harvest!.plansByPlayer.ghost = null; }],
    ['false complete', (s: MutableState) => { s.harvest!.status = 'complete'; }],
    ['unsettled full plans', (s: MutableState) => { for (const id of Object.keys(s.harvest!.plansByPlayer)) s.harvest!.plansByPlayer[id] = { nodeIds: [], routeIds: [] }; }],
    ['bad saved plan', (s: MutableState) => { s.harvest!.plansByPlayer.p1 = { nodeIds: ['D-01'], routeIds: [] }; }],
    ['mixed phase', (s: MutableState) => { s.influenceAction = { kind: 'deploy', actorId: 'p1', roundNumber: 1, status: 'ready', operationsCompleted: 0 }; }],
  ] as const)('rejects snapshot %s', (_label, change) => {
    const f = fixture(), state = gameStateSchema.parse(f.state); change(state); expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('freezes results/quotes deeply, preserves inputs and rejects version overflow', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), before = structuredClone(state);
    const result = send(state, f.definition, city), quote = getHarvestQuote(state, f.definition, 'p1', city);
    const visit = (value: unknown): void => { if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(visit); } };
    visit(result); visit(quote); expect(state).toEqual(before); expect(Object.isFrozen(state)).toBe(false);
    state.stateVersion = Number.MAX_SAFE_INTEGER; code(() => send(state, f.definition, city), 'VERSION_OVERFLOW');
    code(() => openHarvestPhase(finish(f.state, f.definition), f.definition, { roundNumber: 2, expectedVersion: 0 }), 'STALE_VERSION');
  });
  it('supports registered constructor and toString IDs in exact player dictionaries', () => {
    const players: readonly PlayerSetup[] = [{ id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' }];
    const f = fixture(2, players); let state = send(f.state, f.definition, city, 'constructor');
    state = send(state, f.definition, { nodeIds: ['A-02'], routeIds: [] }, 'toString');
    expect(state.harvest!.status).toBe('complete'); expect(Object.keys(state.harvest!.plansByPlayer)).toEqual(['constructor', 'toString']);
  });
});
