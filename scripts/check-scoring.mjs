import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';

assert.equal(core.getBaseScoringPreview, game.getBaseScoringPreview);
assert.equal(core.getRegionControl, game.getRegionControl);
assert.equal(core.getResourceScoreBreakdown, game.getResourceScoreBreakdown);
const seats = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
for (const count of [2, 3, 4]) {
  const setup = core.createPreEntryGame('compiled-scoring', seats.slice(0, count));
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
  const order = state.entry.playerOrder;
  state = game.openDeploymentWindow(state, setup.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion,
    deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  const send = (reducer, command) => {
    const payload = { gameId: state.gameId, expectedVersion: state.stateVersion, ...command };
    state = reducer(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload);
    assert.throws(() => reducer(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload), /version is stale/);
  };
  const far = 'route:F-route-01:slot:1', ownCity = 'node:A-01:slot:1', tollRoute = 'route:R-route-01:slot:1';
  send(game.applyInfluenceCommand, { type: 'deploy-influence', slotId: far });
  const markerId = state.board.influenceBySlot[far].markerId;
  state = game.openDispatchWindow(state, setup.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion });
  send(game.applyInfluenceCommand, { type: 'dispatch-influence', sourceSlotId: far, targetSlotId: ownCity });
  state = core.parseGameState(JSON.parse(JSON.stringify(state)), setup.definition);
  send(game.applyInfluenceCommand, { type: 'dispatch-influence', sourceSlotId: ownCity, targetSlotId: tollRoute });
  assert.equal(state.board.influenceBySlot[tollRoute].markerId, markerId); assert.equal(state.markerSupplyByPlayer.p1.length, 28);
  const decks = state.eventDecks;
  state = core.openExplorationWindow(state, setup.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
  assert.equal(state.schemaVersion, '1.4.0'); assert.deepEqual(state.eventDecks, decks);
  send(core.applyExplorationCommand, { type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
  assert.equal(state.players.p1.balances['columbia-voucher'], 10);
  send(core.applyExplorationCommand, { type: 'choose-exploration-event', choice: { choiceId: 'Y01:2' } });
  send(core.applyExplorationCommand, { type: 'place-exploration-influence', slotId: core.getExplorationFinalSlotIds(state, setup.definition, 'p1')[0] });
  state = core.openCityMoveWindow(state, setup.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion });
  assert.equal(state.schemaVersion, '1.4.0');
  send(core.applyCityMoveCommand, { type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' });
  assert.equal(state.cityMove.cardId, null);
  send(core.applyCityMoveCommand, { type: 'place-city-move-influence', slotId: core.getCityMoveFinalSlotIds(state, setup.definition, 'p1')[0] });
  assert.equal(state.board.influenceBySlot[tollRoute].markerId, markerId);
  assert.equal(state.players.p1.balances.originium, 4); assert.equal(state.players.p1.balances['columbia-voucher'], 10);
  assert.equal(state.markerSupplyByPlayer.p1.length, 26); assert.equal(Object.keys(core.getMarkerLedger(state, setup.definition)).length, count * 30);
  assert.deepEqual(state.playerOrder, order);
  state = game.openHarvestPhase(state, setup.definition, { roundNumber: 2, expectedVersion: state.stateVersion });
  const before = structuredClone(state);
  for (const player of setup.definition.players) {
    const nodeId = state.board.cityNodeByPlayer[player.id];
    const plan = { nodeIds: [nodeId], routeIds: [] };
    assert.equal(game.getHarvestQuote(state, setup.definition, player.id, plan).total, 0);
    const payload = { type: 'set-harvest-plan', gameId: state.gameId, expectedVersion: state.stateVersion, plan };
    state = game.applyHarvestCommand(state, setup.definition, { authenticatedPlayerId: player.id }, payload);
    assert.throws(() => game.applyHarvestCommand(state, setup.definition, { authenticatedPlayerId: player.id }, payload), /version is stale/);
    state = core.parseGameState(JSON.parse(JSON.stringify(state)), setup.definition);
    if (state.harvest.status === 'planning') assert.deepEqual(state.players, before.players);
  }
  assert.equal(state.harvest.status, 'complete'); assert.equal(state.players.p1.balances.originium, 5);
  assert.deepEqual(state.board, before.board); assert.deepEqual(state.eventDecks, before.eventDecks); assert.deepEqual(state.playerOrder, order);
  assert.equal(state.players.p1.balances['columbia-voucher'], 10);
  const original = JSON.stringify(state), position = core.getGamePosition(state, setup.definition);
  const result = game.getBaseScoringPreview(position, setup.definition);
  assert.equal(result.scope, 'base-components-only');
  assert.equal(result.regions.D.controllerPlayerId, 'p1');
  assert.deepEqual(result.regions.D.influenceByPlayer.p1, { nodeMarkers: 2, routeMarkers: 0, cityInfluence: 2, total: 4 });
  assert.equal(result.regions.R.controllerPlayerId, 'p1');
  assert.equal(result.regions.R.influenceByPlayer.p1.routeMarkers, 1);
  assert.equal(result.players.p1.regionPoints, 6); assert.equal(result.players.p1.resources.totalPoints, 0);
  assert.equal(result.players.p1.existingPoints, 0); assert.equal(result.players.p1.totalPoints, 6);
  assert.equal(result.players.p1.remainingVouchers, 10); assert.deepEqual(result.leadingPlayerIds, count === 2 ? ['p2'] : ['p1']);
  assert.equal(result.resolvedBy, count === 2 ? 'columbia-voucher' : 'score');
  assert.deepEqual(result, core.getBaseScoringPreview(JSON.parse(JSON.stringify(position)), setup.definition));
  assert.equal(JSON.stringify(state), original); assert.equal(state.harvest.status, 'complete');
  assert.equal(state.players.p1.score, 0); // Preview is not an authoritative score award.
  assert.equal(Object.isFrozen(result.players.p1.resources.pointsByAsset), true);
  const resourceScore = game.getResourceScoreBreakdown({ orirock: 19, originium: 17, iron: 13, 'pure-originium': 3, 'columbia-voucher': 999 });
  assert.equal(resourceScore.totalPoints, 9);
  console.log(JSON.stringify({ players: count, phase: state.phase, format: state.schemaVersion, previewOnly: true,
    p1RegionPoints: result.players.p1.regionPoints, p1TotalPoints: result.players.p1.totalPoints,
    actualScoreUnchanged: state.players.p1.score, leadingPlayerIds: result.leadingPlayerIds }));
}
console.log('PASS: compiled 2/3/4-player entry/actions/harvest -> read-only base scoring preview, root/subpath exports and JSON restore');
