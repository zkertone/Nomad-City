import { describe, expect, it } from 'vitest';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { FOUNDERS_FACILITY_STOCK, getFoundersFacilityFace } from '../facilities/index.js';
import { getCityPattern, getEligibleCityPatterns, selectCityPatterns } from '../patterns/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects,
  enableWarehouseEntries, enableNestedFacilityEntries, enableCityPatterns, applyCityPatternCommand, getCityPatternSpecialOptions, getCityPatternActionSupport, gameStateSchema, parseGameState, validateGameState,
  getMarkerLedger, applyRoundCommand, getRoundTurn, applyBaseRoleCommand, applyInfluenceCommand,
  openHarvestPhase, applyHarvestCommand, finishManagedRound, applyConstructionCommand, getDeploymentSlotIds,
  applyExplorationCommand, getExplorationFinalSlotIds, applyNestedFacilityEntryCommand, enableCityPatternContinuations, enableCityPatternMajorActions, applyCityMoveCommand, getCityMoveFinalSlotIds,
  applyCityPatternContinuationCommand, getCityPatternContinuationOptions,
} from './index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = (s: GameState) => ({ gameId: s.gameId, expectedVersion: s.stateVersion });
const round = (s: GameState, d: GameDefinition, p: Record<string, unknown>) => applyRoundCommand(s, d, { authenticatedPlayerId: getRoundTurn(s, d).actorId! }, { ...env(s), ...p });
const send = (s: GameState, d: GameDefinition, p: Record<string, unknown>, actor = 'p1') => applyCityPatternCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), ...p });
const saved = (s: GameState, d: GameDefinition) => parseGameState(JSON.parse(JSON.stringify(s)), d);
type Mutable = ReturnType<typeof gameStateSchema.parse>;
function setup(patternId = 'PAT-001', count = 3) {
  const g = createPreEntryGame('pattern-actions', seats.slice(0, count)), ids = (color: 'green' | 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let s = beginEntry(g.state, g.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(p => p.id), expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    s = applyEntryCommand(s, g.definition, { authenticatedPlayerId: seats[i]!.id }, { ...env(s), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    s = applyEntryCommand(s, g.definition, { authenticatedPlayerId: seats[i]!.id }, { ...env(s), type: 'choose-green-event', choiceId: `${s.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) s = applyEntryCommand(s, g.definition, { authenticatedPlayerId: 'p2' }, { ...env(s), type: 'choose-entry-influence', slotId: null });
  s = beginRoundFlow(s, g.definition, { expectedVersion: s.stateVersion, facilityDeckOrder: ordinary, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects, enableWarehouseEntries, enableNestedFacilityEntries]) s = upgrade(s, g.definition, { expectedVersion: s.stateVersion });
  const legacy = s, order = [patternId, ...getEligibleCityPatterns('base', count).map(p => p.id).filter(id => id !== patternId)];
  s = enableCityPatterns(s, g.definition, { expectedVersion: s.stateVersion, gameplayVersion: 'base', patternOrder: order });
  s = enableCityPatternContinuations(s, g.definition, { expectedVersion: s.stateVersion });
  s = enableCityPatternMajorActions(s, g.definition, { expectedVersion: s.stateVersion });
  const initialized = s;
  while (s.roundFlow!.stage === 'role-removal') s = round(s, g.definition, { type: 'remove-round-supply-card', cardId: s.facilities!.supply.supply.at(-1) });
  while (s.roundFlow!.stage === 'role-placement') s = round(s, g.definition, { type: 'place-round-role', roleId: 'ROLE-02' });
  return { state: s, definition: g.definition, legacy, initialized };
}
function addCard(s: Mutable, color: string, cellId: string, actor = 'p1') {
  const panel = s.facilities!.panels.find(p => p.playerId === actor)!;
  const core = panel.placements.find(p => p.cellId === cellId); if (core) return core.cardId;
  const card = FOUNDERS_FACILITY_STOCK.cards.find(c => c.group === 'ordinary' && c.color === color && !getFoundersFacilityFace(c.facilityId).effect.uniqueMarker && !s.facilities!.supply.playerHoldings.some(h => h.cardIds.includes(c.id)))!;
  for (const zone of [s.facilities!.supply.supply, s.facilities!.supply.drawPile, s.facilities!.supply.returnedToBox]) { const i = zone.indexOf(card.id); if (i >= 0) zone.splice(i, 1); }
  while (s.facilities!.supply.supply.length < 6) s.facilities!.supply.supply.push(s.facilities!.supply.drawPile.shift()!);
  s.facilities!.supply.playerHoldings.find(h => h.playerId === actor)!.cardIds.push(card.id); panel.placements.push({ cardId: card.id, cellId }); return card.id;
}
// Explicit board/ownership fixture only; transaction expectations do not claim these facilities were legally built.
function layout(s: GameState, patternId: string, top = 0, left = 0, actor = 'p1') {
  const raw = gameStateSchema.parse(s), cards = getCityPattern(patternId).cells.map(c => addCard(raw, c.colors[0]!, `CP-${c.row + top + 1}-${c.column + left + 1}`, actor));
  return { raw, cards };
}
const code = (fn: () => unknown, expected: string) => { try { fn(); throw Error('Expected rejection'); } catch (error) { expect((error as { code: string }).code).toBe(expected); } };
function dispatch(s: GameState, d: GameDefinition) {
  s = round(s, d, { type: 'choose-major-action', action: 'dispatch' });
  if (s.influenceAction!.status === 'ready') s = applyInfluenceCommand(s, d, { authenticatedPlayerId: getRoundTurn(s, d).actorId! }, { ...env(s), type: 'finish-dispatch' });
  return round(s, d, { type: 'finish-player-turn' });
}
function finish(s: GameState, d: GameDefinition) {
  if (getRoundTurn(s, d).majorActionStatus === 'complete') s = round(s, d, { type: 'finish-player-turn' });
  while (s.roundFlow!.stage === 'player-actions') s = dispatch(s, d);
  s = openHarvestPhase(s, d, { expectedVersion: s.stateVersion, roundNumber: s.roundFlow!.roundNumber });
  for (const player of d.players) s = applyHarvestCommand(s, d, { authenticatedPlayerId: player.id }, { ...env(s), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return finishManagedRound(s, d, { expectedVersion: s.stateVersion });
}
const markerFor = (s: GameState, id: string) => s.patternMarkers!.find(m => m.ownerPlayerId === 'p1' && m.patternId === id)!.markerId;

function fund(s: GameState, actor = 'p1') {
  const raw = gameStateSchema.parse(s); raw.players[actor]!.balances = { orirock: 30, originium: 30, iron: 30, 'pure-originium': 30, 'columbia-voucher': 200 }; return raw;
}
function publicPatterns(s: GameState, ids: readonly string[], count: number) {
  const raw = gameStateSchema.parse(s), eligible = getEligibleCityPatterns('base', count).map(p => p.id);
  raw.cityPatterns!.publicPatternIds = [...selectCityPatterns('base', count, [...ids, ...eligible.filter(id => !ids.includes(id))])]; return raw;
}
function announce(s: GameState, d: GameDefinition, id: string, actor = 'p1') {
  const f = layout(s, id, 0, 0, actor); return send(f.raw, d, { type: 'declare-city-pattern', patternId: id, facilityCardIds: f.cards }, actor);
}
const effectFor = (id: string) => id === 'PAT-003' ? { kind: 'industry-actions' } : id === 'PAT-008' ? { kind: 'commercial-action', reward: 'columbia-voucher' } : { kind: 'command-action' };
function activate(s: GameState, d: GameDefinition, id: string, actor = 'p1', effect: Record<string, unknown> = effectFor(id)) {
  const markerId = s.patternMarkers!.find(m => m.patternId === id && m.ownerPlayerId === actor)!.markerId;
  return send(s, d, { type: 'use-pattern-special', patternId: id, markerId, effect }, actor);
}
function fixture(id = 'PAT-003', count = 3) {
  const f = setup(id, count), declared = announce(fund(f.state), f.definition, id), state = activate(declared, f.definition, id);
  return { ...f, declared, state };
}
function completeDispatch(s: GameState, d: GameDefinition) {
  s = round(s, d, { type: 'choose-major-action', action: 'dispatch' });
  if (s.influenceAction!.status === 'ready') s = applyInfluenceCommand(s, d, { authenticatedPlayerId: getRoundTurn(s, d).actorId! }, { ...env(s), type: 'finish-dispatch' });
  return s;
}
const finishChild = (s: GameState, d: GameDefinition) => round(saved(s, d), d, { type: 'finish-pattern-action' });
const ordinaryKind = (s: GameState, d: GameDefinition, kind: string) => round(s, d, { type: 'choose-major-action', action: kind });
function both(s: GameState, d: GameDefinition, actor = 'p1') {
  const min = (['orirock', 'originium', 'iron'] as const).reduce((a, b) => s.players[actor]!.balances[a] <= s.players[actor]!.balances[b] ? a : b);
  return applyBaseRoleCommand(s, d, { authenticatedPlayerId: actor }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-02', mode: 'both', strategyChoice: { kind: 'minimum-resource', asset: min }, schemeChoice: { kind: 'elysium-city-move', costDecision: 'decline' } });
}

describe('three complete major-action patterns in snapshot 1.15', () => {
  it.each([2, 3, 4])('upgrades %i-player existing state without replaying or resetting facts', count => {
    const f = setup('PAT-003', count); expect(f.state.schemaVersion).toBe('1.15.0'); expect(f.state.cityPatternMajorActions).toEqual([]);
    const old = { ...f.state, schemaVersion: '1.14.0' as const }; delete (old as { cityPatternMajorActions?: unknown }).cityPatternMajorActions;
    const s = enableCityPatternMajorActions(old, f.definition, { expectedVersion: old.stateVersion });
    expect(s.players).toEqual(old.players); expect(s.cityPatterns).toEqual(old.cityPatterns); expect(s.facilities).toEqual(old.facilities); expect(s.roundFlow).toEqual(old.roundFlow);
    code(() => enableCityPatternMajorActions(s, f.definition, { expectedVersion: s.stateVersion }), 'PATTERN_FORMAT');
    code(() => enableCityPatternMajorActions(old, f.definition, { expectedVersion: 0 }), 'STALE_VERSION'); expect(saved(s, f.definition)).toEqual(s);
  });
  it('advertises all ten base specials only for the new format', () => {
    expect(getCityPatternActionSupport('1.15.0')).toMatchObject({ allBasePatternActionsImplemented: true, allPatternActionsImplemented: false });
    expect(getCityPatternActionSupport('1.15.0').specialActionPatternIds).toHaveLength(10);
    expect(getCityPatternActionSupport('1.14.0').specialActionPatternIds).toHaveLength(7); expect(getCityPatternActionSupport().specialActionPatternIds).toHaveLength(4);
  });
  it.each([2, 3, 4])('industry pays six once, completes exactly two actual actions, preserves state and lifetime uses for %i players', count => {
    const f = fixture('PAT-003', count), d = f.definition; let s = f.state;
    expect(s.players.p1!.balances['columbia-voucher']).toBe(f.declared.players.p1!.balances['columbia-voucher'] - 6);
    expect(getRoundTurn(s, d).majorActionStatus).toBe('not-started');
    code(() => round(s, d, { type: 'finish-player-turn' }), 'PATTERN_ACTION_PENDING');
    code(() => finishChild(s, d), 'PATTERN_ACTION_PENDING');
    s = finishChild(completeDispatch(s, d), d); expect(s.cityPatternMajorActions![0]!.remainingActions).toBe(1); expect(getRoundTurn(s, d).majorActionStatus).toBe('not-started');
    s = finishChild(completeDispatch(s, d), d); expect(s.cityPatternMajorActions).toEqual([]); expect(getRoundTurn(s, d).majorActionStatus).toBe('complete');
    code(() => ordinaryKind(s, d, 'deploy'), 'MAJOR_ACTION_USED'); expect(s.cityPatterns!.useTracks.find(t => t.patternId === 'PAT-003')!.remainingUses).toBe(1);
    s = finish(s, d); expect(s.schemaVersion).toBe('1.15.0'); expect(s.cityPatterns!.useTracks.find(t => t.patternId === 'PAT-003')!.remainingUses).toBe(1); expect(Object.keys(getMarkerLedger(s, d))).toHaveLength(count * 30);
  });
  it.each(['columbia-voucher', 'orirock', 'originium', 'iron'])('commercial grants only the chosen %s before its single ordinary action', reward => {
    const f = setup('PAT-008'), d = f.definition, declared = announce(fund(f.state), d, 'PAT-008');
    let s = activate(declared, d, 'PAT-008', 'p1', { kind: 'commercial-action', reward });
    for (const asset of ['columbia-voucher', 'orirock', 'originium', 'iron'] as const) expect(s.players.p1!.balances[asset]).toBe(declared.players.p1!.balances[asset] + (asset === reward ? reward === 'columbia-voucher' ? 4 : 1 : 0));
    s = finishChild(completeDispatch(s, d), d); expect(getRoundTurn(s, d).majorActionStatus).toBe('complete');
  });
  it.each(['PAT-008', 'PAT-010'])('%s forbids any special child without consuming another marker, reward, charge or slot', id => {
    const f = fixture(id), raw = publicPatterns(f.state, [id, 'PAT-001'], 3);
    raw.patternMarkers!.push({ markerId: raw.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p1', patternId: 'PAT-001' }); raw.cityPatterns!.useTracks.push({ playerId: 'p1', patternId: 'PAT-001', remainingUses: 1 });
    const before = JSON.stringify(raw); expect(getCityPatternSpecialOptions(raw, f.definition, 'p1')).toEqual([]);
    code(() => activate(raw, f.definition, 'PAT-001', 'p1', { kind: 'replace' }), 'PATTERN_SPECIAL_FORBIDDEN'); expect(JSON.stringify(raw)).toBe(before);
  });
  it.each([2, 3, 4])('command grants a non-starting player both role modes and exactly one ordinary action for %i players', count => {
    const f = setup('PAT-010', count), d = f.definition; let s = dispatch(f.state, d);
    expect(getRoundTurn(s, d).actorId).toBe('p2'); expect(s.playerOrder![0]).toBe('p1');
    code(() => both(s, d, 'p2'), 'STARTING_PLAYER_ONLY');
    s = announce(fund(s, 'p2'), d, 'PAT-010', 'p2'); s = activate(s, d, 'PAT-010', 'p2');
    const before = s.players.p2!.balances.orirock; s = both(s, d, 'p2'); expect(s.players.p2!.balances.orirock).toBe(before + 4);
    expect(s.roundFlow!.rolesByPlayer.find(r => r.playerId === 'p2')!.used).toMatchObject({ mode: 'both' });
    s = finishChild(completeDispatch(s, d), d); expect(getRoundTurn(s, d).majorActionStatus).toBe('complete'); expect(saved(s, d)).toEqual(s);
    code(() => both(s, d, 'p2'), 'ROLE_ALREADY_USED');
  });
  it.each(['PAT-003', 'PAT-008', 'PAT-010'])('%s cannot skip a pending ordinary child, start a second child or cancel the outer special', id => {
    const f = fixture(id), d = f.definition; let s = f.state;
    code(() => round(s, d, { type: 'cancel-major-preparation' }), 'ACTION_STARTED');
    s = ordinaryKind(s, d, 'explore'); expect(getRoundTurn(s, d).majorActionStatus).toBe('pending');
    code(() => finishChild(s, d), 'PATTERN_ACTION_PENDING'); code(() => ordinaryKind(s, d, 'dispatch'), 'MAJOR_ACTION_USED');
    const before = JSON.stringify(s); s = round(s, d, { type: 'cancel-major-preparation' });
    expect(s.cityPatternMajorActions![0]!.activeAction).toBeNull(); expect(s.roundFlow!.majorActionOpened).toBe(true); expect(getRoundTurn(s, d).majorActionStatus).toBe('not-started');
    expect(s.players).toEqual(JSON.parse(before).players); expect(s.cityPatterns).toEqual(JSON.parse(before).cityPatterns);
  });
  it.each(['deploy', 'dispatch', 'explore', 'city-move', 'construct'])('uses and completes a real %s child through its existing reducer', kind => {
    const f = fixture('PAT-008'), d = f.definition; let s = ordinaryKind(f.state, d, kind);
    if (kind === 'deploy') s = applyInfluenceCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'deploy-influence', slotId: getDeploymentSlotIds(s, d, 'p1')[0] });
    if (kind === 'dispatch' && s.influenceAction!.status === 'ready') s = applyInfluenceCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'finish-dispatch' });
    if (kind === 'explore') {
      s = applyExplorationCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
      s = applyExplorationCommand(saved(s, d), d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'choose-exploration-event', choice: { choiceId: 'Y01:1' } });
      s = applyExplorationCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(s, d, 'p1')[0] });
    }
    if (kind === 'city-move') {
      s = applyCityMoveCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' });
      s = applyCityMoveCommand(saved(s, d), d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'choose-city-move-event', choice: { choiceId: 'Y01:1' } });
      s = applyCityMoveCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'place-city-move-influence', slotId: getCityMoveFinalSlotIds(s, d, 'p1')[0] });
    }
    if (kind === 'construct') {
      const cardId = s.facilities!.supply.supply.find(id => FOUNDERS_FACILITY_STOCK.cards.find(c => c.id === id)!.facilityId === 'FAC-001')!;
      s = applyConstructionCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId, cellId: 'CP-4-1', paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' } });
      const routes = Object.keys(s.board.influenceBySlot).filter(id => id.startsWith('route:') && s.board.influenceBySlot[id] === null);
      s = applyNestedFacilityEntryCommand(saved(s, d), d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-influence', placeSlotId: routes[0], move: { sourceSlotId: routes[0], targetSlotId: routes[1] } } });
    }
    expect(getRoundTurn(s, d).majorActionStatus).toBe('complete'); code(() => round(s, d, { type: 'finish-player-turn' }), 'PATTERN_ACTION_PENDING');
    s = finishChild(s, d); expect(s.cityPatternMajorActions).toEqual([]); expect(s.roundFlow!.completedMajorAction).toBe('special'); expect(saved(s, d)).toEqual(s);
  });
  it.each(['PAT-008', 'PAT-010'])('industry can nest %s and consumes that whole sequence as just one child', child => {
    const f = fixture('PAT-003'), d = f.definition, raw = publicPatterns(f.state, ['PAT-003', child], 3);
    raw.patternMarkers!.push({ markerId: raw.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p1', patternId: child }); raw.cityPatterns!.useTracks.push({ playerId: 'p1', patternId: child, remainingUses: child === 'PAT-008' ? 1 : 2 });
    let s = activate(raw, d, child); expect(s.cityPatternMajorActions).toHaveLength(2);
    code(() => both(s, d), 'ROLE_CONFLICT'); // The industrial ancestor's ban still applies.
    s = finishChild(completeDispatch(s, d), d); expect(s.cityPatternMajorActions).toHaveLength(1); expect(s.cityPatternMajorActions![0]!.remainingActions).toBe(1);
    s = finishChild(completeDispatch(s, d), d); expect(s.cityPatternMajorActions).toEqual([]); expect(s.cityPatterns!.usedSpecialActions).toHaveLength(2);
  });
  it('industry accepts an immediate special as one child without granting a third ordinary action', () => {
    const f = fixture('PAT-003'), d = f.definition, raw = publicPatterns(f.state, ['PAT-003', 'PAT-001'], 3);
    raw.patternMarkers!.push({ markerId: raw.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p1', patternId: 'PAT-001' }); raw.cityPatterns!.useTracks.push({ playerId: 'p1', patternId: 'PAT-001', remainingUses: 1 });
    let s = activate(raw, d, 'PAT-001', 'p1', { kind: 'replace' }); expect(s.cityPatternMajorActions![0]!.activePatternId).toBe('PAT-001');
    s = finishChild(s, d); expect(s.cityPatternMajorActions![0]!.remainingActions).toBe(1);
    s = finishChild(completeDispatch(s, d), d); code(() => ordinaryKind(s, d, 'deploy'), 'MAJOR_ACTION_USED');
  });
  it('commercial permits a quick role between its bonus and action without consuming the granted action', () => {
    const f = fixture('PAT-008'), d = f.definition; const s = both(f.state, d); expect(getRoundTurn(s, d).majorActionStatus).toBe('not-started');
    expect(finishChild(completeDispatch(s, d), d).cityPatternMajorActions).toEqual([]);
  });
  it('industrial role prohibition remains after both children have completed', () => {
    const f = fixture('PAT-003'), d = f.definition; let s = finishChild(completeDispatch(f.state, d), d); code(() => both(s, d), 'ROLE_CONFLICT');
    s = finishChild(completeDispatch(s, d), d); code(() => both(s, d), 'ROLE_CONFLICT');
  });
  it.each(['cost', 'overflow', 'wrong-reward', 'wrong-kind', 'stale', 'client-count'])('rejects %s atomically before rewarding or granting a slot', reason => {
    const id = reason === 'cost' ? 'PAT-003' : 'PAT-008', f = setup(id), d = f.definition, raw = fund(announce(f.state, d, id));
    const command: Record<string, unknown> = { ...env(raw), type: 'use-pattern-special', patternId: id, markerId: markerFor(raw, id), effect: effectFor(id) };
    let expected = 'COMMAND_SCHEMA';
    if (reason === 'cost') { raw.players.p1!.balances['columbia-voucher'] = 5; expected = 'CANNOT_PAY'; }
    if (reason === 'overflow') { raw.players.p1!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER; expected = 'BALANCE_OVERFLOW'; }
    if (reason === 'wrong-reward') command.effect = { kind: 'commercial-action', reward: 'pure-originium' };
    if (reason === 'wrong-kind') { command.effect = { kind: 'industry-actions' }; expected = 'PATTERN_CHOICE'; }
    if (reason === 'stale') { command.expectedVersion = 0; expected = 'STALE_VERSION'; }
    if (reason === 'client-count') command.actions = 99;
    const before = JSON.stringify(raw); code(() => applyCityPatternCommand(raw, d, { authenticatedPlayerId: 'p1' }, command), expected); expect(JSON.stringify(raw)).toBe(before);
  });
  it.each(['missing-field', 'old-format', 'wrong-turn', 'wrong-pattern', 'wrong-count', 'false-child', 'wrong-child', 'missing-use', 'unauthorized-special', 'fake-completion'])('rejects corrupted sequence %s without throwing internally', issue => {
    const f = fixture('PAT-008'), raw = gameStateSchema.parse(f.state);
    if (issue === 'missing-field') delete raw.cityPatternMajorActions;
    if (issue === 'old-format') raw.schemaVersion = '1.14.0';
    if (issue === 'wrong-turn') raw.roundFlow!.turnIndex = 1;
    if (issue === 'wrong-pattern') raw.cityPatternMajorActions![0]!.patternId = 'PAT-010';
    if (issue === 'wrong-count') raw.cityPatternMajorActions![0]!.remainingActions = 2;
    if (issue === 'false-child') raw.cityPatternMajorActions![0]!.activeAction = 'explore';
    if (issue === 'wrong-child') raw.cityPatternMajorActions![0]!.activePatternId = 'PAT-001';
    if (issue === 'missing-use') raw.cityPatterns!.usedSpecialActions = [];
    if (issue === 'unauthorized-special') { raw.cityPatternMajorActions![0]!.activeAction = 'special'; raw.cityPatternMajorActions![0]!.activePatternId = 'PAT-008'; }
    if (issue === 'fake-completion') raw.roundFlow!.completedMajorAction = 'special';
    expect(validateGameState(raw, f.definition).success).toBe(false);
  });
  it.each(['before-child', 'after-child'])('preserves the extra-action slot through a new-building declaration %s', when => {
    const f = fixture('PAT-008'), d = f.definition; let s: GameState = publicPatterns(f.state, ['PAT-008', 'PAT-013'], 3);
    if (when === 'after-child') s = completeDispatch(s, d);
    const p = layout(s, 'PAT-013', 1);
    s = send(p.raw, d, { type: 'declare-city-pattern', patternId: 'PAT-013', facilityCardIds: p.cards });
    expect(getRoundTurn(s, d).majorActionStatus).toBe('pending'); code(() => finishChild(s, d), 'PATTERN_ACTION_PENDING');
    const cardId = s.facilities!.supply.supply.find(id => FOUNDERS_FACILITY_STOCK.cards.find(c => c.id === id)!.facilityId === 'FAC-002')!;
    s = applyConstructionCommand(saved(s, d), d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId, cellId: 'CP-4-1', paymentMode: 'vouchers', entryChoice: { kind: 'remove-influence', slotIds: [] } });
    expect(s.cityPatternContinuation).toBeNull(); expect(s.cityPatternMajorActions).toHaveLength(1);
    expect(getRoundTurn(s, d).majorActionStatus).toBe(when === 'after-child' ? 'complete' : 'not-started');
    if (when === 'before-child') s = completeDispatch(s, d);
    expect(finishChild(s, d).cityPatternMajorActions).toEqual([]);
  });
  it('management can return the commercial marker between extra actions without revoking the already-granted action', () => {
    const f = fixture('PAT-008'), d = f.definition, raw = publicPatterns(f.state, ['PAT-008', 'PAT-014'], 3), p = layout(raw, 'PAT-014', 2);
    let s = send(p.raw, d, { type: 'declare-city-pattern', patternId: 'PAT-014', facilityCardIds: p.cards, returnMarkerId: markerFor(p.raw, 'PAT-008') });
    expect(s.patternMarkers!.some(m => m.patternId === 'PAT-008')).toBe(false); expect(s.cityPatternMajorActions).toHaveLength(1);
    s = finishChild(completeDispatch(s, d), d); expect(s.cityPatternMajorActions).toEqual([]); expect(saved(s, d)).toEqual(s);
  });
  it('command both-mode authority remains valid after its child completes, then does not carry into the next cycle', () => {
    const f = setup('PAT-010'), d = f.definition; let s = dispatch(f.state, d);
    s = activate(announce(fund(s, 'p2'), d, 'PAT-010', 'p2'), d, 'PAT-010', 'p2');
    s = finishChild(completeDispatch(s, d), d);
    const withBoth = both(s, d, 'p2'); expect(withBoth.roundFlow!.rolesByPlayer.find(r => r.playerId === 'p2')!.used!.mode).toBe('both'); expect(saved(withBoth, d)).toEqual(withBoth);
    s = round(s, d, { type: 'finish-player-turn' });
    while (getRoundTurn(s, d).actorId !== 'p2') s = dispatch(s, d);
    code(() => both(s, d, 'p2'), 'STARTING_PLAYER_ONLY');
  });
  it('commercial quick role after a completed child preserves that completion and consumes the child only once', () => {
    const f = fixture('PAT-008'), d = f.definition; let s = both(completeDispatch(f.state, d), d);
    expect(s.phase).toBe('round-control'); expect(s.roundFlow!.completedMajorAction).toBe('dispatch');
    s = finishChild(s, d); expect(s.roundFlow!.completedMajorAction).toBe('special'); code(() => finishChild(s, d), 'PATTERN_ACTION_PENDING');
  });
  it('industry requires a pending composite-power special to finish its actual route placement before consuming that child', () => {
    const f = fixture('PAT-003'), d = f.definition, raw = publicPatterns(f.state, ['PAT-003', 'PAT-004'], 3);
    raw.patternMarkers!.push({ markerId: raw.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p1', patternId: 'PAT-004' }); raw.cityPatterns!.useTracks.push({ playerId: 'p1', patternId: 'PAT-004', remainingUses: 1 });
    let s = activate(raw, d, 'PAT-004', 'p1', { kind: 'composite-move', orirock: 2, iron: 1 });
    s = applyCityMoveCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' });
    s = applyCityMoveCommand(saved(s, d), d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'choose-city-move-event', choice: { choiceId: 'Y01:1' } });
    s = applyCityMoveCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'place-city-move-influence', slotId: getCityMoveFinalSlotIds(s, d, 'p1')[0] });
    code(() => finishChild(s, d), 'PATTERN_ACTION_PENDING');
    const opts = getCityPatternContinuationOptions(s, d, 'p1'); if (opts.kind !== 'city-move') throw Error();
    s = applyCityPatternContinuationCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'place-pattern-route-influence', slotId: opts.routeSlotIds[0] });
    s = finishChild(s, d); expect(s.cityPatternMajorActions![0]!.remainingActions).toBe(1); expect(finishChild(completeDispatch(s, d), d).cityPatternMajorActions).toEqual([]);
  });
  it('industry can finish a deck-construction special as one child after its actual construction and final shuffle', () => {
    const f = fixture('PAT-003'), d = f.definition, raw = publicPatterns(f.state, ['PAT-003', 'PAT-012'], 3);
    raw.patternMarkers!.push({ markerId: raw.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p1', patternId: 'PAT-012' }); raw.cityPatterns!.useTracks.push({ playerId: 'p1', patternId: 'PAT-012', remainingUses: 1 });
    let s = activate(raw, d, 'PAT-012', 'p1', { kind: 'deck-construction' });
    code(() => finishChild(s, d), 'PATTERN_ACTION_PENDING');
    const cardId = s.facilities!.supply.drawPile.find(id => FOUNDERS_FACILITY_STOCK.cards.find(c => c.id === id)!.facilityId === 'FAC-012')!, six = s.facilities!.supply.supply;
    s = applyConstructionCommand(s, d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId, cellId: 'CP-4-1', paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' } });
    expect(s.cityPatternContinuation).toBeNull(); expect(s.facilities!.supply.supply).toEqual(six);
    s = finishChild(s, d); expect(s.cityPatternMajorActions![0]!.remainingActions).toBe(1); expect(finishChild(completeDispatch(s, d), d).cityPatternMajorActions).toEqual([]);
  });
  it('industry rejects activation after a role in the same turn without charging six vouchers', () => {
    const f = setup('PAT-003'), d = f.definition, s = both(announce(fund(f.state), d, 'PAT-003'), d), before = JSON.stringify(s);
    code(() => activate(s, d, 'PAT-003'), 'ROLE_CONFLICT'); expect(JSON.stringify(s)).toBe(before);
  });
  it.each(['wrong-player', 'stale', 'wrong-game'])('does not consume a completed child on %s finish requests', reason => {
    const f = fixture('PAT-008'), d = f.definition, s = completeDispatch(f.state, d), command = { ...env(s), type: 'finish-pattern-action' };
    if (reason === 'stale') command.expectedVersion = 0; if (reason === 'wrong-game') command.gameId = 'other';
    const before = JSON.stringify(s); code(() => applyRoundCommand(s, d, { authenticatedPlayerId: reason === 'wrong-player' ? 'p2' : 'p1' }, command), reason === 'wrong-player' ? 'WRONG_ACTOR' : reason === 'stale' ? 'STALE_VERSION' : 'GAME_REFERENCE'); expect(JSON.stringify(s)).toBe(before);
  });
  it('does not accept both-mode use saved for a non-starting player without its actual command-pattern use', () => {
    const f = setup('PAT-010'), d = f.definition; let s = dispatch(f.state, d);
    s = activate(announce(fund(s, 'p2'), d, 'PAT-010', 'p2'), d, 'PAT-010', 'p2'); s = both(finishChild(completeDispatch(s, d), d), d, 'p2');
    const raw = gameStateSchema.parse(s); raw.cityPatterns!.usedSpecialActions = []; expect(validateGameState(raw, d).success).toBe(false);
  });
  it('cannot forge a nested frame or drop a ready frame to obtain a fresh ordinary action', () => {
    const f = fixture('PAT-008'), d = f.definition, raw = gameStateSchema.parse(f.state);
    raw.cityPatternMajorActions!.push({ ...raw.cityPatternMajorActions![0]! }); expect(validateGameState(raw, d).success).toBe(false);
    raw.cityPatternMajorActions = []; expect(validateGameState(raw, d).success).toBe(false);
  });
});

