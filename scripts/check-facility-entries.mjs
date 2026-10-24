import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
import * as facilities from '@nomad-city-online/game-core/facilities';
assert.equal(core.facilityEntryChoiceSchema, facilities.facilityEntryChoiceSchema);
assert.equal(facilities.getFacilityConstructionSupport().supportedFacilityIds.length, 16);
assert.equal(facilities.getFacilityConstructionSupport().supportedPhysicalCardIds.length, 41);
assert.equal(facilities.getFacilityConstructionSupport().allFacilitiesImplemented, true);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = facilities.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = state => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const send = (state, definition, payload) => game.applyRoundCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), ...payload });
function setup(count, facilityId) {
  const setup = game.createPreEntryGame('compiled-facility-entries', seats.slice(0, count));
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = game.beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id), expectedVersion: 0,
    greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let index = 0; index < count; index++) {
    state = game.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: seats[index].id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
    state = game.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: seats[index].id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) state = game.applyEntryCommand(state, setup.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  const cardId = facilities.FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === facilityId && card.color === facilities.getFoundersFacilityFace(facilityId).observedColor).id;
  state = game.beginRoundFlow(state, setup.definition, { expectedVersion: state.stateVersion, facilityDeckOrder: [cardId, ...ordinary.filter(id => id !== cardId)], deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  state = game.enableBaseRoleEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  state = game.enableLiskarmEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  state = game.enableRemainingBaseRoleEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  while (state.roundFlow.stage === 'role-removal') state = send(state, setup.definition, { type: 'remove-round-supply-card', cardId: state.facilities.supply.supply.find(id => id !== cardId) });
  while (state.roundFlow.stage === 'role-placement') state = send(state, setup.definition, { type: 'place-round-role', roleId: game.getRoundTurn(state, setup.definition).actorId === 'p1' ? 'ROLE-03' : 'ROLE-01' });
  return { state, definition: setup.definition, cardId, board: core.loadFoundersBoard(count === 4 ? 'four-player' : 'three-player') };
}
function dispatchTurn(state, definition) {
  state = send(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction.status === 'ready') state = game.applyInfluenceCommand(state, definition, { authenticatedPlayerId: game.getRoundTurn(state, definition).actorId }, { ...env(state), type: 'finish-dispatch' });
  return send(state, definition, { type: 'finish-player-turn' });
}
for (const count of [2, 3, 4]) for (const facilityId of ['FAC-002', 'FAC-003', 'FAC-006']) {
  const f = setup(count, facilityId), slots = Object.values(f.board.routes).flatMap(route => route.influenceSlotIds); let state = f.state;
  const p1OriginalSupply = [...state.markerSupplyByPlayer.p1], p2OriginalSupply = [...state.markerSupplyByPlayer.p2];
  // Actual first-cycle actions create the influence targets, with no snapshot injection.
  state = send(state, f.definition, { type: 'choose-major-action', action: 'deploy' });
  state = game.applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'deploy-influence', slotId: slots[0] });
  state = send(state, f.definition, { type: 'finish-player-turn' });
  state = game.applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: [slots[1], slots[2]] } });
  while (game.getRoundTurn(state, f.definition).actorId !== 'p1') state = dispatchTurn(state, f.definition);
  const selected = state.facilities.supply.supply.find(id => id !== f.cardId);
  state = game.applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: selected } });
  assert.equal(state.players.p1.balances['columbia-voucher'], 22);
  state = send(state, f.definition, { type: 'choose-major-action', action: 'construct' });
  state = game.parseGameState(JSON.parse(JSON.stringify(state)), f.definition);
  const entryChoice = facilityId === 'FAC-002' ? { kind: 'remove-influence', slotIds: [slots[1], slots[2]] }
    : facilityId === 'FAC-003' ? { kind: 'mercenary-influence', effect: 'replace', slotId: slots[1] }
    : { kind: 'sell-resources', amounts: { orirock: 0, originium: 3, iron: 0, 'pure-originium': 0 } };
  const payload = { ...env(state), type: 'construct-facility', cardId: f.cardId, cellId: 'CP-1-1', paymentMode: 'vouchers', entryChoice };
  const before = JSON.stringify(state), quote = game.getConstructionQuote(state, f.definition, { authenticatedPlayerId: 'p1' }, payload);
  assert.equal(JSON.stringify(state), before); assert.equal(quote.canPay, true); assert.equal(quote.entryChoiceKind, entryChoice.kind);
  const next = game.applyConstructionCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, payload);
  assert.equal(JSON.stringify(state), before); assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.throws(() => game.applyConstructionCommand(next, f.definition, { authenticatedPlayerId: 'p1' }, payload), /stale/);
  assert.throws(() => game.applyConstructionCommand(next, f.definition, { authenticatedPlayerId: 'p1' }, { ...payload, expectedVersion: next.stateVersion }), /unused construction grant/);
  assert.equal(next.facilities.supply.supply.length, 6); assert.equal(next.facilities.supply.revision, state.facilities.supply.revision + 1); assert.equal(next.facilities.panels[0].revision, 1);
  assert.equal(next.players.p1.balances['columbia-voucher'], facilityId === 'FAC-006' ? 25 : 4);
  assert.equal(next.players.p1.score, facilityId === 'FAC-003' ? 1 : 0);
  if (facilityId === 'FAC-002') { assert.equal(next.board.influenceBySlot[slots[1]], null); assert.equal(next.board.influenceBySlot[slots[2]], null); assert.deepEqual([...next.markerSupplyByPlayer.p2].sort(), p2OriginalSupply.sort()); }
  if (facilityId === 'FAC-003') { assert.equal(next.board.influenceBySlot[slots[1]].ownerPlayerId, 'p1'); assert.equal(next.markerSupplyByPlayer.p1.length, p1OriginalSupply.length - 2); }
  if (facilityId === 'FAC-006') { assert.equal(next.players.p1.balances.originium, 0); assert.deepEqual(next.players.p2, state.players.p2); }
  state = send(next, f.definition, { type: 'finish-player-turn' });
  while (state.roundFlow.stage === 'player-actions') state = dispatchTurn(state, f.definition);
  state = game.openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: 1 });
  for (const player of f.definition.players) state = game.applyHarvestCommand(state, f.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  if (facilityId !== 'FAC-002') assert.throws(() => game.finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), /delayed removal/);
  state = game.openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion });
  while (game.getRoundTurn(state, f.definition).actorId !== null) {
    const actorId = game.getRoundTurn(state, f.definition).actorId, slotId = game.getRoleCleanupOptions(state, f.definition, actorId)[0];
    state = game.applyRoleCleanupCommand(state, f.definition, { authenticatedPlayerId: actorId }, { ...env(state), type: 'resolve-role-cleanup', slotId });
  }
  state = game.finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion });
  assert.equal(state.schemaVersion, '1.10.0'); assert.equal(state.roundFlow.roundNumber, 2); assert.equal(state.playerOrder[0], 'p2');
  assert.ok(state.facilities.panels[0].placements.some(row => row.cardId === f.cardId)); assert.equal(game.validateGameState(state, f.definition).success, true);
  assert.equal(Object.keys(game.getMarkerLedger(state, f.definition)).length, count * 30);
  console.log(JSON.stringify({ players: count, facilityId, finalVouchers: state.players.p1.balances['columbia-voucher'], printedPoints: state.players.p1.score, format: state.schemaVersion, nextRound: 2 }));
}
console.log('PASS: compiled 2/3/4-player three new facility entries, real entry/deployment/Liskarm/Texas income, construction/payment/refill/effect atomically, save/replay, both cycles, harvest/cleanup and next-round conservation');
