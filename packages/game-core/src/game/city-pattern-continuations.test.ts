import { describe, expect, it } from 'vitest';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { FOUNDERS_FACILITY_STOCK, getFoundersFacilityFace } from '../facilities/index.js';
import { getCityPattern, getEligibleCityPatterns } from '../patterns/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects,
  enableWarehouseEntries, enableNestedFacilityEntries, enableCityPatterns, applyCityPatternCommand,
  getCityPatternPublicView, getCityPatternActionSupport, gameStateSchema, parseGameState, validateGameState,
  getMarkerLedger, applyRoundCommand, getRoundTurn, applyBaseRoleCommand, applyInfluenceCommand,
  openHarvestPhase, applyHarvestCommand, finishManagedRound, applyConstructionCommand, getDeploymentSlotIds,
  applyNestedFacilityEntryCommand, enableCityPatternContinuations, getCityPatternContinuationOptions, applyCityMoveCommand, getCityMoveOptions, getCityMoveFinalSlotIds, applyCityPatternContinuationCommand,
  applyWarehouseEntryCommand, getWarehouseEntryFinalSlotIds,
} from './index.js';
import { getFacilityConstructionSpec } from '../facilities/construction-spec.js';
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
function declare(s: GameState, d: GameDefinition, id: string, top = 0) {
  const f = layout(s, id, top); return send(f.raw, d, { type: 'declare-city-pattern', patternId: id, facilityCardIds: f.cards,
    ...(id === 'PAT-014' ? { returnMarkerId: s.markerSupplyByPlayer.p1![0] } : {}) });
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
function secondTurn(s: GameState, d: GameDefinition) {
  s = round(s, d, { type: 'finish-player-turn' });
  while (getRoundTurn(s, d).actorId !== 'p1') s = dispatch(s, d);
  return s;
}
const markerFor = (s: GameState, id: string) => s.patternMarkers!.find(m => m.ownerPlayerId === 'p1' && m.patternId === id)!.markerId;

function funded(s: GameState) {
  const raw = gameStateSchema.parse(s);
  raw.players.p1!.balances = { orirock: 30, originium: 30, iron: 30, 'pure-originium': 30, 'columbia-voucher': 200 };
  return raw;
}
function activate(id: string, count = 3) {
  const f = setup(id, count), declared = declare(funded(f.state), f.definition, id);
  const effect = id === 'PAT-004' ? { kind: 'composite-move', orirock: 2, iron: 1 } : id === 'PAT-006' ? { kind: 'double-move' } : { kind: 'deck-construction' };
  const state = send(declared, f.definition, { type: 'use-pattern-special', patternId: id, markerId: markerFor(declared, id), effect });
  return { ...f, declared, state };
}
const move = (s: GameState, d: GameDefinition, command: Record<string, unknown>) => applyCityMoveCommand(saved(s, d), d, { authenticatedPlayerId: 'p1' }, { ...env(s), ...command });
function finishMove(s: GameState, d: GameDefinition, nodeId = 'D-01', routeId = 'R-route-01') {
  s = move(s, d, { type: 'move-city', nodeId, routeId });
  if (s.cityMove?.status === 'event-choice') {
    const card = FOUNDERS_EVENT_CATALOG.cards.find(c => c.id === s.cityMove!.cardId)!;
    const choice = card.choices[0]!;
    s = move(s, d, { type: 'choose-city-move-event', choice: { choiceId: choice.id, ...(choice.cost ? { costDecision: 'decline' } : {}) } });
  }
  if (s.cityMove?.status === 'final-influence') s = move(s, d, { type: 'place-city-move-influence', slotId: getCityMoveFinalSlotIds(s, d, 'p1')[0] });
  return s;
}
function forceAvailable(s: GameState, cardId: string, source: 'supply' | 'draw-pile') {
  const raw = gameStateSchema.parse(s), supply = raw.facilities!.supply;
  const zone = source === 'supply' ? supply.supply : supply.drawPile;
  if (!zone.includes(cardId)) {
    const other = source === 'supply' ? supply.drawPile : supply.supply, index = other.indexOf(cardId);
    if (index < 0) throw Error('Fixture target already owned');
    [zone[0], other[index]] = [cardId, zone[0]!];
  }
  return raw;
}
function buildPending(s: GameState, d: GameDefinition, cardId?: string, entryChoice: Record<string, unknown> = { kind: 'deferred-entry' }) {
  const options = getCityPatternContinuationOptions(s, d, 'p1');
  if (options.kind === 'city-move' || !options.constructionOptions) throw Error('Expected construction choice');
  const selected = cardId ?? options.constructionOptions.choices.find(c => ['none', 'gain', 'core-neighbor-vouchers', 'starting-player', 'sell-resources', 'warehouse'].includes(getFacilityConstructionSpec(c.cardId).entry.kind))!.cardId;
  if (!cardId && getFacilityConstructionSpec(selected).entry.kind === 'sell-resources') entryChoice = { kind: 'sell-resources', amounts: { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 } };
  if (!cardId && getFacilityConstructionSpec(selected).entry.kind === 'warehouse') {
    const slots = Object.keys(s.board.influenceBySlot).filter(id => id.startsWith('route:') && s.board.influenceBySlot[id] === null);
    entryChoice = { kind: 'warehouse-influence', placeSlotId: slots[0], move: { sourceSlotId: slots[0], targetSlotId: slots[1] } };
  }
  return applyConstructionCommand(saved(s, d), d, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId: selected, cellId: options.constructionOptions.cellIds[0], paymentMode: 'vouchers', entryChoice });
}

describe('four city pattern continuations in snapshot 1.14', () => {
  it.each([2, 3, 4])('upgrades %i-player games without changing declarations or existing ledgers', count => {
    const f = setup('PAT-001', count), old = declare(f.state, f.definition, 'PAT-001');
    expect(f.state.schemaVersion).toBe('1.14.0'); expect(f.state.cityPatternContinuation).toBeNull(); expect(saved(old, f.definition)).toEqual(old);
    const legacy = { ...old, schemaVersion: '1.13.0' as const }; delete (legacy as { cityPatternContinuation?: unknown }).cityPatternContinuation;
    const next = enableCityPatternContinuations(legacy, f.definition, { expectedVersion: legacy.stateVersion });
    expect(next.cityPatterns).toEqual(old.cityPatterns); expect(next.patternMarkers).toEqual(old.patternMarkers); expect(next.players).toEqual(old.players);
    code(() => enableCityPatternContinuations(next, f.definition, { expectedVersion: next.stateVersion }), 'PATTERN_FORMAT');
    code(() => enableCityPatternContinuations(legacy, f.definition, { expectedVersion: 0 }), 'STALE_VERSION');
  });
  it('reports 13 declarations and seven specials for the new format, preserving old-format capability limits', () => {
    expect(getCityPatternActionSupport('1.14.0').declarationPatternIds).toHaveLength(13);
    expect(getCityPatternActionSupport('1.14.0').specialActionPatternIds).toHaveLength(7);
    expect(getCityPatternActionSupport().specialActionPatternIds).toHaveLength(4);
  });
  it.each([2, 3, 4])('composite power pays exactly once, finishes event and target before its extra route placement for %i players', count => {
    const f = activate('PAT-004', count), ori = f.declared.players.p1!.balances.originium;
    expect(f.state.players.p1!.balances.originium).toBe(ori - 1); expect(getRoundTurn(f.state, f.definition).majorActionStatus).toBe('pending');
    expect(getCityMoveOptions(f.state, f.definition, 'p1').length).toBeGreaterThan(0);
    let s = finishMove(f.state, f.definition);
    expect(s.cityMove!.status).toBe('complete'); expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('pending');
    expect(s.players.p1!.balances.originium).toBe(ori - 1);
    code(() => round(s, f.definition, { type: 'finish-player-turn' }), 'ACTION_PENDING');
    const options = getCityPatternContinuationOptions(s, f.definition, 'p1'); if (options.kind !== 'city-move') throw Error();
    const markers = s.markerSupplyByPlayer.p1!.length;
    s = applyCityPatternContinuationCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'place-pattern-route-influence', slotId: options.routeSlotIds[0] });
    expect(s.markerSupplyByPlayer.p1).toHaveLength(markers - 1); expect(s.cityPatternContinuation).toBeNull(); expect(s.cityMove).toBeUndefined();
    expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('complete'); expect(Object.keys(getMarkerLedger(s, f.definition))).toHaveLength(count * 30);
    expect(saved(s, f.definition)).toEqual(s);
  });
  it.each([2, 3, 4])('efficient movement completes two free moves after one three-originium cost for %i players', count => {
    const f = activate('PAT-006', count), ori = f.declared.players.p1!.balances.originium;
    let s = finishMove(f.state, f.definition);
    expect(s.cityPatternContinuation).toMatchObject({ kind: 'city-move', remainingMoves: 1 }); expect(s.cityMove!.status).toBe('ready');
    expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('pending'); expect(s.players.p1!.balances.originium).toBe(ori - 3);
    s = finishMove(s, f.definition, 'A-01');
    expect(s.cityPatternContinuation).toBeNull(); expect(s.board.cityNodeByPlayer.p1).toBe('A-01'); expect(s.players.p1!.balances.originium).toBe(ori - 3);
    expect(s.cityPatterns!.useTracks.find(t => t.patternId === 'PAT-006')!.remainingUses).toBe(1); expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('complete');
    s = finish(s, f.definition); expect(s.schemaVersion).toBe('1.14.0'); expect(s.cityPatterns!.useTracks.find(t => t.patternId === 'PAT-006')!.remainingUses).toBe(1);
  });
  it.each(['PAT-004', 'PAT-006'])('pending %s cannot be canceled, interrupted, delegated or used as a second major action', id => {
    const f = activate(id), s = f.state;
    code(() => round(s, f.definition, { type: 'cancel-major-preparation' }), 'ACTION_STARTED');
    code(() => round(s, f.definition, { type: 'choose-major-action', action: 'deploy' }), 'MAJOR_ACTION_USED');
    code(() => send(s, f.definition, { type: 'declare-city-pattern', patternId: id, facilityCardIds: f.declared.cityPatterns!.exhaustedFacilityIdsByPlayer.p1 }), 'ACTION_PENDING');
    code(() => applyBaseRoleCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } }), 'ACTION_PENDING');
    code(() => applyCityMoveCommand(s, f.definition, { authenticatedPlayerId: 'p2' }, { ...env(s), type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' }), 'WRONG_ACTOR');
    expect(saved(s, f.definition)).toEqual(s);
  });
  it.each([{ orirock: 3, iron: 0 }, { orirock: 0, iron: 3 }, { orirock: 1, iron: 2 }])('accepts valid mixed composite costs %j', payment => {
    const f = setup('PAT-004'), s = declare(funded(f.state), f.definition, 'PAT-004');
    expect(send(s, f.definition, { type: 'use-pattern-special', patternId: 'PAT-004', markerId: markerFor(s, 'PAT-004'), effect: { kind: 'composite-move', ...payment } }).players.p1!.balances.iron).toBe(s.players.p1!.balances.iron - payment.iron);
  });
  it.each(['sum', 'orirock', 'iron', 'originium', 'double-cost', 'wrong-kind'])('rejects %s before spending a charge or any cost', reason => {
    const id = reason === 'double-cost' ? 'PAT-006' : 'PAT-004', f = setup(id), raw = funded(declare(f.state, f.definition, id));
    let effect: Record<string, unknown> = { kind: 'composite-move', orirock: 2, iron: 1 }, expected = 'CANNOT_PAY';
    if (reason === 'sum') { effect.iron = 0; expected = 'PATTERN_CHOICE'; }
    if (reason === 'orirock') raw.players.p1!.balances.orirock = 1;
    if (reason === 'iron') raw.players.p1!.balances.iron = 0;
    if (reason === 'originium') raw.players.p1!.balances.originium = 0;
    if (reason === 'double-cost') { raw.players.p1!.balances.originium = 2; effect = { kind: 'double-move' }; }
    if (reason === 'wrong-kind') { effect = { kind: 'double-move' }; expected = 'PATTERN_CHOICE'; }
    const before = JSON.stringify(raw); code(() => send(raw, f.definition, { type: 'use-pattern-special', patternId: id, markerId: markerFor(raw, id), effect }), expected); expect(JSON.stringify(raw)).toBe(before);
  });
  it('efficient-movement role restriction lasts through completion in this turn, but not a different cycle', () => {
    const f = activate('PAT-006'); let s = finishMove(f.state, f.definition); s = finishMove(s, f.definition, 'A-01');
    code(() => applyBaseRoleCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } }), 'ROLE_CONFLICT');
    s = secondTurn(s, f.definition); expect(applyBaseRoleCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'originium' } }).roundFlow!.rolesByPlayer[0]!.used).not.toBeNull();
  });
  it.each([2, 3, 4])('new-building declaration pays for a real supply construction without using a major action for %i players', count => {
    const f = setup('PAT-013', count), s = declare(funded(f.state), f.definition, 'PAT-013');
    expect(s.cityPatternContinuation).toEqual({ kind: 'declaration-build', patternId: 'PAT-013' }); expect(s.roundFlow!.majorActionOpened).toBe(false);
    expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('pending');
    const v = s.players.p1!.balances['columbia-voucher'], result = buildPending(s, f.definition);
    expect(result.players.p1!.balances['columbia-voucher']).toBeLessThan(v); expect(result.cityPatternContinuation).toBeNull();
    expect(getRoundTurn(result, f.definition).majorActionStatus).toBe('not-started'); expect(round(result, f.definition, { type: 'choose-major-action', action: 'deploy' }).phase).toBe('influence-action');
    expect(result.cityPatterns!.exhaustedFacilityIdsByPlayer.p1).toHaveLength(4); expect(saved(result, f.definition)).toEqual(result);
  });
  it('new-building declaration after a completed major action restores the consumed quota', () => {
    const f = setup('PAT-013'), p = layout(funded(f.state), 'PAT-013');
    let s = round(p.raw, f.definition, { type: 'choose-major-action', action: 'deploy' });
    s = applyInfluenceCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'deploy-influence', slotId: getDeploymentSlotIds(s, f.definition, 'p1')[0] });
    s = send(s, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-013', facilityCardIds: p.cards });
    expect(s.roundFlow!.completedMajorAction).toBe('deploy'); s = buildPending(s, f.definition);
    expect(s.roundFlow!.completedMajorAction).toBe('deploy'); expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('complete');
    code(() => round(s, f.definition, { type: 'choose-major-action', action: 'construct' }), 'MAJOR_ACTION_USED');
  });
  it('skips only genuinely unaffordable new-building construction, keeping its announcement and points', () => {
    const f = setup('PAT-013'), raw = gameStateSchema.parse(f.state); for (const k of Object.keys(raw.players.p1!.balances) as (keyof NonNullable<typeof raw.players.p1>['balances'])[]) raw.players.p1!.balances[k] = 0;
    const s = declare(raw, f.definition, 'PAT-013'); expect(s.cityPatternContinuation).toBeNull(); expect(s.players.p1!.score).toBe(4); expect(s.patternMarkers).toHaveLength(1);
  });
  it.each([2, 3, 4])('city development builds from the draw pile without refilling the public six, then shuffles for %i players', count => {
    const f = activate('PAT-012', count), options = getCityPatternContinuationOptions(f.state, f.definition, 'p1');
    if (options.kind === 'city-move' || !options.constructionOptions) throw Error();
    expect(f.state.players.p1!.score).toBe(f.declared.players.p1!.score - 1);
    const selected = options.constructionOptions.choices.find(c => ['none', 'gain', 'core-neighbor-vouchers', 'starting-player'].includes(getFacilityConstructionSpec(c.cardId).entry.kind))!.cardId;
    const supply = f.state.facilities!.supply, result = buildPending(f.state, f.definition, selected);
    expect(result.facilities!.supply.supply).toEqual(supply.supply); expect([...result.facilities!.supply.drawPile].sort()).toEqual(supply.drawPile.filter(id => id !== selected).sort());
    expect(result.facilities!.supply.revision).toBe(supply.revision + 2); expect(result.cityPatternContinuation).toBeNull(); expect(getRoundTurn(result, f.definition).majorActionStatus).toBe('complete');
    expect(result.patternMarkers).toEqual(f.state.patternMarkers); expect(Object.keys(getMarkerLedger(result, f.definition))).toHaveLength(count * 30);
  });
  it('deck search choices stay private and cannot be made by another player', () => {
    const f = activate('PAT-012'); code(() => getCityPatternContinuationOptions(f.state, f.definition, 'p2'), 'WRONG_ACTOR');
    const view = JSON.stringify(getCityPatternPublicView(f.state, f.definition)); expect(view).not.toContain('drawPile'); expect(view).not.toContain('constructionOptions');
    const s = buildPending(f.state, f.definition); code(() => getCityPatternContinuationOptions(s, f.definition, 'p1'), 'PATTERN_CONTINUATION');
  });
  it.each(['PAT-012', 'PAT-013'])('finishes %s only after a built logistics entry and retains its original quota', id => {
    const f = setup(id), raw = funded(f.state), logistics = FOUNDERS_FACILITY_STOCK.cards.find(c => c.facilityId === 'FAC-004')!.id;
    let s: GameState;
    if (id === 'PAT-012') { const d = declare(raw, f.definition, id); s = send(d, f.definition, { type: 'use-pattern-special', patternId: id, markerId: markerFor(d, id), effect: { kind: 'deck-construction' } }); }
    else s = declare(raw, f.definition, id);
    s = forceAvailable(s, logistics, id === 'PAT-012' ? 'draw-pile' : 'supply');
    const rev = s.facilities!.supply.revision;
    s = buildPending(s, f.definition, logistics); expect(s.construction!.status).toBe('entry-pending'); expect(s.cityPatternContinuation).not.toBeNull();
    if (id === 'PAT-012') expect(s.facilities!.supply.revision).toBe(rev + 1); // not shuffled until entry finishes.
    code(() => round(s, f.definition, { type: 'finish-player-turn' }), 'ACTION_PENDING');
    s = applyNestedFacilityEntryCommand(saved(s, f.definition), f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'build-logistics-extension', placement: null });
    expect(s.cityPatternContinuation).toBeNull(); expect(getRoundTurn(s, f.definition).majorActionStatus).toBe(id === 'PAT-012' ? 'complete' : 'not-started');
  });
  it.each(['PAT-012', 'PAT-013'])('revalidates %s construction payment and source atomically', id => {
    const f = id === 'PAT-012' ? activate(id) : (() => { const f = setup(id); return { ...f, state: declare(funded(f.state), f.definition, id) }; })(), s = f.state;
    const opts = getCityPatternContinuationOptions(s, f.definition, 'p1'); if (opts.kind === 'city-move' || !opts.constructionOptions) throw Error();
    const cardId = id === 'PAT-012' ? s.facilities!.supply.supply[0] : s.facilities!.supply.drawPile[0];
    const before = JSON.stringify(s);
    expect(() => applyConstructionCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId, cellId: opts.constructionOptions!.cellIds[0], paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' } })).toThrow(); expect(JSON.stringify(s)).toBe(before);
  });
  it.each(['wrong-pattern', 'wrong-kind', 'old-format', 'missing-field', 'missing-use', 'false-completion', 'wrong-count', 'wrong-phase', 'unknown-route'])('rejects corrupted continuation %s without internal errors', issue => {
    const f = activate('PAT-004'), raw = gameStateSchema.parse(f.state);
    if (issue === 'wrong-pattern') raw.cityPatterns!.publicPatternIds = raw.cityPatterns!.publicPatternIds.map(id => id === 'PAT-004' ? 'PAT-013' : id);
    if (issue === 'wrong-kind') raw.cityPatternContinuation = { kind: 'deck-build', patternId: 'PAT-012' };
    if (issue === 'old-format') raw.schemaVersion = '1.13.0';
    if (issue === 'missing-field') delete raw.cityPatternContinuation;
    if (issue === 'missing-use') raw.cityPatterns!.usedSpecialActions = [];
    if (issue === 'false-completion') raw.roundFlow!.completedMajorAction = 'special';
    if (issue === 'wrong-count' && raw.cityPatternContinuation?.kind === 'city-move') raw.cityPatternContinuation.remainingMoves = 2;
    if (issue === 'wrong-phase') { delete raw.cityMove; raw.phase = 'round-control'; }
    if (issue === 'unknown-route') { raw.cityMove!.status = 'complete'; raw.cityMove!.routeId = 'R-route-99'; }
    expect(validateGameState(raw, f.definition).success).toBe(false);
  });
  it.each(['PAT-012', 'PAT-013'])('keeps %s pending through warehouse branch, event and final placement, then restores its quota', id => {
    const f = setup(id), raw = funded(f.state), initial = declare(raw, f.definition, id);
    let s = id === 'PAT-012' ? send(initial, f.definition, { type: 'use-pattern-special', patternId: id, markerId: markerFor(initial, id), effect: { kind: 'deck-construction' } }) : initial;
    const card = FOUNDERS_FACILITY_STOCK.cards.find(c => c.facilityId === 'FAC-001' && !s.facilities!.panels[0]!.placements.some(p => p.cardId === c.id))!;
    s = forceAvailable(s, card.id, id === 'PAT-012' ? 'draw-pile' : 'supply'); const rev = s.facilities!.supply.revision;
    s = buildPending(s, f.definition, card.id, { kind: 'warehouse-entry' }); expect(s.construction!.warehouseEntry!.status).toBe('branch-choice');
    s = applyWarehouseEntryCommand(saved(s, f.definition), f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' }, warehouseExploration: { nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] } });
    expect(s.construction!.warehouseEntry!.status).toBe('event-choice'); expect(s.facilities!.supply.revision).toBe(rev + 1);
    s = applyWarehouseEntryCommand(saved(s, f.definition), f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'choose-exploration-event', choice: { choiceId: 'Y01:1' } });
    expect(s.cityPatternContinuation).not.toBeNull();
    s = applyWarehouseEntryCommand(saved(s, f.definition), f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'place-exploration-influence', slotId: getWarehouseEntryFinalSlotIds(s, f.definition, 'p1')[0] });
    expect(s.cityPatternContinuation).toBeNull(); expect(s.construction).toBeUndefined();
    expect(s.facilities!.supply.revision).toBe(rev + (id === 'PAT-012' ? 2 : 1));
    expect(getRoundTurn(s, f.definition).majorActionStatus).toBe(id === 'PAT-012' ? 'complete' : 'not-started'); expect(saved(s, f.definition)).toEqual(s);
  });
  it.each(['PAT-012', 'PAT-013'])('does not allow a client-selected source or free payment for %s', id => {
    const f = id === 'PAT-012' ? activate(id) : (() => { const f = setup(id); return { ...f, state: declare(funded(f.state), f.definition, id) }; })();
    const s = f.state, opts = getCityPatternContinuationOptions(s, f.definition, 'p1'); if (opts.kind === 'city-move' || !opts.constructionOptions) throw Error();
    const command = { ...env(s), type: 'construct-facility', cardId: opts.constructionOptions!.choices[0]!.cardId, cellId: opts.constructionOptions!.cellIds[0], paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' }, source: 'draw-pile', free: true };
    const before = JSON.stringify(s); code(() => applyConstructionCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, command), 'COMMAND_SCHEMA'); expect(JSON.stringify(s)).toBe(before);
  });
  it.each(['PAT-012', 'PAT-013'])('rejects a stale construction continuation for %s without repeating any reward or declaration', id => {
    const f = id === 'PAT-012' ? activate(id) : (() => { const f = setup(id); return { ...f, state: declare(funded(f.state), f.definition, id) }; })();
    const opts = getCityPatternContinuationOptions(f.state, f.definition, 'p1'); if (opts.kind === 'city-move' || !opts.constructionOptions) throw Error();
    code(() => applyConstructionCommand(f.state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(f.state), expectedVersion: 0, type: 'construct-facility', cardId: opts.constructionOptions!.choices[0]!.cardId, cellId: opts.constructionOptions!.cellIds[0], paymentMode: 'vouchers' }), 'STALE_VERSION');
  });
  it('new-building declaration skips a full panel and leaves its original major action available', () => {
    const f = setup('PAT-013'), p = layout(funded(f.state), 'PAT-013');
    for (let row = 1; row <= 4; row++) for (let col = 1; col <= 3; col++) addCard(p.raw, 'blue', `CP-${row}-${col}`);
    const s = send(p.raw, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-013', facilityCardIds: p.cards });
    expect(s.facilities!.panels[0]!.placements).toHaveLength(12); expect(s.cityPatternContinuation).toBeNull(); expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('not-started');
  });
  it('development with an empty deck consumes only its cost and use and records the shuffle', () => {
    const f = setup('PAT-012'), raw = funded(declare(f.state, f.definition, 'PAT-012')); raw.facilities!.supply.returnedToBox.push(...raw.facilities!.supply.drawPile.splice(0));
    const score = raw.players.p1!.score, rev = raw.facilities!.supply.revision;
    const s = send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-012', markerId: markerFor(raw, 'PAT-012'), effect: { kind: 'deck-construction' } });
    expect(s.players.p1!.score).toBe(score - 1); expect(s.cityPatternContinuation).toBeNull(); expect(s.facilities!.supply.revision).toBe(rev + 1); expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('complete');
  });
  it('development rejects score underflow before using the pattern', () => {
    const f = setup('PAT-012'), raw = funded(declare(f.state, f.definition, 'PAT-012')); raw.players.p1!.score = Number.MIN_SAFE_INTEGER;
    const before = JSON.stringify(raw); code(() => send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-012', markerId: markerFor(raw, 'PAT-012'), effect: { kind: 'deck-construction' } }), 'SCORE_OVERFLOW'); expect(JSON.stringify(raw)).toBe(before);
  });
  it.each(['early', 'other-route', 'stale', 'wrong-game', 'wrong-owner'])('rejects composite route placement %s atomically', reason => {
    const f = activate('PAT-004'), s = reason === 'early' ? f.state : finishMove(f.state, f.definition);
    const command = { ...env(s), type: 'place-pattern-route-influence', slotId: 'route:R-route-02:slot:1' }; let expected = 'ROUTE_SLOT';
    if (reason === 'stale') { command.expectedVersion = 0; expected = 'STALE_VERSION'; }
    if (reason === 'wrong-game') { command.gameId = 'other'; expected = 'GAME_REFERENCE'; }
    if (reason === 'wrong-owner') expected = 'WRONG_ACTOR';
    const before = JSON.stringify(s); code(() => applyCityPatternContinuationCommand(s, f.definition, { authenticatedPlayerId: reason === 'wrong-owner' ? 'p2' : 'p1' }, command), expected); expect(JSON.stringify(s)).toBe(before);
  });
  it('composite power skips the extra route placement when its physical marker supply is empty', () => {
    const f = activate('PAT-004'), raw = gameStateSchema.parse(f.state);
    for (const markerId of raw.markerSupplyByPlayer.p1!.splice(0)) {
      const slot = Object.keys(raw.board.influenceBySlot).find(id => id.startsWith('route:') && raw.board.influenceBySlot[id] === null)!;
      raw.board.influenceBySlot[slot] = { markerId, ownerPlayerId: 'p1' };
    }
    const s = finishMove(raw, f.definition); expect(s.cityPatternContinuation).toBeNull(); expect(s.markerSupplyByPlayer.p1).toHaveLength(0); expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('complete');
  });
  it('forbids efficient-movement activation after a role used in the same turn without spending its cost', () => {
    const f = setup('PAT-006'), d = declare(funded(f.state), f.definition, 'PAT-006');
    const s = applyBaseRoleCommand(d, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(d), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } });
    const before = JSON.stringify(s); code(() => send(s, f.definition, { type: 'use-pattern-special', patternId: 'PAT-006', markerId: markerFor(s, 'PAT-006'), effect: { kind: 'double-move' } }), 'ROLE_CONFLICT'); expect(JSON.stringify(s)).toBe(before);
  });
  it('development can take the last actual deck card without inventing a public refill', () => {
    const f = setup('PAT-012'), raw = funded(declare(f.state, f.definition, 'PAT-012'));
    const candidate = raw.facilities!.supply.drawPile.find(id => ['none', 'gain'].includes(getFacilityConstructionSpec(id).entry.kind))!;
    raw.facilities!.supply.returnedToBox.push(...raw.facilities!.supply.drawPile.filter(id => id !== candidate)); raw.facilities!.supply.drawPile = [candidate];
    const s = send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-012', markerId: markerFor(raw, 'PAT-012'), effect: { kind: 'deck-construction' } });
    const next = buildPending(s, f.definition, candidate); expect(next.facilities!.supply.drawPile).toEqual([]); expect(next.facilities!.supply.supply).toEqual(s.facilities!.supply.supply); expect(next.cityPatternContinuation).toBeNull();
  });
  it('does not silently skip an unresolved public refill and award a completed new-building declaration', () => {
    const f = setup('PAT-013'), p = layout(funded(f.state), 'PAT-013'); p.raw.facilities!.supply.returnedToBox.push(...p.raw.facilities!.supply.drawPile.splice(0));
    const before = JSON.stringify(p.raw); code(() => send(p.raw, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-013', facilityCardIds: p.cards }), 'REFILL_RULE_UNRESOLVED'); expect(JSON.stringify(p.raw)).toBe(before);
  });
  it('never publishes a deck construction whose nested entry would leave no revision for the required shuffle', () => {
    const f = activate('PAT-012'), card = FOUNDERS_FACILITY_STOCK.cards.find(c => c.facilityId === 'FAC-004')!;
    const raw = forceAvailable(f.state, card.id, 'draw-pile'); raw.facilities!.supply.revision = Number.MAX_SAFE_INTEGER - 1;
    const before = JSON.stringify(raw); expect(() => buildPending(raw, f.definition, card.id)).toThrow(); expect(JSON.stringify(raw)).toBe(before);
  });
});

