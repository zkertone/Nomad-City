import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
assert.equal(core.enableRemainingBaseRoleEffects, game.enableRemainingBaseRoleEffects);
assert.equal(core.getElysiumSchemeOptions, game.getElysiumSchemeOptions);
assert.equal(game.getBaseRoleEffectSupport().supportedModeCount, 10);
assert.equal(game.getBaseRoleEffectSupport().allBaseRoleEffectsImplemented, true);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const deck = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = state => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const send = (state, definition, command) => game.applyRoundCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), ...command });
function setup(count, roleId) {
  const start = game.createPreEntryGame('compiled-schemes', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = game.beginEntry(start.state, start.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id), expectedVersion: 0,
    greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) state = game.applyEntryCommand(state, start.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  state = game.beginRoundFlow(state, start.definition, { expectedVersion: state.stateVersion, facilityDeckOrder: deck, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  state = game.enableBaseRoleEffects(state, start.definition, { expectedVersion: state.stateVersion });
  state = game.enableLiskarmEffects(state, start.definition, { expectedVersion: state.stateVersion });
  state = game.enableRemainingBaseRoleEffects(state, start.definition, { expectedVersion: state.stateVersion });
  while (state.roundFlow.stage === 'role-removal') state = send(state, start.definition, { type: 'remove-round-supply-card', cardId: state.facilities.supply.supply[0] });
  while (state.roundFlow.stage === 'role-placement') state = send(state, start.definition, { type: 'place-round-role', roleId: game.getRoundTurn(state, start.definition).actorId === 'p1' ? roleId : 'ROLE-01' });
  return { definition: start.definition, state, roleId, board: core.loadFoundersBoard(count === 4 ? 'four-player' : 'three-player') };
}
function use(f, state, mode, schemeChoice, strategyChoice) {
  const before = JSON.stringify(state), payload = { ...env(state), type: 'use-base-role', roleId: f.roleId, mode, schemeChoice, ...(strategyChoice ? { strategyChoice } : {}) };
  state = game.parseGameState(JSON.parse(before), f.definition);
  const next = game.applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, payload);
  assert.equal(JSON.stringify(state), before); assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.throws(() => game.applyBaseRoleCommand(next, f.definition, { authenticatedPlayerId: 'p1' }, payload), /version is stale/);
  return next;
}
function dispatchTurn(state, definition) {
  state = send(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction.status === 'ready') state = game.applyInfluenceCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), type: 'finish-dispatch' });
  return send(state, definition, { type: 'finish-player-turn' });
}
function finish(f, state) {
  if (game.getRoundTurn(state, f.definition).majorActionStatus === 'complete') state = send(state, f.definition, { type: 'finish-player-turn' });
  while (state.roundFlow.stage === 'player-actions') state = dispatchTurn(state, f.definition);
  state = game.openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: 1 });
  for (const player of f.definition.players) state = game.applyHarvestCommand(state, f.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  state = game.finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion });
  assert.equal(state.schemaVersion, '1.10.0'); assert.equal(state.roundFlow.roundNumber, 2); assert.equal(state.roundFlow.completedMajorAction, null); assert.equal(state.playerOrder[0], 'p2');
  assert.deepEqual(state.roundFlow.rolesByPlayer[0].discarded, [f.roleId]); assert.equal(state.roundFlow.rolesByPlayer[0].used, null);
  assert.equal(Object.keys(game.getMarkerLedger(state, f.definition)).length, f.definition.players.length * 30);
  return state;
}
for (const count of [2, 3, 4]) {
  const f = setup(count, 'ROLE-02'); let state = f.state;
  state = send(state, f.definition, { type: 'choose-major-action', action: 'explore' });
  state = game.applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'explore', nodeId: 'B-01', path: [{ routeId: 'R-route-02', toNodeId: 'B-01' }] });
  const choiceId = `${state.exploration.cardId}:1`;
  state = game.applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'choose-exploration-event', choice: { choiceId } });
  const slots = f.board.resourceNodes['B-01'].influenceSlotIds;
  state = game.applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'place-exploration-influence', slotId: slots[0] });
  assert.equal(game.getRoundTurn(state, f.definition).majorActionStatus, 'complete');
  const decks = state.eventDecks, fuel = state.players.p1.balances.originium;
  assert.ok(game.getElysiumSchemeOptions(state, f.definition, 'p1').some(option => option.nodeId === 'B-01' && option.routeId === 'R-route-02'));
  state = use(f, state, 'both', { kind: 'elysium-city-move', costDecision: 'pay', nodeId: 'B-01', routeId: 'R-route-02', finalSlotId: slots[1] }, { kind: 'minimum-resource', asset: 'iron' });
  assert.equal(state.players.p1.balances.iron, 1); assert.equal(state.players.p1.balances.originium, fuel); assert.equal(state.board.cityNodeByPlayer.p1, 'B-01'); assert.deepEqual(state.eventDecks, decks);
  assert.equal(state.exploration, undefined); assert.equal(state.roundFlow.completedMajorAction, 'explore');
  assert.throws(() => send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' }), /One major action/);
  finish(f, state);

  const t = setup(count, 'ROLE-03'), routeSlots = Object.values(t.board.routes).flatMap(route => route.influenceSlotIds); let texas = send(t.state, t.definition, { type: 'choose-major-action', action: 'deploy' });
  texas = game.applyInfluenceCommand(texas, t.definition, { authenticatedPlayerId: 'p1' }, { ...env(texas), type: 'deploy-influence', slotId: routeSlots[0] });
  const supply = texas.facilities.supply, selected = supply.supply[0], money = texas.players.p1.balances['columbia-voucher'];
  texas = use(t, texas, 'both', { kind: 'texas-influence', costDecision: 'pay', replaceSlotId: routeSlots[0], move: { sourceSlotId: routeSlots[0], targetSlotId: routeSlots[1] }, removeSlotId: routeSlots[1] }, { kind: 'cycle-facility', cardId: selected });
  assert.equal(texas.players.p1.balances['columbia-voucher'], money + 9); assert.equal(texas.roundFlow.completedMajorAction, 'deploy');
  assert.equal(texas.board.influenceBySlot[routeSlots[0]], null); assert.equal(texas.board.influenceBySlot[routeSlots[1]], null); assert.deepEqual([...texas.markerSupplyByPlayer.p1].sort(), [...t.state.markerSupplyByPlayer.p1].sort());
  assert.equal(texas.facilities.supply.revision, supply.revision + 1); finish(t, texas);

  const c = setup(count, 'ROLE-04'), before = c.state.players;
  const sold = use(c, c.state, 'scheme', { kind: 'forced-sale', asset: 'originium' });
  for (const [id, player] of Object.entries(before)) { assert.equal(sold.players[id].balances.originium, 0); assert.equal(sold.players[id].balances['columbia-voucher'], player.balances['columbia-voucher'] + 2 * player.balances.originium); }
  assert.equal(sold.players.p1.score, before.p1.score + 1); assert.equal(sold.players.p1.balances['pure-originium'], before.p1.balances['pure-originium']); finish(c, sold);
  console.log(JSON.stringify({ players: count, format: '1.10.0', realNewSchemes: 3, freeMoveAfterExploration: true, texasSteps: 3, forcedSaleIncludesSelf: true, scoreGain: 1, nextRound: 2 }));
}
console.log('PASS: compiled three remaining schemes in real 2/3/4-player games, real entry/exploration/deployment, strategy-first both, post-action retirement, forced sales, persistence/replay, next-round inventory and marker conservation');
