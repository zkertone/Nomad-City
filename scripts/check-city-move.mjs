import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';

assert.equal(core.applyCityMoveCommand, game.applyCityMoveCommand);
const seats = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
for (const count of [2, 3, 4]) {
  const setup = core.createPreEntryGame('compiled-city-move', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = core.beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  const entry = (actorId, payload) => { state = core.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: actorId }, {
    gameId: state.gameId, expectedVersion: state.stateVersion, ...payload,
  }); };
  for (let i = 0; i < count; i++) {
    entry(seats[i].id, { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    entry(seats[i].id, { type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) entry('p2', { type: 'choose-entry-influence', slotId: null });
  state = game.openCityMoveWindow(state, setup.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion,
    deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  assert.equal(state.players.p1.balances.originium, 3);
  const send = (reducer, command) => {
    const payload = { gameId: state.gameId, expectedVersion: state.stateVersion, ...command };
    state = reducer(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload);
    assert.throws(() => reducer(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload), /version is stale/);
  };
  send(game.applyCityMoveCommand, { type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' });
  assert.equal(state.players.p1.balances.originium, 0); assert.equal(state.players.p1.balances['columbia-voucher'], 10);
  state = core.parseGameState(JSON.parse(JSON.stringify(state)), setup.definition);
  send(game.applyCityMoveCommand, { type: 'choose-city-move-event', choice: { choiceId: 'Y01:2' } });
  send(game.applyCityMoveCommand, { type: 'place-city-move-influence', slotId: game.getCityMoveFinalSlotIds(state, setup.definition, 'p1')[0] });
  const firstDecks = state.eventDecks, order = state.playerOrder;
  state = core.openExplorationWindow(state, setup.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion });
  assert.equal(state.schemaVersion, '1.3.0'); assert.deepEqual(state.eventDecks, firstDecks);
  send(core.applyExplorationCommand, { type: 'explore', nodeId: 'D-02', path: [{ routeId: 'D-route-01', toNodeId: 'D-02' }] });
  state = core.parseGameState(JSON.parse(JSON.stringify(state)), setup.definition);
  send(core.applyExplorationCommand, { type: 'choose-exploration-event', choice: { choiceId: 'Y02:2' } });
  send(core.applyExplorationCommand, { type: 'place-exploration-influence', slotId: core.getExplorationFinalSlotIds(state, setup.definition, 'p1')[0] });
  const remaining = state.eventDecks;
  state = game.openCityMoveWindow(state, setup.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
  send(game.applyCityMoveCommand, { type: 'move-city', nodeId: 'D-02', routeId: 'D-route-01' });
  assert.equal(state.cityMove.cardId, null); assert.deepEqual(state.eventDecks, remaining);
  send(game.applyCityMoveCommand, { type: 'place-city-move-influence', slotId: game.getCityMoveFinalSlotIds(state, setup.definition, 'p1')[0] });
  assert.equal(state.cityMove.status, 'complete'); assert.equal(state.schemaVersion, '1.3.0');
  assert.equal(state.board.cityNodeByPlayer.p1, 'D-02'); assert.equal(state.players.p1.balances.originium, 5);
  assert.equal(state.players.p1.balances['columbia-voucher'], 8); assert.equal(state.markerSupplyByPlayer.p1.length, 26);
  assert.equal(Object.keys(core.getMarkerLedger(state, setup.definition)).length, count * 30); assert.deepEqual(state.playerOrder, order);
  console.log(JSON.stringify({ players: count, status: state.cityMove.status, version: state.stateVersion, city: 'D-02', originium: 5, vouchers: 8, supply: 26 }));
}
console.log('PASS: compiled entry -> city move -> exploration -> explored-target move, restore, stale retries and conserved inventory');
