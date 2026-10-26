import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as directGame from '@nomad-city-online/game-core/game';
const apiMode = process.argv.includes('--player-api');
let acceptedRequests = 0, rejectedRequests = 0;
const routedChannels = new Set();
const channels = { applyEntryCommand: 'entry', applyRoundCommand: 'round', applyExplorationCommand: 'exploration',
  applyCityMoveCommand: 'city-move', applyInfluenceCommand: 'influence', applyHarvestCommand: 'harvest',
  applyConstructionCommand: 'construction', applyBaseRoleCommand: 'role', applyRoleCleanupCommand: 'role-cleanup',
  applyWarehouseEntryCommand: 'warehouse-entry', applyNestedFacilityEntryCommand: 'facility-entry',
  applyCityPatternCommand: 'city-pattern', applyCityPatternContinuationCommand: 'pattern-continuation' };
const game = apiMode ? { ...directGame, ...Object.fromEntries(Object.entries(channels).map(([name, channel]) => [name,
  (state, definition, context, command) => {
    const before = JSON.stringify(state), requestId = `compiled-${acceptedRequests + rejectedRequests}`;
    const result = core.executeGamePlayerRequest(state, definition, context, { apiVersion: '1.0.0', requestId, channel, command });
    assert.equal(JSON.stringify(state), before);
    if (result.status === 'rejected') {
      rejectedRequests++; assert.equal(Object.hasOwn(result, 'state'), false);
      throw new Error(JSON.stringify(result.reply));
    }
    acceptedRequests++; routedChannels.add(channel);
    assert.deepEqual(result.reply, { apiVersion: '1.0.0', requestId, ok: true, gameId: state.gameId, stateVersion: state.stateVersion + 1 });
    return result.state;
  }])) } : directGame;
function checkViews(state, definition) {
  if (!apiMode) return;
  const publicView = core.getGamePublicView(state, definition);
  const restored = game.parseGameState(JSON.parse(JSON.stringify(state)), definition);
  assert.deepEqual(core.getGamePublicView(restored, definition), publicView);
  assert.equal(Object.hasOwn(publicView, 'eventDecks'), false);
  assert.equal(Object.hasOwn(publicView.facilities.supply, 'drawPile'), false);
  for (const player of definition.players) {
    const view = core.getGamePlayerView(state, definition, { authenticatedPlayerId: player.id });
    assert.deepEqual(view.public, publicView);
    assert.equal(view.private.playerId, player.id);
    assert.deepEqual(view.private.roleHand, [...state.roundFlow.rolesByPlayer.find(r => r.playerId === player.id).hand].sort());
    assert.equal(Object.hasOwn(view.public.players.find(p => p.playerId !== player.id).roles, 'hand'), false);
    assert.deepEqual(core.getGamePlayerView(restored, definition, { authenticatedPlayerId: player.id }), view);
  }
  if (state.finalScoring) assert.deepEqual(publicView.finalResult, core.getFinalScoringResult(state, definition));
}
assert.equal(core.enableTemporarySettlements, game.enableTemporarySettlements);
assert.equal(core.finalizeBaseGame, game.finalizeBaseGame);
assert.equal(core.getFinalScoringResult, game.getFinalScoringResult);
let majorActions = 0;
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
const temporary = core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.facilityId === 'FAC-017').map(c => c.id);
const trade = ordinary.find(id => id.startsWith('FC:FAC-006:'));
const tradeNext = ordinary.filter(id => id.startsWith('FC:FAC-006:'))[1];
const red = ordinary.find(id => id.startsWith('FC:FAC-010:red:'));
const yellow = ordinary.find(id => id.startsWith('FC:FAC-012:yellow:'));
const protectedIds = [temporary[0], trade, tradeNext, red, yellow];
const env = s => ({ gameId: s.gameId, expectedVersion: s.stateVersion });
const round = (s, d, command) => { const next = game.applyRoundCommand(s, d, { authenticatedPlayerId: game.getRoundTurn(s, d).actorId }, { ...env(s), ...command }); if (command.type === 'choose-major-action') majorActions++; return next; };
const resume = (s, d) => game.parseGameState(JSON.parse(JSON.stringify(s)), d);
function dispatch(s, d) {
  s = round(s, d, { type: 'choose-major-action', action: 'dispatch' });
  if (s.influenceAction.status === 'ready') s = game.applyInfluenceCommand(s, d, { authenticatedPlayerId: game.getRoundTurn(s, d).actorId }, { ...env(s), type: 'finish-dispatch' });
  return round(s, d, { type: 'finish-player-turn' });
}
function prepare(s, d) {
  while (s.roundFlow.stage === 'role-removal') s = round(s, d, { type: 'remove-round-supply-card', cardId: s.facilities.supply.supply.find(id => !protectedIds.includes(id)) });
  while (s.roundFlow.stage === 'role-placement') s = round(s, d, { type: 'place-round-role', roleId: s.roundFlow.roundNumber === 8 ? 'ROLE-01' : ({ 1: 'ROLE-03', 2: 'ROLE-04', 3: 'ROLE-05' })[s.roundFlow.roundNumber] ?? 'ROLE-02' });
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
  majorActions = 0;
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
  checkViews(s, d);
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
  checkViews(s, d);
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
  // Continue every remaining scheduled round. All late harvest income comes from actual city nodes.
  let beforeCleanupRegionPoints = null;
  while (s.roundFlow.stage !== 'finished') {
    s = prepare(s, d);
    while (s.roundFlow.stage === 'player-actions') {
      const actorId = game.getRoundTurn(s, d).actorId;
      if (s.roundFlow.roundNumber === 8 && actorId === 'p1' && !s.roundFlow.rolesByPlayer.find(p => p.playerId === 'p1').used) {
        s = game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: ['route:A-route-01:slot:1', 'route:B-route-02:slot:1'] } });
      }
      s = dispatch(s, d);
    }
    const roundNumber = s.roundFlow.roundNumber;
    assert.throws(() => game.finalizeBaseGame(s, d, { expectedVersion: s.stateVersion }));
    s = game.openHarvestPhase(s, d, { expectedVersion: s.stateVersion, roundNumber });
    for (const p of d.players) s = game.applyHarvestCommand(s, d, { authenticatedPlayerId: p.id }, { ...env(s), type: 'set-harvest-plan', plan: { nodeIds: [s.board.cityNodeByPlayer[p.id]], routeIds: [] } });
    if (roundNumber === 8) {
      beforeCleanupRegionPoints = game.getBaseScoringPreview(game.getGamePosition(s, d), d).players.p1.regionPoints;
      assert.throws(() => game.finalizeBaseGame(s, d, { expectedVersion: s.stateVersion }));
      assert.throws(() => game.finishManagedRound(s, d, { expectedVersion: s.stateVersion }));
      s = game.openManagedCleanup(s, d, { expectedVersion: s.stateVersion });
      assert.ok(game.getRoleCleanupOptions(s, d, 'p1').includes('route:A-route-01:slot:1'));
      s = game.applyRoleCleanupCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'resolve-role-cleanup', slotId: 'route:A-route-01:slot:1' });
    }
    s = resume(game.finishManagedRound(s, d, { expectedVersion: s.stateVersion }), d);
  }
  assert.equal(majorActions, count * 16);
  const preview = game.getBaseScoringPreview(game.getGamePosition(s, d), d), preFinal = JSON.stringify(s);
  assert.equal(beforeCleanupRegionPoints - preview.players.p1.regionPoints, 3);
  assert.equal(preview.regions.A.controllerPlayerId, null);
  const final = game.finalizeBaseGame(s, d, { expectedVersion: s.stateVersion });
  assert.equal(JSON.stringify(s), preFinal); assert.equal(final.stateVersion, s.stateVersion + 1); assert.equal(final.schemaVersion, '1.17.0');
  for (const p of d.players) {
    assert.equal(final.players[p.id].score, preview.players[p.id].totalPoints);
    assert.deepEqual(final.players[p.id].balances, s.players[p.id].balances);
  }
  assert.deepEqual(final.facilities, s.facilities); assert.deepEqual(final.cityPatterns, s.cityPatterns); assert.deepEqual(final.temporarySettlementReturns, s.temporarySettlementReturns);
  assert.throws(() => game.finalizeBaseGame(final, d, { expectedVersion: s.stateVersion }));
  assert.throws(() => game.finalizeBaseGame(final, d, { expectedVersion: final.stateVersion }));
  assert.throws(() => round(final, d, { type: 'choose-major-action', action: 'dispatch' }));
  const result = game.getFinalScoringResult(resume(final, d), d);
  checkViews(final, d);
  assert.deepEqual(result.players, preview.players); assert.deepEqual(result.winnerPlayerIds, preview.leadingPlayerIds);
  assert.deepEqual(result.rankingGroups[0], result.winnerPlayerIds);
  assert.deepEqual(game.getRoundPublicView(final, d, 'p1').finalResult, result);
  assert.equal(Object.hasOwn(result, 'eventDecks'), false); assert.equal(Object.keys(game.getMarkerLedger(final, d)).length, count * 30);
  console.log(JSON.stringify({ players: count, scenario, completedRounds: 8, majorActions, realBuilds: builds.length + (isNew ? 1 : 0), returned: returns.length,
    scores: Object.fromEntries(d.players.map(p => [p.id, final.players[p.id].score])), winners: result.winnerPlayerIds, resolvedBy: result.resolvedBy,
    finalFormat: final.schemaVersion, sourceFormat: s.schemaVersion, delayedCleanupChangesRegionScore: true, noInjectedState: true }));
}
console.log('PASS: 12 complete 2/3/4-player eight-round games, earned income, unique construction, declarations/optional returns, nested construction, real harvest, delayed cleanup, one-time final scores, ranking, persistence, privacy and action locking');
if (apiMode) {
  assert.ok(acceptedRequests > 1000); assert.ok(rejectedRequests > 0);
  for (const channel of ['entry', 'round', 'influence', 'role', 'construction', 'city-pattern', 'harvest', 'role-cleanup']) assert.ok(routedChannels.has(channel));
  console.log(JSON.stringify({ playerApi: 'PASS', acceptedRequests, rejectedRequests, routedChannels: [...routedChannels].sort(), viewCheckpoints: 36 }));
}
