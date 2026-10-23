import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
assert.equal(core.enableBaseRoleEffects, game.enableBaseRoleEffects);
assert.equal(core.applyBaseRoleCommand, game.applyBaseRoleCommand);
assert.equal(core.getBaseRoleEffectSupport, game.getBaseRoleEffectSupport);
assert.equal(game.getBaseRoleEffectSupport().supportedModeCount, 5);
assert.equal(game.getBaseRoleEffectSupport().allBaseRoleEffectsImplemented, false);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const order = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = state => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const send = (state, definition, command) => game.applyRoundCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), ...command });
function rolesReady(state, definition, roleId) {
  while (state.roundFlow.stage === 'role-removal') state = send(state, definition, { type: 'remove-round-supply-card', cardId: state.facilities.supply.supply[0] });
  while (state.roundFlow.stage === 'role-placement') state = send(state, definition, { type: 'place-round-role', roleId: game.getRoundTurn(state, definition).actorId === 'p1' ? roleId : 'ROLE-01' });
  return state;
}
function setup(count, roleId) {
  const start = game.createPreEntryGame('compiled-role-effects', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = game.beginEntry(start.state, start.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  state = game.beginRoundFlow(state, start.definition, { expectedVersion: state.stateVersion, facilityDeckOrder: order, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  state = game.enableBaseRoleEffects(state, start.definition, { expectedVersion: state.stateVersion });
  return { definition: start.definition, state: rolesReady(state, start.definition, roleId) };
}
function dispatchTurn(state, definition) {
  state = send(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  assert.equal(state.influenceAction.status, 'complete');
  return send(state, definition, { type: 'finish-player-turn' });
}
function finishRound(state, definition) {
  while (state.roundFlow.stage === 'player-actions') state = dispatchTurn(state, definition);
  state = game.openHarvestPhase(state, definition, { expectedVersion: state.stateVersion, roundNumber: state.roundFlow.roundNumber });
  for (const player of definition.players) state = game.applyHarvestCommand(state, definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return game.finishManagedRound(state, definition, { expectedVersion: state.stateVersion });
}
function use(state, definition, roleId, mode, choices) {
  const payload = { ...env(state), type: 'use-base-role', roleId, mode, ...choices }, before = JSON.stringify(state);
  const next = game.applyBaseRoleCommand(state, definition, { authenticatedPlayerId: 'p1' }, payload);
  assert.equal(JSON.stringify(state), before); assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.throws(() => game.applyBaseRoleCommand(next, definition, { authenticatedPlayerId: 'p1' }, payload), /version is stale/);
  return next;
}
for (const count of [2, 3, 4]) {
  const f = setup(count, 'ROLE-02'); let state = f.state;
  const rock = state.players.p1.balances.orirock;
  state = use(state, f.definition, 'ROLE-02', 'strategy', { strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } });
  assert.equal(state.players.p1.balances.orirock, rock + 4); assert.equal(state.roundFlow.majorActionOpened, false);
  state = finishRound(state, f.definition);
  assert.equal(state.playerOrder[0], 'p2'); assert.deepEqual(state.roundFlow.rolesByPlayer[0].discarded, ['ROLE-02']);
  state = rolesReady(state, f.definition, 'ROLE-05');
  while (game.getRoundTurn(state, f.definition).actorId !== 'p1') state = dispatchTurn(state, f.definition);
  const cash = state.players.p1.balances['columbia-voucher'];
  state = use(state, f.definition, 'ROLE-05', 'scheme', { schemeChoice: { kind: 'recover-roles', rewards: [{ roleId: 'ROLE-02', kind: 'vouchers' }] } });
  assert.equal(state.players.p1.balances['columbia-voucher'], cash + 5); assert.deepEqual(state.roundFlow.rolesByPlayer[0].discarded, ['ROLE-05']);
  state = game.parseGameState(JSON.parse(JSON.stringify(state)), f.definition);
  const view = game.getRoundPublicView(state, f.definition, 'p2');
  assert.equal(Object.hasOwn(view.roles[0], 'hand'), false); assert.equal(view.roles[0].usedRole.roleId, 'ROLE-05');
  state = finishRound(state, f.definition);
  assert.equal(state.schemaVersion, '1.8.0'); assert.equal(state.roundFlow.roundNumber, 3);
  assert.equal(state.roundFlow.rolesByPlayer[0].used, null); assert.equal(state.roundFlow.rolesByPlayer[0].hand.includes('ROLE-02'), true);
  assert.equal(Object.keys(game.getMarkerLedger(state, f.definition)).length, count * 30);
  const texas = setup(count, 'ROLE-03'), supply = texas.state.facilities.supply, selected = supply.supply[0];
  const cycled = use(texas.state, texas.definition, 'ROLE-03', 'strategy', { strategyChoice: { kind: 'cycle-facility', cardId: selected } });
  assert.equal(cycled.players.p1.balances['columbia-voucher'], texas.state.players.p1.balances['columbia-voucher'] + 12);
  assert.deepEqual(cycled.facilities.supply.drawPile, [...supply.drawPile.slice(1), selected]); assert.equal(cycled.facilities.supply.revision, supply.revision + 1);
  const merchant = setup(count, 'ROLE-04'), sold = use(merchant.state, merchant.definition, 'ROLE-04', 'strategy', { strategyChoice: { kind: 'sell-resources', amounts: { orirock: 0, originium: 1, iron: 0, 'pure-originium': 0 } } });
  assert.equal(sold.players.p1.balances['columbia-voucher'], merchant.state.players.p1.balances['columbia-voucher'] + 3);
  const tin = setup(count, 'ROLE-05'), both = use(tin.state, tin.definition, 'ROLE-05', 'both', { strategyChoice: { kind: 'tin-point' }, schemeChoice: { kind: 'recover-roles', rewards: [] } });
  assert.equal(both.players.p1.score, tin.state.players.p1.score + 1); assert.deepEqual(both.roundFlow.rolesByPlayer[0].discarded, ['ROLE-05']);
  console.log(JSON.stringify({ players: count, format: state.schemaVersion, actualRoundsWithRoleEffects: 2, completedModes: 5, recoveredPriorRole: true, currentTinExcluded: true }));
}
console.log('PASS: compiled five role modes, explicit upgrade, 2/3/4-player real discard/recovery across rounds, starter both-mode order, market cycle, rates, JSON resume, privacy and no extra major action');
