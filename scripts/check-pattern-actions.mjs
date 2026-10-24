import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';
for (const name of ['enableCityPatterns', 'applyCityPatternCommand', 'getCityPatternDeclarationOptions', 'getCityPatternSpecialOptions']) assert.equal(core[name], game[name]);
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const cardOf = (id, color, number = 0) => core.FOUNDERS_FACILITY_STOCK.cards.filter(card => card.facilityId === id && card.color === color)[number].id;
const env = s => ({ gameId: s.gameId, expectedVersion: s.stateVersion });
const round = (s, d, payload) => game.applyRoundCommand(s, d, { authenticatedPlayerId: game.getRoundTurn(s, d).actorId }, { ...env(s), ...payload });
const resume = (s, d) => game.parseGameState(JSON.parse(JSON.stringify(s)), d);
function pattern(s, d, payload) {
  const before = JSON.stringify(s), command = { ...env(s), ...payload };
  const next = game.applyCityPatternCommand(resume(s, d), d, { authenticatedPlayerId: 'p1' }, command);
  assert.equal(next.stateVersion, s.stateVersion + 1); assert.equal(JSON.stringify(s), before);
  assert.throws(() => game.applyCityPatternCommand(next, d, { authenticatedPlayerId: 'p1' }, command));
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
  while (s.roundFlow.stage === 'role-placement') s = round(s, d, { type: 'place-round-role', roleId });
  while (game.getRoundTurn(s, d).actorId !== 'p1') s = dispatch(s, d);
  return s;
}
function nextP1(s, d, protectedIds) {
  for (;;) {
    if (s.roundFlow.stage === 'harvest') { s = finish(s, d); continue; }
    if (['role-removal', 'role-placement'].includes(s.roundFlow.stage)) { s = prepare(s, d, protectedIds); continue; }
    const turn = game.getRoundTurn(s, d);
    if (turn.actorId === 'p1' && turn.majorActionStatus === 'not-started') return s;
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
  return game.applyConstructionCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId, cellId, paymentMode: 'vouchers', ...(entryChoice ? { entryChoice } : {}) });
}
for (const count of [2, 3, 4]) for (const scenario of ['mobilization', 'military', 'security', 'outpost']) {
  const g = game.createPreEntryGame('compiled-pattern-actions', seats.slice(0, count)), d = g.definition;
  const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let s = game.beginEntry(g.state, d, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(p => p.id), expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    s = game.applyEntryCommand(s, d, { authenticatedPlayerId: seats[i].id }, { ...env(s), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    s = game.applyEntryCommand(s, d, { authenticatedPlayerId: seats[i].id }, { ...env(s), type: 'choose-green-event', choiceId: `${s.entry.pendingEvent.cardId}:1` });
  }
  if (count === 2) s = game.applyEntryCommand(s, d, { authenticatedPlayerId: 'p2' }, { ...env(s), type: 'choose-entry-influence', slotId: null });
  const yellow = cardOf('FAC-012', 'yellow'), red = cardOf('FAC-010', 'red');
  const builds = scenario === 'military' ? [[red, 'CP-3-3']] : scenario === 'outpost' ? [[yellow, 'CP-2-3']] : scenario === 'mobilization' ? [[yellow, 'CP-3-1'], [red, 'CP-3-3']]
    : [[cardOf('FAC-006', 'blue'), 'CP-1-1'], [cardOf('FAC-001', 'red'), 'CP-2-1'], [cardOf('FAC-006', 'blue', 1), 'CP-2-2'], [yellow, 'CP-3-1'], [cardOf('FAC-003', 'red'), 'CP-3-3']];
  const protectedIds = builds.map(row => row[0]), patternId = { mobilization: 'PAT-001', military: 'PAT-005', security: 'PAT-009', outpost: 'PAT-011' }[scenario];
  s = game.beginRoundFlow(s, d, { expectedVersion: s.stateVersion, facilityDeckOrder: [...protectedIds, ...ordinary.filter(id => !protectedIds.includes(id))], deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [game.enableBaseRoleEffects, game.enableLiskarmEffects, game.enableRemainingBaseRoleEffects, game.enableWarehouseEntries, game.enableNestedFacilityEntries]) s = upgrade(s, d, { expectedVersion: s.stateVersion });
  s = game.enableCityPatterns(s, d, { expectedVersion: s.stateVersion, gameplayVersion: 'base', patternOrder: [patternId, ...core.getEligibleCityPatterns('base', count).map(p => p.id).filter(id => id !== patternId)] });
  // Earn 53 vouchers from actual entry and four role uses; never inject economic or facility history.
  s = prepare(s, d, protectedIds, 'ROLE-03');
  const texas = state => game.applyBaseRoleCommand(state, d, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: state.facilities.supply.supply.find(id => !protectedIds.includes(id)) } });
  s = texas(s); s = finish(s, d); s = prepare(s, d, protectedIds, 'ROLE-04');
  s = game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-04', mode: 'strategy', strategyChoice: { kind: 'sell-resources', amounts: { orirock: s.players.p1.balances.orirock, originium: s.players.p1.balances.originium, iron: s.players.p1.balances.iron, 'pure-originium': s.players.p1.balances['pure-originium'] } } });
  s = finish(s, d); s = prepare(s, d, protectedIds, 'ROLE-05');
  s = game.applyBaseRoleCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-05', mode: 'scheme', schemeChoice: { kind: 'recover-roles', rewards: s.roundFlow.rolesByPlayer.find(row => row.playerId === 'p1').discarded.map(roleId => ({ roleId, kind: 'vouchers' })) } });
  s = finish(s, d); s = prepare(s, d, protectedIds, 'ROLE-03'); s = texas(s); assert.equal(s.players.p1.balances['columbia-voucher'], 53);
  for (const [cardId, cellId] of builds) { s = nextP1(s, d, protectedIds); s = resume(build(s, d, cardId, cellId), d); }
  const coreId = s.facilities.panels.find(panel => panel.playerId === 'p1').placements.find(row => row.cellId === 'CP-3-2').cardId;
  const facilityCardIds = [coreId, ...protectedIds], score = s.players.p1.score;
  s = pattern(s, d, { type: 'declare-city-pattern', patternId, facilityCardIds });
  assert.equal(s.players.p1.score, score + core.getCityPattern(patternId).printedScore);
  assert.equal(game.getRoundTurn(s, d).majorActionStatus, 'complete'); // preceding build was not an extra major grant.
  s = nextP1(s, d, protectedIds); const options = game.getCityPatternSpecialOptions(s, d, 'p1').find(row => row.patternId === patternId);
  assert(options); let effect;
  if (scenario === 'mobilization') effect = { kind: 'replace', ...(options.occupiedSlotIds[0] ? { slotId: options.occupiedSlotIds[0] } : {}) };
  if (scenario === 'military') effect = { kind: 'military', slotIds: options.placementSlotIds.slice(0, 1) };
  if (scenario === 'security') {
    const slot = options.placementSlotIds[0]; effect = { kind: 'security', choices: [{ kind: 'place', slotId: slot }, { kind: 'remove', slotId: slot }] };
  }
  if (scenario === 'outpost') effect = { kind: 'outpost', slotIds: options.cityPlacementSlotIds.slice(0, 2), moves: [{ sourceSlotId: options.cityPlacementSlotIds[0], targetSlotId: options.placementSlotIds.find(id => id.startsWith('route:')) }] };
  const markerId = options.markerIds[0], charges = options.remainingUses;
  s = pattern(s, d, { type: 'use-pattern-special', patternId, markerId, effect });
  assert.equal(game.getRoundTurn(s, d).majorActionStatus, 'complete');
  assert.equal(s.cityPatterns.useTracks.find(row => row.playerId === 'p1' && row.patternId === patternId).remainingUses, charges - 1);
  assert.throws(() => round(s, d, { type: 'choose-major-action', action: 'deploy' }));
  const exhausted = s.cityPatterns.exhaustedFacilityIdsByPlayer.p1, usedRound = s.roundFlow.roundNumber;
  s = finish(s, d); assert.equal(s.roundFlow.roundNumber, usedRound + 1); assert.equal(s.schemaVersion, '1.13.0');
  assert.deepEqual(s.cityPatterns.exhaustedFacilityIdsByPlayer.p1, exhausted); assert.equal(s.cityPatterns.usedSpecialActions.length, 0);
  assert.equal(s.cityPatterns.useTracks.find(row => row.playerId === 'p1' && row.patternId === patternId).remainingUses, 1);
  assert.equal(Object.keys(game.getMarkerLedger(s, d)).length, count * 30); assert.deepEqual(resume(s, d), s);
  console.log(JSON.stringify({ players: count, scenario, realBuilds: builds.length, nextRound: s.roundFlow.roundNumber, vouchers: s.players.p1.balances['columbia-voucher'], noInjectedState: true }));
}
console.log('PASS: 12 compiled real 2/3/4-player pattern declaration/special/cleanup/save workflows; charges, major quota, ownership and physical conservation');
