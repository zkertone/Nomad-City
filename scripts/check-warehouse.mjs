import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
assert.equal(core.enableWarehouseEntries, game.enableWarehouseEntries);
assert.equal(core.applyWarehouseEntryCommand, game.applyWarehouseEntryCommand);
assert.equal(core.getPendingWarehouseEventRequirements, game.getPendingWarehouseEventRequirements);
assert.equal(core.getWarehouseEntryFinalSlotIds, game.getWarehouseEntryFinalSlotIds);
assert.equal(core.getFacilityConstructionSupport().supportedPhysicalCardIds.length, 41);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = state => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const send = (state, definition, payload) => game.applyRoundCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), ...payload });
function dispatch(state, definition) {
  state = send(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction.status === 'ready') state = game.applyInfluenceCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), type: 'finish-dispatch' });
  return send(state, definition, { type: 'finish-player-turn' });
}
for (const count of [2, 3, 4]) for (const branch of ['influence', 'explore']) {
  const start = game.createPreEntryGame('compiled-warehouse', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = game.beginEntry(start.state, start.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id), expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  const cardId = core.FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-001').id;
  state = game.beginRoundFlow(state, start.definition, { expectedVersion: state.stateVersion, facilityDeckOrder: [cardId, ...ordinary.filter(id => id !== cardId)], deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  state = game.enableBaseRoleEffects(state, start.definition, { expectedVersion: state.stateVersion });
  state = game.enableLiskarmEffects(state, start.definition, { expectedVersion: state.stateVersion });
  state = game.enableRemainingBaseRoleEffects(state, start.definition, { expectedVersion: state.stateVersion });
  state = game.enableWarehouseEntries(state, start.definition, { expectedVersion: state.stateVersion });
  while (state.roundFlow.stage === 'role-removal') state = send(state, start.definition, { type: 'remove-round-supply-card', cardId: state.facilities.supply.supply.find(id => id !== cardId) });
  while (state.roundFlow.stage === 'role-placement') state = send(state, start.definition, { type: 'place-round-role', roleId: game.getRoundTurn(state, start.definition).actorId === 'p1' ? 'ROLE-03' : 'ROLE-01' });
  state = game.applyBaseRoleCommand(state, start.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: state.facilities.supply.supply.find(id => id !== cardId) } });
  assert.equal(state.players.p1.balances['columbia-voucher'], 22);
  state = send(state, start.definition, { type: 'choose-major-action', action: 'construct' });
  const board = core.loadFoundersBoard(count === 4 ? 'four-player' : 'three-player'), slots = Object.values(board.routes).flatMap(route => route.influenceSlotIds), supply = state.markerSupplyByPlayer.p1.length;
  const entryChoice = branch === 'influence' ? { kind: 'warehouse-influence', placeSlotId: slots[0], move: { sourceSlotId: slots[0], targetSlotId: slots[1] } } : { kind: 'warehouse-explore' };
  const payload = { ...env(state), type: 'construct-facility', cardId, cellId: 'CP-1-1', paymentMode: 'vouchers', entryChoice: { kind: 'warehouse-entry' } };
  const before = JSON.stringify(state), next = game.applyConstructionCommand(state, start.definition, { authenticatedPlayerId: 'p1' }, payload);
  assert.equal(JSON.stringify(state), before); assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.throws(() => game.applyConstructionCommand(next, start.definition, { authenticatedPlayerId: 'p1' }, payload), /stale/);
  state = game.parseGameState(JSON.parse(JSON.stringify(next)), start.definition);
  assert.equal(state.construction.warehouseEntry.status, 'branch-choice'); assert.equal(state.players.p1.balances['columbia-voucher'], 13);
  assert.throws(() => send(state, start.definition, { type: 'finish-player-turn' }), /Finish exactly one major action/);
  const branchCommand = { ...env(state), type: 'choose-warehouse-entry', entryChoice, ...(branch === 'explore' ? { warehouseExploration: { nodeId: 'B-01', path: [{ routeId: 'R-route-02', toNodeId: 'B-01' }] } } : {}) };
  state = game.applyWarehouseEntryCommand(state, start.definition, { authenticatedPlayerId: 'p1' }, branchCommand);
  assert.throws(() => game.applyWarehouseEntryCommand(state, start.definition, { authenticatedPlayerId: 'p1' }, branchCommand), /stale/);
  if (branch === 'explore') {
    const decks = state.eventDecks, cash = state.players.p1.balances['columbia-voucher']; assert.equal(cash, 11);
    assert.equal(game.getRoundTurn(state, start.definition).majorActionStatus, 'pending'); assert.throws(() => send(state, start.definition, { type: 'finish-player-turn' }), /Finish exactly one major action/);
    const choiceId = `${state.construction.warehouseEntry.cardId}:1`, choice = { ...env(state), type: 'choose-exploration-event', choice: { choiceId } };
    state = game.applyWarehouseEntryCommand(state, start.definition, { authenticatedPlayerId: 'p1' }, choice);
    assert.deepEqual(state.eventDecks, decks); assert.equal(state.players.p1.balances['columbia-voucher'], cash);
    assert.throws(() => game.applyWarehouseEntryCommand(state, start.definition, { authenticatedPlayerId: 'p1' }, choice), /stale/);
    assert.equal(state.construction.warehouseEntry.status, 'final-influence'); assert.throws(() => send(state, start.definition, { type: 'finish-player-turn' }), /Finish exactly one major action/);
    state = game.parseGameState(JSON.parse(JSON.stringify(state)), start.definition);
    state = game.applyWarehouseEntryCommand(state, start.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'place-exploration-influence', slotId: game.getWarehouseEntryFinalSlotIds(state, start.definition, 'p1')[0] });
    assert.deepEqual(state.eventDecks, decks); assert.equal(state.players.p1.balances['columbia-voucher'], 11);
  } else { assert.equal(state.players.p1.balances['columbia-voucher'], 13); assert.equal(state.board.influenceBySlot[slots[0]], null); assert.equal(state.board.influenceBySlot[slots[1]].ownerPlayerId, 'p1'); }
  assert.equal(state.markerSupplyByPlayer.p1.length, supply - 1); assert.equal(state.construction.status, 'complete'); assert.equal(game.getRoundTurn(state, start.definition).majorActionStatus, 'complete'); assert.equal(state.exploration, undefined);
  state = send(state, start.definition, { type: 'finish-player-turn' });
  while (state.roundFlow.stage === 'player-actions') state = dispatch(state, start.definition);
  state = game.openHarvestPhase(state, start.definition, { expectedVersion: state.stateVersion, roundNumber: 1 });
  for (const player of start.definition.players) state = game.applyHarvestCommand(state, start.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  state = game.finishManagedRound(state, start.definition, { expectedVersion: state.stateVersion });
  assert.equal(state.schemaVersion, '1.11.0'); assert.equal(state.roundFlow.roundNumber, 2); assert.ok(state.facilities.panels[0].placements.some(row => row.cardId === cardId)); assert.equal(Object.keys(game.getMarkerLedger(state, start.definition)).length, count * 30);
  console.log(JSON.stringify({ players: count, branch, format: state.schemaVersion, finalVouchers: state.players.p1.balances['columbia-voucher'], nextRound: 2, noExtraMajorAction: true }));
}
console.log('PASS: compiled real 2/3/4-player both warehouse branches, paid nested exploration, event/final save-resume, replay and stage guards, no extra major action, harvest/next round and conservation');
