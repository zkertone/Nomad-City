import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
assert.equal(core.beginRoundFlow, game.beginRoundFlow);
assert.equal(core.applyRoundCommand, game.applyRoundCommand);
assert.equal(core.finishManagedRound, game.finishManagedRound);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const order = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
for (const count of [2, 3, 4]) {
  const setup = core.createPreEntryGame('compiled-rounds', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = core.beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  const enter = (actorId, command) => { state = core.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: actorId }, { gameId: state.gameId, expectedVersion: state.stateVersion, ...command }); };
  for (let i = 0; i < count; i++) {
    enter(seats[i].id, { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    enter(seats[i].id, { type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) enter('p2', { type: 'choose-entry-influence', slotId: null });
  const balances = state.players;
  state = game.beginRoundFlow(state, setup.definition, { expectedVersion: state.stateVersion, facilityDeckOrder: order, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  let mainActions = 0;
  const send = command => {
    const payload = { gameId: state.gameId, expectedVersion: state.stateVersion, ...command };
    const actorId = game.getRoundTurn(state, setup.definition).actorId;
    const before = JSON.stringify(state), next = game.applyRoundCommand(state, setup.definition, { authenticatedPlayerId: actorId }, payload);
    assert.equal(JSON.stringify(state), before); state = next;
    assert.throws(() => game.applyRoundCommand(state, setup.definition, { authenticatedPlayerId: actorId }, payload), /version is stale/);
  };
  for (let round = 1; round <= 8; round++) {
    assert.equal(state.roundFlow.roundNumber, round); assert.equal(state.playerOrder[0], seats[(round - 1) % count].id);
    while (state.roundFlow.stage === 'role-removal') send({ type: 'remove-round-supply-card', cardId: state.facilities.supply.supply[0] });
    while (state.roundFlow.stage === 'role-placement') send({ type: 'place-round-role', roleId: 'ROLE-01' });
    const clockwise = [...state.playerOrder], actors = [];
    for (let turn = 0; turn < count * 2; turn++) {
      actors.push(game.getRoundTurn(state, setup.definition).actorId);
      assert.equal(game.getRoundTurn(state, setup.definition).cycle, Math.floor(turn / count) + 1);
      send({ type: 'choose-major-action', action: 'dispatch' }); // No board influence: legal automatic completion.
      assert.equal(state.influenceAction.status, 'complete'); mainActions++;
      assert.throws(() => game.openDispatchWindow(state, setup.definition, { actorId: actors.at(-1), roundNumber: round, expectedVersion: state.stateVersion }), /Finish the active action/);
      send({ type: 'finish-player-turn' });
    }
    assert.deepEqual(actors, [...clockwise, ...clockwise]); assert.equal(state.roundFlow.stage, 'harvest');
    state = game.openHarvestPhase(state, setup.definition, { roundNumber: round, expectedVersion: state.stateVersion });
    for (const player of setup.definition.players) state = game.applyHarvestCommand(state, setup.definition, { authenticatedPlayerId: player.id }, {
      type: 'set-harvest-plan', gameId: state.gameId, expectedVersion: state.stateVersion, plan: { nodeIds: [], routeIds: [] },
    });
    state = game.finishManagedRound(state, setup.definition, { expectedVersion: state.stateVersion });
    state = game.parseGameState(JSON.parse(JSON.stringify(state)), setup.definition);
    assert.equal(state.schemaVersion, '1.7.0'); assert.deepEqual(state.players, balances);
    assert.equal(state.roundFlow.rolesByPlayer.every(role => role.hand.length === 5 && role.placed === null), true);
  }
  assert.equal(state.roundFlow.stage, 'finished'); assert.equal(mainActions, count * 16);
  assert.equal(state.facilities.supply.returnedToBox.length, count === 2 ? 16 : 0);
  assert.equal(state.facilities.supply.drawPile.length, count === 2 ? 19 : 35);
  assert.equal(Object.keys(game.getMarkerLedger(state, setup.definition)).length, count * 30);
  const publicView = game.getRoundPublicView(state, setup.definition, 'p1');
  assert.equal(Object.hasOwn(publicView.facilitySupply, 'drawPile'), false);
  assert.equal(Object.hasOwn(publicView.roles.find(role => role.playerId === 'p2'), 'hand'), false);
  console.log(JSON.stringify({ players: count, format: state.schemaVersion, completedRounds: 8, majorActions: mainActions,
    status: state.roundFlow.stage, removedCards: state.facilities.supply.returnedToBox.length, allUnusedRolesReturned: true }));
}
console.log('PASS: compiled 2/3/4-player managed eight rounds, role privacy, two cycles, immediate two-player removal/refill, harvest, cleanup, rotation, conservation and stale-command rejection');
