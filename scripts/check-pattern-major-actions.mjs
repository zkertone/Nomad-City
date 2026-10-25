import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
for (const name of ['enableCityPatterns', 'applyCityPatternCommand', 'getCityPatternDeclarationOptions', 'getCityPatternSpecialOptions', 'enableCityPatternMajorActions']) assert.equal(core[name], game[name]);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
let actor = 'p1', scenarioName = '';
const ordinary = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const cardOf = (id, color, number = 0) => core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.facilityId === id && card.color === color)[number].id;
const env = s => ({ gameId: s.gameId, expectedVersion: s.stateVersion });
const round = (s, d, payload) => game.applyRoundCommand(s, d, { authenticatedPlayerId: game.getRoundTurn(s, d).actorId }, { ...env(s), ...payload });
const resume = (s, d) => game.parseGameState(JSON.parse(JSON.stringify(s)), d);
function pattern(s, d, payload) {
  const before = JSON.stringify(s), command = { ...env(s), ...payload };
  const next = game.applyCityPatternCommand(resume(s, d), d, { authenticatedPlayerId: actor }, command);
  assert.equal(next.stateVersion, s.stateVersion + 1); assert.equal(JSON.stringify(s), before);
  assert.throws(() => game.applyCityPatternCommand(next, d, { authenticatedPlayerId: actor }, command));
  return resume(next, d);
}
function dispatch(s, d) {
  s = round(s, d, { type: 'choose-major-action', action: 'dispatch' });
  if (s.influenceAction.status === 'ready') s = game.applyInfluenceCommand(s, d, { authenticatedPlayerId: game.getRoundTurn(s, d).actorId }, { ...env(s), type: 'finish-dispatch' });
  return round(s, d, { type: 'finish-player-turn' });
}
function finish(s, d) {
  if (game.getRoundTurn(s, d).majorActionStatus === 'complete') s = round(s, d, { type: 'finish-player-turn' });
  while (s.roundFlow.stage === 'player-actions') s = dispatch(s, d);
  s = game.openHarvestPhase(s, d, { expectedVersion: s.stateVersion, roundNumber: s.roundFlow.roundNumber });
  for (const player of d.players) s = game.applyHarvestCommand(s, d, { authenticatedPlayerId: player.id }, { ...env(s), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return game.finishManagedRound(s, d, { expectedVersion: s.stateVersion });
}
function prepare(s, d, protectedIds, roleId = 'ROLE-02') {
  while (s.roundFlow.stage === 'role-removal') s = round(s, d, { type: 'remove-round-supply-card', cardId: s.facilities.supply.supply.find(id => !protectedIds.includes(id)) });
  while (s.roundFlow.stage === 'role-placement') { const who = game.getRoundTurn(s, d).actorId; s = round(s, d, { type: 'place-round-role', roleId: scenarioName === 'command' && who === actor && roleId === 'ROLE-02' ? 'ROLE-04' : roleId }); }
  while (game.getRoundTurn(s, d).actorId !== actor) s = dispatch(s, d);
  return s;
}
function nextP1(s, d, protectedIds) {
  for (;;) {
    if (s.roundFlow.stage === 'harvest') { s = finish(s, d); continue; }
    if (['role-removal', 'role-placement'].includes(s.roundFlow.stage)) { s = prepare(s, d, protectedIds); continue; }
    const turn = game.getRoundTurn(s, d);
    if (turn.actorId === actor && turn.majorActionStatus === 'not-started') return s;
    if (turn.majorActionStatus === 'complete') s = round(s, d, { type: 'finish-player-turn' });
    else s = dispatch(s, d);
  }
}
function build(s, d, cardId, cellId) {
  s = round(s, d, { type: 'choose-major-action', action: 'construct' });
  const card = core.getFoundersPhysicalFacilityCard(cardId);
  let entryChoice;
  if (card.facilityId === 'FAC-006') entryChoice = { kind: 'sell-resources', amounts: { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 } };
  if (card.facilityId === 'FAC-001') {
    const board = core.loadFoundersBoard(d.players.length === 4 ? 'four-player' : 'three-player');
    const slots = Object.keys(board.influenceSlots).filter(id => board.influenceSlots[id].kind === 'route' && s.board.influenceBySlot[id] === null);
    entryChoice = { kind: 'warehouse-influence', placeSlotId: slots[0], move: { sourceSlotId: slots[0], targetSlotId: slots[1] } };
  }
  if (card.facilityId === 'FAC-003') {
    const occupied = Object.keys(s.board.influenceBySlot).find(id => s.board.influenceBySlot[id] !== null);
    entryChoice = { kind: 'mercenary-influence', effect: 'remove', ...(occupied ? { slotId: occupied } : {}) };
  }
  return game.applyConstructionCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'construct-facility', cardId, cellId, paymentMode: 'vouchers', ...(entryChoice ? { entryChoice } : {}) });
}


function commitChild(s, d) {
  assert.equal(game.getRoundTurn(s, d).majorActionStatus, 'complete');
  assert.throws(() => round(s, d, { type: 'finish-player-turn' }));
  return resume(round(s, d, { type: 'finish-pattern-action' }), d);
}
function childDeploy(s, d) {
  s = round(s, d, { type: 'choose-major-action', action: 'deploy' });
  s = game.applyInfluenceCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'deploy-influence', slotId: game.getDeploymentSlotIds(s, d, actor)[0] });
  return commitChild(s, d);
}
function childDispatch(s, d) {
  s = round(s, d, { type: 'choose-major-action', action: 'dispatch' });
  if (s.influenceAction.status === 'ready') s = game.applyInfluenceCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'finish-dispatch' });
  return commitChild(s, d);
}
function childExplore(s, d) {
  s = round(s, d, { type: 'choose-major-action', action: 'explore' });
  s = game.applyExplorationCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
  s = game.applyExplorationCommand(resume(s, d), d, { authenticatedPlayerId: actor }, { ...env(s), type: 'choose-exploration-event', choice: { choiceId: 'Y01:1' } });
  s = game.applyExplorationCommand(resume(s, d), d, { authenticatedPlayerId: actor }, { ...env(s), type: 'place-exploration-influence', slotId: game.getExplorationFinalSlotIds(s, d, actor)[0] });
  return commitChild(s, d);
}
function childConstruction(s, d) {
  s = round(s, d, { type: 'choose-major-action', action: 'construct' });
  const safe = ['none', 'gain', 'core-neighbor-vouchers', 'starting-player', 'warehouse', 'logistics', 'sell-resources', 'remove-two-influence', 'replace-or-remove-influence', 'choose-five-resources'];
  const cardId = s.facilities.supply.supply.find(id => { const spec = core.getFacilityConstructionSpec(id); return safe.includes(spec.entry.kind) && spec.printedCost.voucherPayment <= s.players[actor].balances['columbia-voucher']; });
  assert(cardId);
  const panel = s.facilities.panels.find(p => p.playerId === actor), cellId = core.getEmptyFacilityPanelCells(panel, s.facilities.supply)[0].id;
  s = game.applyConstructionCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'construct-facility', cardId, cellId, paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' } });
  if (s.construction.status === 'entry-pending') {
    const kind = game.getNestedFacilityEntryOptions(s, d, actor).kind;
    if (kind === 'logistics') s = game.applyNestedFacilityEntryCommand(resume(s, d), d, { authenticatedPlayerId: actor }, { ...env(s), type: 'build-logistics-extension', placement: null });
    else {
      const routes = Object.keys(s.board.influenceBySlot).filter(id => id.startsWith('route:') && s.board.influenceBySlot[id] === null), occupied = Object.keys(s.board.influenceBySlot).filter(id => s.board.influenceBySlot[id] !== null);
      let entryChoice;
      if (kind === 'warehouse') entryChoice = { kind: 'warehouse-influence', placeSlotId: routes[0], move: { sourceSlotId: routes[0], targetSlotId: routes[1] } };
      else if (kind === 'sell-resources') entryChoice = { kind, amounts: { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 } };
      else if (kind === 'remove-two-influence') entryChoice = { kind: 'remove-influence', slotIds: occupied.slice(0, 2) };
      else if (kind === 'replace-or-remove-influence') entryChoice = { kind: 'mercenary-influence', effect: 'remove', ...(occupied[0] ? { slotId: occupied[0] } : {}) };
      else if (kind === 'choose-five-resources') entryChoice = { kind: 'resource-allocation', gains: { orirock: 5, originium: 0, iron: 0 } };
      else throw Error('Unexpected chosen entry ' + kind);
      s = game.applyNestedFacilityEntryCommand(resume(s, d), d, { authenticatedPlayerId: actor }, { ...env(s), type: 'resolve-facility-entry', entryChoice });
    }
  }
  return commitChild(s, d);
}
for (const count of [2, 3, 4]) for (const scenario of ['industry', 'commercial', 'command']) {
  actor = scenario === 'command' ? 'p2' : 'p1'; scenarioName = scenario;
  const g = game.createPreEntryGame('compiled-pattern-actions', seats.slice(0, count)), d = g.definition;
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let s = game.beginEntry(g.state, d, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(p => p.id), expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    s = game.applyEntryCommand(s, d, { authenticatedPlayerId: seats[i].id }, { ...env(s), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    s = game.applyEntryCommand(s, d, { authenticatedPlayerId: seats[i].id }, { ...env(s), type: 'choose-green-event', choiceId: `${s.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) s = game.applyEntryCommand(s, d, { authenticatedPlayerId: 'p2' }, { ...env(s), type: 'choose-entry-influence', slotId: null });
  const yellow = cardOf('FAC-012', 'yellow'), red = cardOf('FAC-010', 'red');
  const builds = scenario === 'commercial' ? [[cardOf('FAC-006', 'blue'), 'CP-3-1'], [red, 'CP-3-3']]
    : scenario === 'industry' ? [[cardOf('FAC-006', 'blue'), 'CP-1-1'], [cardOf('FAC-001', 'red'), 'CP-2-1'], [cardOf('FAC-006', 'blue', 1), 'CP-2-2'], [yellow, 'CP-3-1'], [red, 'CP-3-3']]
    : [[yellow, 'CP-1-1'], [cardOf('FAC-001', 'red'), 'CP-2-1'], [cardOf('FAC-011', 'yellow'), 'CP-2-2'], [cardOf('FAC-006', 'blue'), 'CP-3-1'], [red, 'CP-3-3']];
  const protectedIds = builds.map(row => row[0]), patternId = { industry: 'PAT-003', commercial: 'PAT-008', command: 'PAT-010' }[scenario];
  s = game.beginRoundFlow(s, d, { expectedVersion: s.stateVersion, facilityDeckOrder: [...protectedIds, ...ordinary.filter(id => !protectedIds.includes(id))], deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [game.enableBaseRoleEffects, game.enableLiskarmEffects, game.enableRemainingBaseRoleEffects, game.enableWarehouseEntries, game.enableNestedFacilityEntries]) s = upgrade(s, d, { expectedVersion: s.stateVersion });
  s = game.enableCityPatterns(s, d, { expectedVersion: s.stateVersion, gameplayVersion: 'base', patternOrder: [patternId, ...core.getEligibleCityPatterns('base', count).map(p => p.id).filter(id => id !== patternId)] });
  s = game.enableCityPatternContinuations(s, d, { expectedVersion: s.stateVersion });
  s = game.enableCityPatternMajorActions(s, d, { expectedVersion: s.stateVersion });
  // Earn every voucher through actual entry, sales and four role uses; never inject history.
  s = prepare(s, d, protectedIds, 'ROLE-03');
  const texas = state => game.applyBaseRoleCommand(state, d, { authenticatedPlayerId: actor }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: state.facilities.supply.supply.find(id => !protectedIds.includes(id)) } });
  const initialCash = s.players[actor].balances['columbia-voucher'];
  s = texas(s); s = finish(s, d); s = prepare(s, d, protectedIds, 'ROLE-04');
  const assets = s.players[actor].balances, saleIncome = assets.orirock * 3 + assets.originium * 3 + assets.iron * 4 + assets['pure-originium'] * 15;
  s = game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-04', mode: 'strategy', strategyChoice: { kind: 'sell-resources', amounts: { orirock: s.players[actor].balances.orirock, originium: s.players[actor].balances.originium, iron: s.players[actor].balances.iron, 'pure-originium': s.players[actor].balances['pure-originium'] } } });
  s = finish(s, d); s = prepare(s, d, protectedIds, 'ROLE-05');
  s = game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-05', mode: 'scheme', schemeChoice: { kind: 'recover-roles', rewards: s.roundFlow.rolesByPlayer.find(row => row.playerId === actor).discarded.map(roleId => ({ roleId, kind: 'vouchers' })) } });
  s = finish(s, d); s = prepare(s, d, protectedIds, 'ROLE-03'); s = texas(s); assert.equal(s.players[actor].balances['columbia-voucher'], initialCash + 24 + saleIncome + 10);
  for (const [cardId, cellId] of builds) { s = nextP1(s, d, protectedIds); s = resume(build(s, d, cardId, cellId), d); }
  const coreId = s.facilities.panels.find(panel => panel.playerId === actor).placements.find(row => row.cellId === 'CP-3-2').cardId;
  const facilityCardIds = [coreId, ...protectedIds], score = s.players[actor].score;
  s = pattern(s, d, { type: 'declare-city-pattern', patternId, facilityCardIds });
  assert.equal(s.players[actor].score, score + core.getCityPattern(patternId).printedScore);
  s = nextP1(s, d, protectedIds);
  if (scenario === 'command' && s.playerOrder[0] === actor) { s = finish(s, d); s = prepare(s, d, protectedIds); }
  if (scenario === 'command') assert.notEqual(s.playerOrder[0], actor);
  const markerId = s.patternMarkers.find(m => m.ownerPlayerId === actor && m.patternId === patternId).markerId;
  const effect = scenario === 'industry' ? { kind: 'industry-actions' } : scenario === 'commercial' ? { kind: 'commercial-action', reward: 'columbia-voucher' } : { kind: 'command-action' };
  const cash = s.players[actor].balances['columbia-voucher'];
  s = pattern(s, d, { type: 'use-pattern-special', patternId, markerId, effect });
  assert.equal(s.players[actor].balances['columbia-voucher'], cash + (scenario === 'industry' ? -6 : scenario === 'commercial' ? 4 : 0));
  assert.throws(() => round(s, d, { type: 'finish-player-turn' }));
  if (scenario === 'industry') {
    s = childDeploy(s, d);
    assert.equal(s.cityPatternMajorActions[0].remainingActions, 1);
    assert.throws(() => game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'originium' } }));
    s = childDispatch(s, d);
  } else if (scenario === 'commercial') s = childExplore(s, d);
  else {
    const p = s.players[actor], roleCash = p.balances['columbia-voucher'], score = p.score, income = p.balances.originium * 3 + p.balances.iron * 2;
    s = game.applyBaseRoleCommand(resume(s, d), d, { authenticatedPlayerId: actor }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-04', mode: 'both', strategyChoice: { kind: 'sell-resources', amounts: { orirock: 0, originium: p.balances.originium, iron: 0, 'pure-originium': 0 } }, schemeChoice: { kind: 'forced-sale', asset: 'iron' } });
    assert.equal(s.players[actor].balances['columbia-voucher'], roleCash + income); assert.equal(s.players[actor].score, score + 1);
    assert.equal(s.roundFlow.rolesByPlayer.find(r => r.playerId === actor).used.mode, 'both');
    assert.equal(game.getRoundTurn(s, d).majorActionStatus, 'not-started'); s = childConstruction(s, d);
  }
  assert.deepEqual(s.cityPatternMajorActions, []); assert.equal(game.getRoundTurn(s, d).majorActionStatus, 'complete');
  assert.throws(() => round(s, d, { type: 'choose-major-action', action: 'deploy' }));
  const exhausted = s.cityPatterns.exhaustedFacilityIdsByPlayer[actor], usedRound = s.roundFlow.roundNumber;
  s = finish(s, d); assert.equal(s.roundFlow.roundNumber, usedRound + 1); assert.equal(s.schemaVersion, '1.15.0');
  assert.deepEqual(s.cityPatterns.exhaustedFacilityIdsByPlayer[actor], exhausted); assert.equal(s.cityPatterns.usedSpecialActions.length, 0);
  assert.equal(s.cityPatterns.useTracks.find(t => t.playerId === actor && t.patternId === patternId).remainingUses, 1);
  assert.equal(Object.keys(game.getMarkerLedger(s, d)).length, count * 30); assert.deepEqual(resume(s, d), s);
  console.log(JSON.stringify({ players: count, scenario, actor, realBuilds: builds.length, nextRound: s.roundFlow.roundNumber, noInjectedState: true }));
}
console.log('PASS: 9 compiled real 2/3/4-player industrial/commercial/command workflows, full child actions, non-starting both-role modes, quotas, cleanup and persistence');
