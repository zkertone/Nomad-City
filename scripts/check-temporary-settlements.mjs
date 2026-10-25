import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
assert.equal(core.enableTemporarySettlements, game.enableTemporarySettlements);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
const temporary = core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.facilityId === 'FAC-017').map(c => c.id);
const trade = ordinary.find(id => id.startsWith('FC:FAC-006:'));
const tradeNext = ordinary.filter(id => id.startsWith('FC:FAC-006:'))[1];
const red = ordinary.find(id => id.startsWith('FC:FAC-010:red:'));
const yellow = ordinary.find(id => id.startsWith('FC:FAC-012:yellow:'));
const protectedIds = [temporary[0], trade, tradeNext, red, yellow];
const env = s => ({ gameId: s.gameId, expectedVersion: s.stateVersion });
const round = (s, d, command) => game.applyRoundCommand(s, d, { authenticatedPlayerId: game.getRoundTurn(s, d).actorId }, { ...env(s), ...command });
const resume = (s, d) => game.parseGameState(JSON.parse(JSON.stringify(s)), d);
function dispatch(s, d) {
  s = round(s, d, { type: 'choose-major-action', action: 'dispatch' });
  if (s.influenceAction.status === 'ready') s = game.applyInfluenceCommand(s, d, { authenticatedPlayerId: game.getRoundTurn(s, d).actorId }, { ...env(s), type: 'finish-dispatch' });
  return round(s, d, { type: 'finish-player-turn' });
}
function prepare(s, d) {
  while (s.roundFlow.stage === 'role-removal') s = round(s, d, { type: 'remove-round-supply-card', cardId: s.facilities.supply.supply.find(id => !protectedIds.includes(id)) });
  while (s.roundFlow.stage === 'role-placement') s = round(s, d, { type: 'place-round-role', roleId: ({ 1: 'ROLE-03', 2: 'ROLE-04', 3: 'ROLE-05' })[s.roundFlow.roundNumber] ?? 'ROLE-02' });
  return s;
}
function finish(s, d) {
  if (game.getRoundTurn(s, d).majorActionStatus === 'complete') s = round(s, d, { type: 'finish-player-turn' });
  while (s.roundFlow.stage === 'player-actions') s = dispatch(s, d);
  s = game.openHarvestPhase(s, d, { expectedVersion: s.stateVersion, roundNumber: s.roundFlow.roundNumber });
  for (const p of d.players) s = game.applyHarvestCommand(s, d, { authenticatedPlayerId: p.id }, { ...env(s), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return resume(game.finishManagedRound(s, d, { expectedVersion: s.stateVersion }), d);
}
function nextP1(s, d) {
  for (;;) {
    if (s.roundFlow.stage === 'harvest') { s = finish(s, d); continue; }
    if (['role-removal', 'role-placement'].includes(s.roundFlow.stage)) { s = prepare(s, d); continue; }
    const turn = game.getRoundTurn(s, d);
    if (turn.actorId === 'p1' && turn.majorActionStatus === 'not-started') return s;
    s = turn.majorActionStatus === 'complete' ? round(s, d, { type: 'finish-player-turn' }) : dispatch(s, d);
  }
}
for (const count of [2, 3, 4]) for (const scenario of [0, 1, 'new-build', 'new-build-keep']) {
  const isNew = typeof scenario === 'string', returnWanted = scenario === 1 || scenario === 'new-build';
  const g = game.createPreEntryGame('compiled-temporary', seats.slice(0, count)), d = g.definition;
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
  let s = game.beginEntry(g.state, d, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(p => p.id), expectedVersion: 0,
    greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    s = game.applyEntryCommand(s, d, { authenticatedPlayerId: seats[i].id }, { ...env(s), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    s = game.applyEntryCommand(s, d, { authenticatedPlayerId: seats[i].id }, { ...env(s), type: 'choose-green-event', choiceId: `${s.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) s = game.applyEntryCommand(s, d, { authenticatedPlayerId: 'p2' }, { ...env(s), type: 'choose-entry-influence', slotId: null });
  s = game.beginRoundFlow(s, d, { expectedVersion: s.stateVersion, facilityDeckOrder: ordinary, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [game.enableBaseRoleEffects, game.enableLiskarmEffects, game.enableRemainingBaseRoleEffects, game.enableWarehouseEntries, game.enableNestedFacilityEntries]) s = upgrade(s, d, { expectedVersion: s.stateVersion });
  const patternId = isNew ? 'PAT-013' : 'PAT-001';
  s = game.enableCityPatterns(s, d, { expectedVersion: s.stateVersion, gameplayVersion: 'base', patternOrder: [patternId, ...core.getEligibleCityPatterns('base', count).map(p => p.id).filter(id => id !== patternId)] });
  s = game.enableCityPatternContinuations(s, d, { expectedVersion: s.stateVersion });
  s = game.enableCityPatternMajorActions(s, d, { expectedVersion: s.stateVersion });
  s = game.enableTemporarySettlements(s, d, { expectedVersion: s.stateVersion, deckOrder: [...protectedIds, ...[...temporary, ...ordinary].filter(id => !protectedIds.includes(id))] });
  s = prepare(s, d);
  const initial = s.players.p1.balances['columbia-voucher'];
  s = game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: s.facilities.supply.supply.find(id => !protectedIds.includes(id)) } });
  s = nextP1(prepare(finish(s, d), d), d);
  const assets = s.players.p1.balances, earned = assets.orirock * 3 + assets.originium * 3 + assets.iron * 4 + assets['pure-originium'] * 15;
  s = game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-04', mode: 'strategy',
    strategyChoice: { kind: 'sell-resources', amounts: { orirock: assets.orirock, originium: assets.originium, iron: assets.iron, 'pure-originium': assets['pure-originium'] } } });
  s = nextP1(prepare(finish(s, d), d), d);
  s = game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-05', mode: 'scheme', schemeChoice: { kind: 'recover-roles', rewards: s.roundFlow.rolesByPlayer.find(p => p.playerId === 'p1').discarded.map(roleId => ({ roleId, kind: 'vouchers' })) } });
  const cash = initial + 12 + earned + 10; assert.equal(cash, 41); assert.equal(s.players.p1.balances['columbia-voucher'], cash);
  const builds = isNew ? [[trade, 'CP-2-2'], [yellow, 'CP-3-1'], [temporary[0], 'CP-3-3']] : [[temporary[0], 'CP-3-1'], [red, 'CP-3-3']];
  let paid = 0;
  for (const [cardId, cellId] of builds) {
    s = nextP1(s, d); s = round(s, d, { type: 'choose-major-action', action: 'construct' });
    const entryChoice = cardId === trade ? { kind: 'sell-resources', amounts: { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 } } : undefined;
    s = resume(game.applyConstructionCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId, cellId, paymentMode: 'vouchers', ...(entryChoice ? { entryChoice } : {}) }), d);
    paid += core.getFacilityExecutionFace(core.getFacilityPhysicalCard(cardId).facilityId).constructionCost.voucherPayment;
  }
  const coreId = s.facilities.panels[0].placements.find(p => p.cellId === 'CP-3-2').cardId;
  const returns = returnWanted ? [temporary[0]] : [], before = JSON.stringify(s), command = { ...env(s), type: 'declare-city-pattern', patternId,
    facilityCardIds: [coreId, ...builds.map(b => b[0])], returnTemporaryFacilityIds: returns };
  const next = game.applyCityPatternCommand(resume(s, d), d, { authenticatedPlayerId: 'p1' }, command);
  assert.equal(JSON.stringify(s), before); assert.throws(() => game.applyCityPatternCommand(next, d, { authenticatedPlayerId: 'p1' }, command));
  s = resume(next, d);
  assert.equal(s.players.p1.balances['columbia-voucher'], cash - paid + 12 * returns.length);
  if (isNew) {
    assert.equal(s.cityPatternContinuation.kind, 'declaration-build');
    assert.throws(() => round(s, d, { type: 'finish-player-turn' }));
    s = game.applyConstructionCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId: tradeNext, cellId: returnWanted ? 'CP-3-3' : 'CP-1-1', paymentMode: 'vouchers',
      entryChoice: { kind: 'sell-resources', amounts: { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 } } });
    assert.equal(s.cityPatternContinuation, null); assert.equal(s.players.p1.balances['columbia-voucher'], cash - paid + 12 * returns.length - 6);
  }
  assert.equal(game.getRoundTurn(s, d).majorActionStatus, 'complete');
  assert.throws(() => round(s, d, { type: 'choose-major-action', action: 'deploy' }));
  const records = s.temporarySettlementReturns, nextRound = s.roundFlow.roundNumber + 1;
  s = finish(s, d); assert.equal(s.roundFlow.roundNumber, nextRound); assert.deepEqual(s.temporarySettlementReturns, records);
  assert.equal(core.validateFacilitySupplyState(s.facilities.supply).success, true);
  assert.equal(Object.keys(game.getMarkerLedger(s, d)).length, count * 30);
  assert.equal(game.getCityPatternActionSupport(s.schemaVersion).allBasePatternActionsImplemented, true);
  console.log(JSON.stringify({ players: count, scenario, realBuilds: builds.length + (isNew ? 1 : 0), returned: returns.length,
    vouchers: s.players.p1.balances['columbia-voucher'], nextRound, format: s.schemaVersion, noInjectedState: true }));
}
console.log('PASS: 12 real 2/3/4-player temporary-settlement workflows, printed construction costs, unique-card restriction, optional returns, occupied-cell release, new-build continuation, quotas, cleanup and save recovery');
