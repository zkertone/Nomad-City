import assert from 'node:assert/strict';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, getLegalInitialNodeIds,
  getLegalEntryInfluenceSlotIds, getMarkerLedger, parseGameState,
} from '@nomad-city-online/game-core/game';
import { applyEntryCommand as rootReducer } from '@nomad-city-online/game-core';

assert.equal(rootReducer, applyEntryCommand);
const seats = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
for (const count of [2, 3, 4]) {
  const game = createPreEntryGame(`entry-${count}`, seats.slice(0, count));
  let state = beginEntry(game.state, game.definition, {
    startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G01', 'G02', 'G03', 'G04', 'G05', 'G06'].filter(id => count === 4 || id !== 'G01'),
  });
  const send = (actor, choice) => {
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: actor }, {
      gameId: state.gameId, expectedVersion: state.stateVersion, ...choice,
    });
  };
  // Example player decisions for this smoke check, never automatic production choices.
  for (const actor of state.entry.playerOrder) {
    const nodeId = getLegalInitialNodeIds(state, game.definition, actor)[0];
    send(actor, { type: 'select-initial-node', nodeId, ...(nodeId === 'B-01' ? { b01Bonus: 'decline' } : {}) });
    state = parseGameState(JSON.parse(JSON.stringify(state)), game.definition);
    send(actor, { type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) send('p2', { type: 'choose-entry-influence', slotId: getLegalEntryInfluenceSlotIds(state, game.definition, 'p2')[0] });
  assert.equal(state.entry.status, 'complete');
  assert.equal(state.stateVersion, 1 + count * 2 + (count === 2 ? 1 : 0));
  assert.equal(Object.keys(getMarkerLedger(state, game.definition)).length, count * 30);
  const money = state.entry.playerOrder.map(id => state.players[id].balances['columbia-voucher']);
  assert.deepEqual(money, { 2: [17, 18], 3: [17, 12, 18], 4: [12, 19, 14, 18] }[count]);
  assert.equal(state.players.p2.score, count === 2 ? 3 : 0);
  console.log(JSON.stringify({ players: count, status: state.entry.status, version: state.stateVersion, moneyIncludingGreenRewards: money }));
}
console.log('PASS: compiled entry flow, pending-event reload, choices, funds and marker conservation');
