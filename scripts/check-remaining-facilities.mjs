import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
for (const name of ['enableNestedFacilityEntries', 'applyNestedFacilityEntryCommand', 'getNestedFacilityEntryOptions', 'getPendingFacilityEventRequirements']) assert.equal(core[name], game[name]);
assert.equal(core.getFacilityConstructionSupport().supportedPhysicalCardIds.length, 41);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const cardOf = id => core.FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === id && card.color === core.getFoundersFacilityFace(id).observedColor).id;
const env = state => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const send = (state, definition, payload) => game.applyRoundCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), ...payload });
const resume = (state, definition) => game.parseGameState(JSON.parse(JSON.stringify(state)), definition);
const entry = (state, definition, payload) => {
  const before = JSON.stringify(state), command = { ...env(state), ...payload };
  const next = game.applyNestedFacilityEntryCommand(resume(state, definition), definition, { authenticatedPlayerId: 'p1' }, command);
  assert.equal(JSON.stringify(state), before); assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.throws(() => game.applyNestedFacilityEntryCommand(next, definition, { authenticatedPlayerId: 'p1' }, command), /stale/);
  return resume(next, definition);
};
function dispatch(state, definition) {
  state = send(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction.status === 'ready') state = game.applyInfluenceCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), type: 'finish-dispatch' });
  return send(state, definition, { type: 'finish-player-turn' });
}
function prepare(state, definition, protectedIds, roleId) {
  while (state.roundFlow.stage === 'role-removal') state = send(state, definition, { type: 'remove-round-supply-card', cardId: state.facilities.supply.supply.find(id => !protectedIds.includes(id)) });
  while (state.roundFlow.stage === 'role-placement') state = send(state, definition, { type: 'place-round-role', roleId });
  while (game.getRoundTurn(state, definition).actorId !== 'p1') state = dispatch(state, definition);
  return state;
}
function finish(state, definition) {
  if (state.phase === 'construction') state = send(state, definition, { type: 'finish-player-turn' });
  while (state.roundFlow.stage === 'player-actions') state = dispatch(state, definition);
  state = game.openHarvestPhase(state, definition, { expectedVersion: state.stateVersion, roundNumber: state.roundFlow.roundNumber });
  for (const player of definition.players) state = game.applyHarvestCommand(state, definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return game.finishManagedRound(state, definition, { expectedVersion: state.stateVersion });
}
function construct(state, definition, cardId, cellId, entryChoice = { kind: 'deferred-entry' }) {
  state = send(state, definition, { type: 'choose-major-action', action: 'construct' });
  return game.applyConstructionCommand(state, definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'construct-facility', cardId, cellId, paymentMode: 'vouchers', entryChoice });
}
const mining = { kind: 'resource-allocation', gains: { orirock: 2, originium: 2, iron: 1 } };
for (const count of [2, 3, 4]) for (const scenario of ['logistics', 'logistics-red', 'logistics-blue', 'variant-iron', 'variant-originium', 'variant-orirock', 'power', 'camp-logistics', 'camp-warehouse', 'energy-mining', 'council']) {
  const setup = game.createPreEntryGame('compiled-remaining', seats.slice(0, count)), definition = setup.definition;
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = game.beginEntry(setup.state, definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id), expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    state = game.applyEntryCommand(state, definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    state = game.applyEntryCommand(state, definition, { authenticatedPlayerId: seats[i].id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) state = game.applyEntryCommand(state, definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  const variant = { 'variant-iron': ['FAC-010', 'blue', 'iron', 4, 15, 1], 'variant-originium': ['FAC-011', 'yellow', 'originium', 6, 10, 0], 'variant-orirock': ['FAC-012', 'red', 'orirock', 7, 10, 0] }[scenario];
  const rootId = variant ? core.FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === variant[0] && card.color === variant[1]).id : cardOf(scenario.startsWith('camp') ? 'FAC-016' : scenario.startsWith('logistics') ? 'FAC-004' : scenario === 'power' ? 'FAC-007' : scenario === 'energy-mining' ? 'FAC-014' : 'FAC-015');
  const protectedIds = [rootId, ...(scenario === 'camp-logistics' ? [cardOf('FAC-004')] : scenario === 'camp-warehouse' ? [cardOf('FAC-001')] : scenario === 'energy-mining' ? [cardOf('FAC-008')] : [])];
  state = game.beginRoundFlow(state, definition, { expectedVersion: state.stateVersion, facilityDeckOrder: [...protectedIds, ...ordinary.filter(id => !protectedIds.includes(id))], deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [game.enableBaseRoleEffects, game.enableLiskarmEffects, game.enableRemainingBaseRoleEffects, game.enableWarehouseEntries, game.enableNestedFacilityEntries]) state = upgrade(state, definition, { expectedVersion: state.stateVersion });
  // Earn all spending money through three real rounds: entry10 + Texas12 + selling actual3originium9 + recovering2roles10 =41.
  state = prepare(state, definition, protectedIds, 'ROLE-03');
  state = game.applyBaseRoleCommand(state, definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: state.facilities.supply.supply.find(id => !protectedIds.includes(id)) } });
  state = finish(state, definition); state = prepare(state, definition, protectedIds, 'ROLE-04');
  const balances = state.players.p1.balances;
  state = game.applyBaseRoleCommand(state, definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-04', mode: 'strategy', strategyChoice: { kind: 'sell-resources', amounts: { orirock: balances.orirock, originium: balances.originium, iron: balances.iron, 'pure-originium': balances['pure-originium'] } } });
  state = finish(state, definition); state = prepare(state, definition, protectedIds, 'ROLE-05');
  state = game.applyBaseRoleCommand(state, definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-05', mode: 'scheme', schemeChoice: { kind: 'recover-roles', rewards: state.roundFlow.rolesByPlayer.find(row => row.playerId === 'p1').discarded.map(roleId => ({ roleId, kind: 'vouchers' })) } });
  assert.equal(state.players.p1.balances['columbia-voucher'], 41);
  if (scenario === 'energy-mining') {
    state = construct(state, definition, cardOf('FAC-008'), 'CP-2-1');
    state = entry(state, definition, { type: 'resolve-facility-entry', entryChoice: mining });
    state = send(state, definition, { type: 'finish-player-turn' });
    while (game.getRoundTurn(state, definition).actorId !== 'p1') state = dispatch(state, definition);
  }
  state = construct(state, definition, rootId, 'CP-1-1'); state = resume(state, definition);
  if (scenario.startsWith('camp')) {
    const logistics = scenario === 'camp-logistics';
    assert.throws(() => send(state, definition, { type: 'finish-player-turn' }), /Finish exactly one major action/);
    state = entry(state, definition, { type: 'construct-entry-facility', cardId: cardOf(logistics ? 'FAC-004' : 'FAC-001'), cellId: 'CP-2-1', paymentMode: 'vouchers', entryChoice: logistics ? { kind: 'deferred-entry' } : { kind: 'warehouse-entry' } });
    if (!logistics) {
      state = entry(state, definition, { type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-explore' } });
      state = entry(state, definition, { type: 'explore', nodeId: 'B-01', path: [{ routeId: 'R-route-02', toNodeId: 'B-01' }] });
      const card = state.construction.entryStack.at(-1).progress.cardId;
      game.getPendingFacilityEventRequirements(state, definition, 'p1', `${card}:1`);
      state = entry(state, definition, { type: 'choose-exploration-event', choice: { choiceId: `${card}:1` } });
      state = entry(state, definition, { type: 'place-exploration-influence', slotId: game.getNestedFacilityEntryOptions(state, definition, 'p1').finalSlotIds[0] });
    }
  }
  if (scenario.startsWith('logistics') || scenario === 'camp-logistics') {
    const color = scenario === 'logistics-red' ? 'red' : scenario === 'logistics-blue' ? 'blue' : 'yellow';
    const extension = core.FOUNDERS_FACILITY_STOCK.cards.find(card => card.group === 'extension-hub' && card.color === color);
    assert.deepEqual(game.getNestedFacilityEntryOptions(state, definition, 'p1').extensionCardIds, state.facilities.supply.extensionReserve);
    state = entry(state, definition, { type: 'build-logistics-extension', placement: { cardId: extension.id, cellId: 'CP-1-2' } });
    assert.equal(state.players.p1.score, scenario === 'camp-logistics' ? 0 : 1);
  }
  if (variant) {
    assert.equal(state.players.p1.balances[variant[2]], variant[3]); assert.equal(state.players.p1.score, variant[5]);
    assert(state.facilities.supply.playerHoldings.find(row => row.playerId === 'p1').cardIds.includes(rootId));
  }
  if (scenario === 'energy-mining') {
    state = entry(state, definition, { type: 'copy-facility-entry', targetCardId: cardOf('FAC-008') });
    state = entry(state, definition, { type: 'resolve-facility-entry', entryChoice: mining });
    assert.equal(state.players.p1.balances.orirock, 4); assert.equal(state.players.p1.balances.originium, 4); assert.equal(state.players.p1.balances.iron, 2); assert.equal(state.players.p1.score, 1);
  }
  if (scenario === 'power') {
    const originium = state.players.p1.balances.originium;
    state = entry(state, definition, { type: 'move-city', nodeId: 'B-01', routeId: 'R-route-02' }); assert.equal(state.players.p1.balances.originium, originium);
    const card = state.construction.entryStack.at(-1).progress.cardId;
    state = entry(state, definition, { type: 'choose-city-move-event', choice: { choiceId: `${card}:1` } });
    state = entry(state, definition, { type: 'place-city-move-influence', slotId: game.getNestedFacilityEntryOptions(state, definition, 'p1').finalSlotIds[0] });
    assert.equal(state.construction.status, 'entry-pending');
    state = entry(state, definition, { type: 'place-entry-route-influence', slotId: game.getNestedFacilityEntryOptions(state, definition, 'p1').routeSlotIds[0] });
    assert.equal(state.board.cityNodeByPlayer.p1, 'B-01');
  }
  assert.equal(state.construction.status, 'complete'); assert.equal(game.getRoundTurn(state, definition).majorActionStatus, 'complete');
  assert.equal(state.construction.constructionsCompleted, 1); assert.equal(state.construction.builtCardId, rootId);
  const cash = state.players.p1.balances['columbia-voucher'];
  assert.equal(cash, variant ? 41 - variant[4] : scenario.startsWith('logistics') ? 17 : scenario === 'power' ? 21 : scenario === 'camp-logistics' ? 9 : scenario === 'camp-warehouse' ? 22 : scenario === 'energy-mining' ? 8 : 24);
  state = finish(state, definition); assert.equal(state.roundFlow.roundNumber, 4); assert.equal(state.schemaVersion, '1.12.0');
  if (scenario === 'council') assert.equal(state.playerOrder[0], 'p1');
  assert.equal(state.roundFlow.startingPlayerOverride, null); assert.equal(Object.keys(game.getMarkerLedger(state, definition)).length, count * 30);
  console.log(JSON.stringify({ players: count, scenario, vouchers: cash, nextRound: 4, format: '1.12.0', allIncomeEarned: true, noExtraMajorAction: true }));
}
console.log('PASS: 33 compiled 2/3/4-player real three-round funded scenarios; all base facility colours and remaining facilities, nesting/save-resume/replay, events/target/route, council cleanup and physical conservation');
