import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
assert.equal(core.enableLiskarmEffects, game.enableLiskarmEffects);
assert.equal(core.openManagedCleanup, game.openManagedCleanup);
assert.equal(core.applyRoleCleanupCommand, game.applyRoleCleanupCommand);
assert.equal(core.getRoleCleanupOptions, game.getRoleCleanupOptions);
assert.equal(game.getBaseRoleEffectSupport().supportedModeCount, 7);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const deck = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = state => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
function roundCommand(state, definition, command) {
  return game.applyRoundCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), ...command });
}
function dispatchTurn(state, definition) {
  state = roundCommand(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction.status === 'ready') state = game.applyInfluenceCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), type: 'finish-dispatch' });
  return roundCommand(state, definition, { type: 'finish-player-turn' });
}
for (const count of [2, 3, 4]) {
  const setup = game.createPreEntryGame('compiled-liskarm', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = game.beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    state = game.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    state = game.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) state = game.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  state = game.beginRoundFlow(state, setup.definition, { expectedVersion: state.stateVersion, facilityDeckOrder: deck, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  state = game.enableBaseRoleEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  state = game.enableLiskarmEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  while (state.roundFlow.stage === 'role-removal') state = roundCommand(state, setup.definition, { type: 'remove-round-supply-card', cardId: state.facilities.supply.supply[0] });
  while (state.roundFlow.stage === 'role-placement') state = roundCommand(state, setup.definition, { type: 'place-round-role', roleId: 'ROLE-01' });
  const board = core.loadFoundersBoard(count === 4 ? 'four-player' : 'three-player');
  const slots = Object.values(board.routes).flatMap(route => route.influenceSlotIds).slice(0, 2);
  const originalSupply = [...state.markerSupplyByPlayer.p1];
  state = game.applyBaseRoleCommand(state, setup.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: slots } });
  assert.equal(state.markerSupplyByPlayer.p1.length, originalSupply.length - 2);
  assert.equal(state.roundFlow.rolesByPlayer[0].used.cleanupResolved, false);
  state = dispatchTurn(state, setup.definition);
  const cash = state.players.p2.balances['columbia-voucher'];
  state = game.applyBaseRoleCommand(state, setup.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-01', mode: 'scheme', schemeChoice: { kind: 'liskarm-replace', costDecision: 'pay', slotId: slots[0] } });
  assert.equal(state.players.p2.balances['columbia-voucher'], cash - 3);
  assert.equal(state.board.influenceBySlot[slots[0]].ownerPlayerId, 'p2');
  while (state.roundFlow.stage === 'player-actions') state = dispatchTurn(state, setup.definition);
  state = game.openHarvestPhase(state, setup.definition, { expectedVersion: state.stateVersion, roundNumber: 1 });
  for (const player of setup.definition.players) state = game.applyHarvestCommand(state, setup.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  assert.throws(() => game.finishManagedRound(state, setup.definition, { expectedVersion: state.stateVersion }), /delayed removal/);
  state = game.openManagedCleanup(state, setup.definition, { expectedVersion: state.stateVersion });
  assert.equal(game.getRoundTurn(state, setup.definition).actorId, 'p1');
  assert.deepEqual(game.getRoleCleanupOptions(state, setup.definition, 'p1'), [slots[1]]);
  state = game.parseGameState(JSON.parse(JSON.stringify(state)), setup.definition);
  const payload = { ...env(state), type: 'resolve-role-cleanup', slotId: slots[1] }, before = JSON.stringify(state);
  const next = game.applyRoleCleanupCommand(state, setup.definition, { authenticatedPlayerId: 'p1' }, payload);
  assert.equal(JSON.stringify(state), before);
  assert.equal(next.board.influenceBySlot[slots[1]], null); assert.equal(next.roundFlow.rolesByPlayer[0].used.cleanupResolved, true);
  assert.throws(() => game.applyRoleCleanupCommand(next, setup.definition, { authenticatedPlayerId: 'p1' }, payload), /version is stale/);
  state = game.finishManagedRound(next, setup.definition, { expectedVersion: next.stateVersion });
  assert.equal(state.schemaVersion, '1.9.0'); assert.equal(state.roundFlow.roundNumber, 2); assert.equal(state.playerOrder[0], 'p2');
  assert.deepEqual([...state.markerSupplyByPlayer.p1].sort(), originalSupply.sort());
  assert.deepEqual(state.roundFlow.rolesByPlayer[0].discarded, ['ROLE-01']); assert.equal(state.roundFlow.rolesByPlayer[0].used, null);
  assert.equal(Object.keys(game.getMarkerLedger(state, setup.definition)).length, count * 30);
  console.log(JSON.stringify({ players: count, format: state.schemaVersion, strategyPlacements: 2, paidReplacement: 3,
    cleanupRemoved: 1, nextRound: 2, p1OriginalMarkerSupplyRestored: true }));
}
console.log('PASS: compiled Liskarm 2/3/4-player real strategy -> opponent replacement -> two cycles -> harvest -> guarded player cleanup -> next round, save/replay and marker conservation');
