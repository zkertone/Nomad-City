import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_EVENT_CATALOG, getFoundersEventCard } from '../events/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, openDeploymentWindow, openDispatchWindow, applyInfluenceCommand,
  getDeploymentSlotIds, getDispatchSourceSlotIds, getDispatchTargetSlotIds, InfluenceActionError,
  gameStateSchema, validateGameState, parseGameState, getMarkerLedger,
  openExplorationWindow, applyExplorationCommand, getExplorationFinalSlotIds,
  openCityMoveWindow, applyCityMoveCommand, getCityMoveFinalSlotIds,
} from './index.js';
import type { GameDefinition, GameState, PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
function entry(count = 3, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const setup = createPreEntryGame('influence-test', players);
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
  const game = entry(count, players);
  return { ...game, state: openDeploymentWindow(game.state, game.definition, { actorId: players[0]!.id, roundNumber: 1, expectedVersion: game.state.stateVersion,
    deckOrder: {
      yellow: FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === 'yellow' && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id),
      red: FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === 'red' && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id),
    } }), board: loadFoundersBoard(count === 4 ? 'four-player' : 'three-player') };
}
type Fixture = ReturnType<typeof fixture>;
type MutableState = ReturnType<typeof gameStateSchema.parse>;
const far = 'route:F-route-01:slot:1', near = 'route:R-route-01:slot:1', ownCity = 'node:A-01:slot:1';
function send(state: GameState, definition: GameDefinition, command: Record<string, unknown>, actorId = 'p1') {
  return applyInfluenceCommand(state, definition, { authenticatedPlayerId: actorId }, { gameId: state.gameId, expectedVersion: state.stateVersion, ...command });
}
function deployed(f: Fixture, slotId = far): GameState { return send(f.state, f.definition, { type: 'deploy-influence', slotId }); }
function dispatch(f: Fixture, state = deployed(f), actorId = 'p1'): GameState {
  return openDispatchWindow(state, f.definition, { actorId, roundNumber: 1, expectedVersion: state.stateVersion });
}
function put(state: MutableState, slotId: string, owner = 'p2') {
  const markerId = state.markerSupplyByPlayer[owner]!.shift()!;
  if (!markerId || state.board.influenceBySlot[slotId]) throw new Error('Invalid fixture transfer');
  state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: owner };
  return markerId;
}
function code(fn: () => unknown, expected: string) {
  try { fn(); throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(InfluenceActionError); expect((error as InfluenceActionError).code).toBe(expected); }
}

describe('one deployment from real player supply', () => {
  it.each([2, 3, 4])('preserves real %i-player entry facts and deploys exactly one existing marker', count => {
    const e = entry(count), f = fixture(count); const markerId = f.state.markerSupplyByPlayer.p1![0]!;
    expect(f.state.schemaVersion).toBe('1.4.0'); expect(f.state.playerOrder).toEqual(e.state.entry!.playerOrder);
    expect(f.state.eventDecks!.green).toEqual(e.state.entry!.remainingGreenEventIds);
    const result = deployed(f);
    expect(result.board.influenceBySlot[far]).toEqual({ markerId, ownerPlayerId: 'p1' });
    expect(result.markerSupplyByPlayer.p1).toHaveLength(28); expect(result.influenceAction).toMatchObject({ kind: 'deploy', status: 'complete', operationsCompleted: 1 });
    expect(result.players).toEqual(f.state.players); expect(result.eventDecks).toEqual(f.state.eventDecks); expect(result.board.cityNodeByPlayer).toEqual(f.state.board.cityNodeByPlayer);
    expect(Object.keys(getMarkerLedger(result, f.definition))).toHaveLength(count * 30);
  });
  it('allows distant and red-region routes before red resource nodes open without tolls', () => {
    const f = fixture(); expect(getDeploymentSlotIds(f.state, f.definition, 'p1')).toContain(far);
    const result = deployed(f); expect(result.players.p1!.balances).toEqual(f.state.players.p1!.balances);
  });
  it('allows own explored city and rejects unexplored or opposing city nodes', () => {
    const f = fixture(); const slots = getDeploymentSlotIds(f.state, f.definition, 'p1');
    expect(slots).toContain(ownCity); expect(slots).not.toContain('node:A-02:slot:1'); expect(slots).not.toContain('node:B-01:slot:1');
    expect(deployed(f, ownCity).board.influenceBySlot[ownCity]!.ownerPlayerId).toBe('p1');
    for (const slotId of ['node:A-02:slot:1', 'node:B-01:slot:1']) code(() => deployed(f, slotId), 'DEPLOY_SLOT');
  });
  it('allows an explored city-free resource point and does not require adjacency', () => {
    const f = fixture(); const state = gameStateSchema.parse(f.state), card = getFoundersEventCard('Y01');
    state.eventDecks!.yellow = state.eventDecks!.yellow.filter(id => id !== card.id);
    state.board.resourceMarkerByNode['E-01'] = { markerDefinitionId: card.id, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
    const result = send(state, f.definition, { type: 'deploy-influence', slotId: 'node:E-01:slot:2' });
    expect(result.board.influenceBySlot['node:E-01:slot:2']!.ownerPlayerId).toBe('p1');
  });
  it('rejects occupied slots rather than replacing another marker', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); const markerId = put(state, far);
    const original = structuredClone(state); code(() => send(state, f.definition, { type: 'deploy-influence', slotId: far }), 'DEPLOY_SLOT');
    expect(state).toEqual(original); expect(state.board.influenceBySlot[far]!.markerId).toBe(markerId);
  });
  it('cannot deploy twice or opt to finish a possible deployment as dispatch', () => {
    const f = fixture(); code(() => send(f.state, f.definition, { type: 'finish-dispatch' }), 'ACTION_KIND');
    code(() => send(deployed(f), f.definition, { type: 'deploy-influence', slotId: near }), 'ACTION_STAGE');
  });
  it('automatically completes impossible deployment without creating a marker or charging resources', () => {
    const f = fixture(); const state = gameStateSchema.parse(deployed(f));
    const routeSlots = Object.entries(f.board.influenceSlots).filter(([id, slot]) => slot.kind === 'route' && state.board.influenceBySlot[id] === null).map(([id]) => id);
    const remaining = state.markerSupplyByPlayer.p1!.length;
    for (const id of routeSlots.slice(0, remaining)) put(state, id, 'p1');
    const result = openDeploymentWindow(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(result.influenceAction).toMatchObject({ status: 'complete', operationsCompleted: 0 }); expect(result.markerSupplyByPlayer.p1).toHaveLength(0);
    expect(result.board).toEqual(state.board); expect(result.players).toEqual(state.players);
  });
  it.each(['deploy', 'dispatch'])('automatically completes %s when all legal destinations are occupied', kind => {
    const f = fixture(), state = gameStateSchema.parse(deployed(f));
    put(state, ownCity, 'p1'); put(state, 'node:A-01:slot:2', 'p1');
    for (const [id, location] of Object.entries(f.board.influenceSlots)) {
      if (location.kind === 'route' && state.board.influenceBySlot[id] === null) put(state, id, state.markerSupplyByPlayer.p2!.length ? 'p2' : 'p3');
    }
    expect(state.markerSupplyByPlayer.p1!.length).toBeGreaterThan(0);
    const opener = kind === 'deploy' ? openDeploymentWindow : openDispatchWindow;
    const result = opener(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(result.influenceAction).toMatchObject({ kind, status: 'complete', operationsCompleted: 0 });
    expect(result.board).toEqual(state.board); expect(result.markerSupplyByPlayer).toEqual(state.markerSupplyByPlayer);
  });
});

describe('dispatch is up to two sequential moves with the same physical marker', () => {
  it('can finish without moving or after exactly one move', () => {
    const f = fixture(), initial = dispatch(f); const zero = send(initial, f.definition, { type: 'finish-dispatch' });
    expect(zero.influenceAction).toMatchObject({ status: 'complete', operationsCompleted: 0 }); expect(zero.board).toEqual(initial.board);
    const one = send(initial, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
    expect(one.influenceAction).toMatchObject({ status: 'ready', operationsCompleted: 1 });
    const finished = send(one, f.definition, { type: 'finish-dispatch' }); expect(finished.influenceAction).toMatchObject({ status: 'complete', operationsCompleted: 1 });
  });
  it.each([2, 3, 4])('moves the same marker twice in a %i-player game, including JSON reload', count => {
    const f = fixture(count), initial = dispatch(f), markerId = initial.board.influenceBySlot[far]!.markerId;
    const first = send(initial, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
    expect(getDispatchSourceSlotIds(first, f.definition, 'p1')).toContain(ownCity); expect(getDispatchSourceSlotIds(first, f.definition, 'p1')).not.toContain(far);
    const restored = parseGameState(JSON.parse(JSON.stringify(first)), f.definition);
    const result = send(restored, f.definition, { type: 'dispatch-influence', sourceSlotId: ownCity, targetSlotId: near });
    expect(result.board.influenceBySlot[near]).toEqual({ markerId, ownerPlayerId: 'p1' }); expect(result.board.influenceBySlot[ownCity]).toBeNull(); expect(result.board.influenceBySlot[far]).toBeNull();
    expect(result.influenceAction).toMatchObject({ status: 'complete', operationsCompleted: 2 });
    expect(result.players).toEqual(initial.players); expect(result.markerSupplyByPlayer).toEqual(initial.markerSupplyByPlayer); expect(result.eventDecks).toEqual(initial.eventDecks);
    code(() => send(result, f.definition, { type: 'dispatch-influence', sourceSlotId: near, targetSlotId: far }), 'ACTION_STAGE');
  });
  it('can move two different owned markers without touching supply', () => {
    const f = fixture(); const seed = gameStateSchema.parse(deployed(f)), other = 'route:F-route-02:slot:1';
    const firstId = seed.board.influenceBySlot[far]!.markerId, secondId = put(seed, other, 'p1');
    const initial = dispatch(f, seed); let state = send(initial, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
    state = send(state, f.definition, { type: 'dispatch-influence', sourceSlotId: other, targetSlotId: near });
    expect(state.board.influenceBySlot[ownCity]!.markerId).toBe(firstId); expect(state.board.influenceBySlot[near]!.markerId).toBe(secondId);
    expect(state.markerSupplyByPlayer).toEqual(initial.markerSupplyByPlayer);
  });
  it('permits returning to the newly vacated source, counting both moves', () => {
    const f = fixture(); let state = dispatch(f); const marker = state.board.influenceBySlot[far];
    state = send(state, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
    expect(getDispatchTargetSlotIds(state, f.definition, 'p1', ownCity)).toContain(far);
    state = send(state, f.definition, { type: 'dispatch-influence', sourceSlotId: ownCity, targetSlotId: far });
    expect(state.board.influenceBySlot[far]).toEqual(marker); expect(state.influenceAction!.operationsCompleted).toBe(2);
  });
  it('works with zero markers in supply because the board marker is reused', () => {
    const f = fixture(); const state = gameStateSchema.parse(deployed(f));
    const slots = Object.entries(f.board.influenceSlots).filter(([id, slot]) => slot.kind === 'route' && state.board.influenceBySlot[id] === null).map(([id]) => id);
    const count = state.markerSupplyByPlayer.p1!.length; for (const id of slots.slice(0, count)) put(state, id, 'p1');
    const initial = openDispatchWindow(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(initial.markerSupplyByPlayer.p1).toHaveLength(0); expect(getDispatchTargetSlotIds(initial, f.definition, 'p1', far)).toContain(ownCity);
    const result = send(initial, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
    expect(result.markerSupplyByPlayer.p1).toHaveLength(0); expect(Object.keys(getMarkerLedger(result, f.definition))).toHaveLength(90);
  });
  it('automatically completes a dispatch grant with no owned board influence', () => {
    const f = fixture(); const placed = deployed(f); const result = openDispatchWindow(placed, f.definition, { actorId: 'p2', roundNumber: 1, expectedVersion: placed.stateVersion });
    expect(result.influenceAction).toMatchObject({ actorId: 'p2', status: 'complete', operationsCompleted: 0 }); expect(result.board).toEqual(placed.board);
  });
  it('rechecks the second destination and preserves the first move after rejection', () => {
    const f = fixture(); const first = send(dispatch(f), f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
    const original = structuredClone(first);
    code(() => send(first, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: near }), 'DISPATCH_SOURCE');
    code(() => send(first, f.definition, { type: 'dispatch-influence', sourceSlotId: ownCity, targetSlotId: 'node:A-02:slot:1' }), 'DISPATCH_TARGET');
    expect(first).toEqual(original); expect(first.influenceAction!.operationsCompleted).toBe(1);
  });
  it.each(['same', 'opponent-city', 'unexplored', 'occupied'])('rejects %s destinations', kind => {
    const f = fixture(), seed = gameStateSchema.parse(deployed(f)); put(seed, near, 'p2'); const initial = dispatch(f, seed);
    const targetSlotId = kind === 'same' ? far : kind === 'opponent-city' ? 'node:A-02:slot:1' : kind === 'unexplored' ? 'node:B-01:slot:1' : near;
    code(() => send(initial, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId }), 'DISPATCH_TARGET');
  });
  it('cannot use an opposing, empty, score or supply source', () => {
    const f = fixture(); const seed = gameStateSchema.parse(deployed(f)); put(seed, near); const initial = dispatch(f, seed);
    for (const sourceSlotId of [near, ownCity]) code(() => send(initial, f.definition, { type: 'dispatch-influence', sourceSlotId, targetSlotId: 'node:A-01:slot:2' }), 'DISPATCH_SOURCE');
    for (const sourceSlotId of [initial.players.p1!.scoreMarkerId, initial.markerSupplyByPlayer.p1![0]!]) code(() => send(initial, f.definition, { type: 'dispatch-influence', sourceSlotId, targetSlotId: ownCity }), 'COMMAND_SCHEMA');
  });
});

describe('grants, identity, versions and snapshot integrity', () => {
  it('cannot switch away from unfinished dispatch or replace unfinished deployment', () => {
    const f = fixture(); code(() => openDispatchWindow(f.state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: f.state.stateVersion }), 'ACTION_PENDING');
    const first = send(dispatch(f), f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
    expect(() => openCityMoveWindow(first, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: first.stateVersion })).toThrow(/existing action/);
    expect(() => openExplorationWindow(first, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: first.stateVersion })).toThrow(/existing action/);
  });
  it.each(['deploy', 'dispatch', 'finish'])('guards current player and stale retries for %s', kind => {
    const f = fixture(), state = kind === 'deploy' ? f.state : dispatch(f);
    const command = kind === 'deploy' ? { type: 'deploy-influence', slotId: far } : kind === 'dispatch' ? { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity } : { type: 'finish-dispatch' };
    code(() => send(state, f.definition, command, 'p2'), 'WRONG_ACTOR');
    const payload = { gameId: state.gameId, expectedVersion: state.stateVersion, ...command };
    const next = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, payload);
    code(() => applyInfluenceCommand(next, f.definition, { authenticatedPlayerId: 'p1' }, payload), 'STALE_VERSION');
  });
  it('rejects wrong action kinds and wrong games', () => {
    const f = fixture(); code(() => send(f.state, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity }), 'ACTION_KIND');
    code(() => send(dispatch(f), f.definition, { type: 'deploy-influence', slotId: ownCity }), 'ACTION_KIND');
    code(() => send(f.state, f.definition, { gameId: 'other', type: 'deploy-influence', slotId: far }), 'GAME_REFERENCE');
  });
  it.each(['actorId', 'roundNumber', 'markerId', 'amount', 'cost', 'path', 'operationsCompleted'])('rejects player-supplied %s', key => {
    const f = fixture(); code(() => send(f.state, f.definition, { type: 'deploy-influence', slotId: far, [key]: 99 }), 'COMMAND_SCHEMA');
  });
  it.each(['constructor', 'score:p1', 'node:Z-99:slot:1'])('rejects malformed target %s', slotId => {
    const f = fixture(); code(() => deployed(f, slotId), 'COMMAND_SCHEMA');
  });
  it('queries return no choices for wrong players, stages, sources and prototype names', () => {
    const f = fixture(), state = dispatch(f);
    expect(getDeploymentSlotIds(f.state, f.definition, 'p2')).toEqual([]); expect(getDeploymentSlotIds(state, f.definition, 'p1')).toEqual([]);
    expect(getDispatchSourceSlotIds(state, f.definition, 'p2')).toEqual([]);
    for (const id of ['constructor', near]) expect(getDispatchTargetSlotIds(state, f.definition, 'p1', id)).toEqual([]);
  });
  it.each([
    ['wrong format', (s: MutableState) => { s.schemaVersion = '1.3.0'; }],
    ['unknown actor', (s: MutableState) => { s.influenceAction!.actorId = 'ghost'; }],
    ['deployment twice', (s: MutableState) => { s.influenceAction!.operationsCompleted = 2; }],
    ['false completion', (s: MutableState) => { s.influenceAction!.status = 'complete'; }],
    ['bad count', (s: MutableState) => { s.influenceAction!.operationsCompleted = 3; }],
    ['fractional count', (s: MutableState) => { s.influenceAction!.operationsCompleted = 0.5; }],
    ['mixed progress', (s: MutableState) => { s.exploration = { actorId: 'p1', roundNumber: 1, status: 'ready', targetNodeId: null, cardId: null, resolvedChoiceId: null }; }],
    ['missing card', (s: MutableState) => { s.eventDecks!.yellow.pop(); }],
  ] as const)('rejects persisted %s', (_label, change) => {
    const f = fixture(), state = gameStateSchema.parse(f.state); change(state); expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('rejects a ready dispatch after its two operations', () => {
    const f = fixture(), state = gameStateSchema.parse(dispatch(f)); state.influenceAction!.operationsCompleted = 2;
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('does not reset decks or let a trusted new grant travel backwards', () => {
    const f = fixture(), completed = gameStateSchema.parse(deployed(f)); completed.influenceAction!.roundNumber = 2;
    code(() => openDeploymentWindow(completed, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: completed.stateVersion }), 'WINDOW_RESET');
    code(() => openDispatchWindow(completed, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: completed.stateVersion, deckOrder: { yellow: [], red: [] } }), 'WINDOW_RESET');
  });
  it('freezes returned copies, preserves inputs and rejects version overflow atomically', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), original = structuredClone(state); const next = send(state, f.definition, { type: 'deploy-influence', slotId: far });
    expect(state).toEqual(original); expect(Object.isFrozen(state)).toBe(false);
    const visit = (v: unknown): void => { if (v && typeof v === 'object') { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(visit); } }; visit(next); visit(getDeploymentSlotIds(state, f.definition, 'p1'));
    state.stateVersion = Number.MAX_SAFE_INTEGER; const large = structuredClone(state);
    code(() => send(state, f.definition, { type: 'deploy-influence', slotId: far }), 'VERSION_OVERFLOW'); expect(state).toEqual(large);
  });
  it('supports registered constructor/toString IDs through deployment and dispatch', () => {
    const players: readonly PlayerSetup[] = [{ id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' }], f = fixture(2, players), actor: string = 'constructor';
    let state = send(f.state, f.definition, { type: 'deploy-influence', slotId: far }, actor);
    state = openDispatchWindow(state, f.definition, { actorId: actor, roundNumber: 1, expectedVersion: state.stateVersion });
    state = send(state, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity }, actor);
    state = send(state, f.definition, { type: 'finish-dispatch' }, actor);
    expect(state.influenceAction!.status).toBe('complete'); expect(state.board.influenceBySlot[ownCity]!.ownerPlayerId).toBe(actor);
  });
});

describe('four implemented actions share one authoritative position', () => {
  it.each([2, 3, 4])('executes deploy -> dispatch -> explore -> city move for %i players', count => {
    const f = fixture(count); let state = dispatch(f), markerId = state.board.influenceBySlot[far]!.markerId;
    state = send(state, f.definition, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
    state = send(state, f.definition, { type: 'dispatch-influence', sourceSlotId: ownCity, targetSlotId: near });
    const decks = state.eventDecks, order = state.playerOrder;
    state = openExplorationWindow(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(state.schemaVersion).toBe('1.4.0'); expect(state.influenceAction).toBeUndefined(); expect(state.eventDecks).toEqual(decks);
    const exp = (command: Record<string, unknown>) => { state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { gameId: state.gameId, expectedVersion: state.stateVersion, ...command }); };
    exp({ type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
    expect(state.players.p1!.balances['columbia-voucher']).toBe(10); // Dispatched route influence makes this free.
    exp({ type: 'choose-exploration-event', choice: { choiceId: 'Y01:2' } });
    exp({ type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(state, f.definition, 'p1')[0] });
    state = openCityMoveWindow(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(state.schemaVersion).toBe('1.4.0');
    const city = (command: Record<string, unknown>) => { state = applyCityMoveCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { gameId: state.gameId, expectedVersion: state.stateVersion, ...command }); };
    city({ type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' });
    expect(state.cityMove!.cardId).toBeNull(); city({ type: 'place-city-move-influence', slotId: getCityMoveFinalSlotIds(state, f.definition, 'p1')[0] });
    expect(state.board.influenceBySlot[near]!.markerId).toBe(markerId); expect(state.markerSupplyByPlayer.p1).toHaveLength(26);
    expect(state.players.p1!.balances.originium).toBe(4); expect(state.playerOrder).toEqual(order); expect(validateGameState(state, f.definition).success).toBe(true);
    const reopened = openDeploymentWindow(state, f.definition, { actorId: 'p2', roundNumber: 2, expectedVersion: state.stateVersion });
    expect(reopened.schemaVersion).toBe('1.4.0'); expect(reopened.cityMove).toBeUndefined(); expect(reopened.eventDecks).toEqual(state.eventDecks);
  });
});
