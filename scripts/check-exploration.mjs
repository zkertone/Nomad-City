import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';

assert.equal(core.applyExplorationCommand, game.applyExplorationCommand);
const seats = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
for (const count of [2, 3, 4]) {
  const setup = core.createPreEntryGame('compiled-exploration', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = core.beginEntry(setup.state, setup.definition, {
    startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id), expectedVersion: 0, greenDeckOrder: ids('green'),
  });
  const entry = command => { state = core.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: command.actorId }, {
    gameId: state.gameId, expectedVersion: state.stateVersion, ...command.payload,
  }); };
  for (let i = 0; i < count; i++) {
    const actorId = seats[i].id;
    entry({ actorId, payload: { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] } });
    entry({ actorId, payload: { type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` } });
  }
  if (count === 2) entry({ actorId: 'p2', payload: { type: 'choose-entry-influence', slotId: null } });
  const reorder = (color, first) => [first, ...ids(color).filter(id => id !== first)];
  state = core.openExplorationWindow(state, setup.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion,
    deckOrder: { yellow: reorder('yellow', 'Y05'), red: reorder('red', 'R06') } });
  assert.deepEqual(state.playerOrder, seats.slice(0, count).map(player => player.id));
  const send = command => {
    const payload = { gameId: state.gameId, expectedVersion: state.stateVersion, ...command };
    state = game.applyExplorationCommand(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload);
    assert.throws(() => game.applyExplorationCommand(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload), /version is stale/);
  };
  send({ type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
  state = core.parseGameState(JSON.parse(JSON.stringify(state)), setup.definition);
  send({ type: 'choose-exploration-event', choice: { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: 'route:A-route-02:slot:1' } });
  send({ type: 'place-exploration-influence', slotId: core.getExplorationFinalSlotIds(state, setup.definition, 'p1')[0] });
  assert.equal(state.exploration.status, 'complete'); assert.equal(state.markerSupplyByPlayer.p1.length, 27);
  state = core.openExplorationWindow(state, setup.definition, { actorId: 'p1', roundNumber: core.redExplorationOpeningRound(count), expectedVersion: state.stateVersion });
  send({ type: 'explore', nodeId: 'F-01', path: [
    { routeId: 'R-route-01', toNodeId: 'D-01' }, { routeId: 'D-route-01', toNodeId: 'D-02' }, { routeId: 'F-route-02', toNodeId: 'F-01' },
  ] });
  state = core.parseGameState(JSON.parse(JSON.stringify(state)), setup.definition);
  const targetSlots = core.loadFoundersBoard(count === 4 ? 'four-player' : 'three-player').resourceNodes['F-01'].influenceSlotIds;
  send({ type: 'choose-exploration-event', choice: { choiceId: 'R06:3', influenceSlotId: targetSlots[0] } });
  send({ type: 'place-exploration-influence', slotId: core.getExplorationFinalSlotIds(state, setup.definition, 'p1')[0] });
  assert.equal(state.exploration.status, 'complete'); assert.equal(state.markerSupplyByPlayer.p1.length, 25);
  assert.equal(state.board.resourceMarkerByNode['F-01'].harvestAmount, 2);
  assert.equal(Object.keys(core.getMarkerLedger(state, setup.definition)).length, count * 30);
  console.log(JSON.stringify({ players: count, status: state.exploration.status, version: state.stateVersion,
    actorVouchers: state.players.p1.balances['columbia-voucher'], actorSupply: state.markerSupplyByPlayer.p1.length, yellow: 'Y05', red: 'R06' }));
}
console.log('PASS: compiled entry -> yellow/red exploration, separate placements, JSON restore, stale retries and inventory');
