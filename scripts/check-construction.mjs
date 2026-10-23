import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';

assert.equal(core.openConstructionWindow, game.openConstructionWindow);
assert.equal(core.applyConstructionCommand, game.applyConstructionCommand);
assert.equal(core.getConstructionQuote, game.getConstructionQuote);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const admin = core.FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-013').id;
const ordinary = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
for (const count of [2, 3, 4]) {
  const setup = core.createPreEntryGame('compiled-construction-window', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = core.beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  const enter = (actorId, command) => { state = core.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: actorId }, {
    gameId: state.gameId, expectedVersion: state.stateVersion, ...command,
  }); };
  for (let i = 0; i < count; i++) {
    enter(seats[i].id, { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    enter(seats[i].id, { type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) enter('p2', { type: 'choose-entry-influence', slotId: null });
  // Explicit funding fixture only, not a claim that entry earned 30 vouchers.
  const funded = game.gameStateSchema.parse(state); funded.players.p1.balances['columbia-voucher'] = 30;
  state = game.openConstructionWindow(funded, setup.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: funded.stateVersion,
    facilityDeckOrder: [admin, ...ordinary.filter(id => id !== admin)], deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  const payload = { type: 'construct-facility', gameId: state.gameId, expectedVersion: state.stateVersion, cardId: admin, cellId: 'CP-1-1', paymentMode: 'vouchers' };
  const before = JSON.stringify(state);
  assert.equal(game.getConstructionQuote(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload).canPay, true);
  assert.throws(() => game.applyConstructionCommand(state, setup.definition, { authenticatedPlayerId: 'p2' }, payload), /granted player/);
  const result = game.applyConstructionCommand(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload);
  assert.equal(JSON.stringify(state), before); assert.equal(result.stateVersion, state.stateVersion + 1);
  assert.equal(result.players.p1.balances['columbia-voucher'], 0); assert.equal(result.players.p1.score, state.players.p1.score + 3);
  assert.equal(result.construction.status, 'complete'); assert.equal(result.construction.constructionsCompleted, 1);
  assert.equal(result.facilities.supply.revision, 1); assert.equal(result.facilities.panels[0].revision, 1);
  assert.equal(result.facilities.supply.supply.length, 6); assert.equal(result.facilities.supply.drawPile.length, 34);
  assert.throws(() => game.applyConstructionCommand(result, setup.definition, { authenticatedPlayerId: 'p1' }, payload), /version is stale/);
  assert.throws(() => game.applyConstructionCommand(result, setup.definition, { authenticatedPlayerId: 'p1' }, { ...payload, expectedVersion: result.stateVersion }), /unused construction grant/);
  const resumed = game.parseGameState(JSON.parse(JSON.stringify(result)), setup.definition);
  const next = game.openDeploymentWindow(resumed, setup.definition, { actorId: 'p2', roundNumber: 1, expectedVersion: resumed.stateVersion });
  assert.equal(next.schemaVersion, '1.6.0'); assert.deepEqual(next.facilities, result.facilities);
  assert.equal(next.construction, undefined); assert.equal(game.validateGameState(next, setup.definition).success, true);
  console.log(JSON.stringify({ players: count, format: result.schemaVersion, status: result.construction.status, version: result.stateVersion,
    facilitiesRetainedIn: next.phase, physicalCards: 48, drawPile: 34 }));
}
console.log('PASS: compiled authoritative construction window, 2/3/4-player setup, actor/version guards, one grant, exact settlement, JSON resume and cross-action facility persistence');
