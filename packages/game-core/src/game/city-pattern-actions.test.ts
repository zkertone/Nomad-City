import { describe, expect, it } from 'vitest';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_FACILITY_STOCK, getFoundersFacilityFace } from '../facilities/index.js';
import { getCityPattern, getEligibleCityPatterns } from '../patterns/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects,
  enableWarehouseEntries, enableNestedFacilityEntries, enableCityPatterns, applyCityPatternCommand, getCityPatternDeclarationOptions,
  getCityPatternSpecialOptions, getCityPatternPublicView, getCityPatternActionSupport, gameStateSchema, parseGameState, validateGameState,
  getMarkerLedger, getGamePosition, applyRoundCommand, getRoundTurn, applyBaseRoleCommand, applyInfluenceCommand,
  openHarvestPhase, applyHarvestCommand, finishManagedRound, applyConstructionCommand, getDeploymentSlotIds,
  openDeploymentWindow, applyExplorationCommand, getExplorationFinalSlotIds, applyNestedFacilityEntryCommand, getNestedFacilityEntryOptions,
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

describe('explicit 1.13 initialization and declaration transactions', () => {
  it.each([2, 3, 4])('initializes %i players with shared 4+2 public patterns, empty tracks and full marker conservation', count => {
    const f = setup('PAT-001', count), s = f.initialized;
    expect(s.schemaVersion).toBe('1.13.0'); expect(s.stateVersion).toBe(f.legacy.stateVersion + 1); expect(s.patternMarkers).toEqual([]);
    expect(s.players).toEqual(f.legacy.players); expect(s.facilities).toEqual(f.legacy.facilities);
    expect(s.cityPatterns!.publicPatternIds).toHaveLength(6); expect(Object.keys(getMarkerLedger(s, f.definition))).toHaveLength(count * 30);
    expect(saved(s, f.definition)).toEqual(s); expect(getCityPatternPublicView(s, f.definition).publicPatternIds).toHaveLength(6);
  });
  it('does not infer old declaration history or initialize a started game, malformed source order or another version', () => {
    const f = setup(); code(() => enableCityPatterns(f.state, f.definition, { expectedVersion: f.state.stateVersion, gameplayVersion: 'base' }), 'PATTERN_INITIALIZATION');
    code(() => enableCityPatterns(f.legacy, f.definition, { expectedVersion: 0, gameplayVersion: 'base' }), 'STALE_VERSION');
    code(() => enableCityPatterns(f.legacy, f.definition, { expectedVersion: f.legacy.stateVersion, gameplayVersion: 'enterprise' as 'base' }), 'OPTIONS_SCHEMA');
    code(() => enableCityPatterns(f.legacy, f.definition, { expectedVersion: f.legacy.stateVersion, gameplayVersion: 'base', patternOrder: [] }), 'PATTERN_ORDER');
    const built = layout(f.legacy, 'PAT-001'); code(() => enableCityPatterns(built.raw, f.definition, { expectedVersion: built.raw.stateVersion, gameplayVersion: 'base' }), 'PATTERN_INITIALIZATION');
  });
  it.each([['PAT-001', 3], ['PAT-002', 2], ['PAT-003', 6], ['PAT-004', 3], ['PAT-005', 2], ['PAT-006', 7], ['PAT-008', 3], ['PAT-009', 6], ['PAT-010', 7], ['PAT-011', 2], ['PAT-012', 5], ['PAT-014', 3]])('declares %s once, exhausts distinct facilities and scores %s without using a major action', (id, points) => {
    const f = setup(String(id)), placed = layout(f.state, String(id)), before = JSON.stringify(placed.raw), firstMarker = placed.raw.markerSupplyByPlayer.p1![0]!;
    expect(getCityPatternDeclarationOptions(placed.raw, f.definition, 'p1').find(row => row.patternId === id)!.matches.length).toBeGreaterThan(0);
    const s = send(placed.raw, f.definition, { type: 'declare-city-pattern', patternId: id, facilityCardIds: placed.cards, ...(id === 'PAT-014' ? { returnMarkerId: firstMarker } : {}) });
    expect(s.players.p1!.score).toBe(points); expect(s.cityPatterns!.exhaustedFacilityIdsByPlayer.p1).toEqual(placed.cards);
    expect(s.stateVersion).toBe(placed.raw.stateVersion + 1); expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('not-started');
    expect(JSON.stringify(placed.raw)).toBe(before); expect(Object.keys(getMarkerLedger(s, f.definition))).toHaveLength(90);
    expect(s.markerSupplyByPlayer.p1).toHaveLength(placed.raw.markerSupplyByPlayer.p1!.length - (id === 'PAT-014' ? 0 : 1));
    if (id !== 'PAT-014') expect(getMarkerLedger(s, f.definition)[firstMarker]!.location).toMatchObject({ kind: 'city-pattern', patternId: id });
    if (id === 'PAT-002') for (const asset of ['orirock', 'originium', 'iron'] as const) expect(s.players.p1!.balances[asset]).toBe(placed.raw.players.p1!.balances[asset] + 1);
    if (id === 'PAT-014') expect(s.players.p1!.balances['pure-originium']).toBe(1);
    expect(saved(s, f.definition)).toEqual(s);
    code(() => send(s, f.definition, { type: 'declare-city-pattern', patternId: id, facilityCardIds: placed.cards, ...(id === 'PAT-014' ? { returnMarkerId: firstMarker } : {}) }), 'PATTERN_LAYOUT');
  });
  it('allows two announcements of one pattern using separate facilities without doubling an existing use track', () => {
    const f = setup(), first = declare(f.state, f.definition, 'PAT-001'), second = declare(first, f.definition, 'PAT-001', 3);
    expect(second.patternMarkers).toHaveLength(2); expect(second.players.p1!.score).toBe(6); expect(second.cityPatterns!.useTracks).toHaveLength(1);
    expect(second.cityPatterns!.useTracks[0]!.remainingUses).toBe(1); expect(second.cityPatterns!.exhaustedFacilityIdsByPlayer.p1).toHaveLength(6);
  });
  it('never pretends a declaration requiring immediate construction has completed', () => {
    const f = setup('PAT-013'), p = layout(f.state, 'PAT-013'), before = JSON.stringify(p.raw);
    code(() => send(p.raw, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-013', facilityCardIds: p.cards }), 'PATTERN_EFFECT_UNSUPPORTED'); expect(JSON.stringify(p.raw)).toBe(before);
  });
  it.each(['marker-shortage', 'wrong-actor', 'wrong-game', 'stale', 'duplicate-facility', 'wrong-layout', 'reward-overflow', 'score-overflow', 'invented-score'])('rejects %s without partial declaration', reason => {
    const f = setup('PAT-002'), p = layout(f.state, 'PAT-002'), command: Record<string, unknown> = { ...env(p.raw), type: 'declare-city-pattern', patternId: 'PAT-002', facilityCardIds: p.cards };
    let expected = '', actor = 'p1';
    if (reason === 'marker-shortage') { for (const markerId of p.raw.markerSupplyByPlayer.p1!.splice(0)) { const slotId = Object.keys(p.raw.board.influenceBySlot).find(id => p.raw.board.influenceBySlot[id] === null)!; p.raw.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: 'p1' }; } expected = 'NO_AVAILABLE_MARKER'; }
    if (reason === 'wrong-actor') { actor = 'p2'; expected = 'PATTERN_WINDOW'; }
    if (reason === 'wrong-game') { command.gameId = 'another'; expected = 'GAME_REFERENCE'; }
    if (reason === 'stale') { command.expectedVersion = 0; expected = 'STALE_VERSION'; }
    if (reason === 'duplicate-facility') { command.facilityCardIds = [p.cards[0], p.cards[0]]; expected = 'PATTERN_LAYOUT'; }
    if (reason === 'wrong-layout') { command.facilityCardIds = [p.cards[0], p.raw.facilities!.supply.supply[0]]; expected = 'PATTERN_LAYOUT'; }
    if (reason === 'reward-overflow') { p.raw.players.p1!.balances.iron = Number.MAX_SAFE_INTEGER; expected = 'BALANCE_OVERFLOW'; }
    if (reason === 'score-overflow') { p.raw.players.p1!.score = Number.MAX_SAFE_INTEGER; expected = 'SCORE_OVERFLOW'; }
    if (reason === 'invented-score') { command.points = 99; expected = 'COMMAND_SCHEMA'; }
    const before = JSON.stringify(p.raw); code(() => applyCityPatternCommand(p.raw, f.definition, { authenticatedPlayerId: actor }, command), expected); expect(JSON.stringify(p.raw)).toBe(before);
  });
});

describe('four complete influence-based special actions', () => {
  it('mobilization replaces once with no voucher fee and consumes the ordinary major action', () => {
    const f = setup(), raw = gameStateSchema.parse(declare(f.state, f.definition, 'PAT-001')), slotId = 'route:R-route-01:slot:1';
    raw.board.influenceBySlot[slotId] = { markerId: raw.markerSupplyByPlayer.p2!.shift()!, ownerPlayerId: 'p2' };
    const s = send(saved(raw, f.definition), f.definition, { type: 'use-pattern-special', patternId: 'PAT-001', markerId: markerFor(raw, 'PAT-001'), effect: { kind: 'replace', slotId } });
    expect(s.board.influenceBySlot[slotId]!.ownerPlayerId).toBe('p1'); expect(s.players).toEqual(raw.players); expect(s.markerSupplyByPlayer.p2).toHaveLength(raw.markerSupplyByPlayer.p2!.length + 1);
    expect(getRoundTurn(s, f.definition).majorActionStatus).toBe('complete'); expect(s.roundFlow!.completedMajorAction).toBe('special');
    code(() => round(s, f.definition, { type: 'choose-major-action', action: 'deploy' }), 'MAJOR_ACTION_USED');
    code(() => round(s, f.definition, { type: 'cancel-major-preparation' }), 'ACTION_STARTED');
    const nextTurn = secondTurn(s, f.definition); code(() => send(nextTurn, f.definition, { type: 'use-pattern-special', patternId: 'PAT-001', markerId: markerFor(s, 'PAT-001'), effect: { kind: 'replace' } }), 'PATTERN_SPECIAL_LOCKED');
  });
  it.each([1, 2, 3, 4])('military places min(%i own pattern markers,3) and never counts another player', count => {
    const f = setup('PAT-005'); let raw = gameStateSchema.parse(declare(f.state, f.definition, 'PAT-005'));
    for (let i = 1; i < count; i++) raw.patternMarkers!.push({ markerId: raw.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p1', patternId: 'PAT-005' });
    raw.patternMarkers!.push({ markerId: raw.markerSupplyByPlayer.p2!.shift()!, ownerPlayerId: 'p2', patternId: 'PAT-005' });
    raw.cityPatterns!.useTracks.push({ playerId: 'p2', patternId: 'PAT-005', remainingUses: 1 });
    const targets = getCityPatternSpecialOptions(raw, f.definition, 'p1')[0]!.placementSlotIds.slice(0, Math.min(count, 3));
    const s = send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-005', markerId: markerFor(raw, 'PAT-005'), effect: { kind: 'military', slotIds: targets } });
    for (const slot of targets) expect(s.board.influenceBySlot[slot]!.ownerPlayerId).toBe('p1'); expect(s.cityPatterns!.useTracks[0]!.remainingUses).toBe(0);
    expect(Object.keys(getMarkerLedger(s, f.definition))).toHaveLength(90);
  });
  it('security executes two choices sequentially, permits repeating a choice, and pays before replacement', () => {
    const f = setup('PAT-009'), raw = gameStateSchema.parse(declare(f.state, f.definition, 'PAT-009'));
    raw.players.p1!.balances.orirock = 2; raw.players.p1!.balances.iron = 0;
    raw.board.influenceBySlot['route:R-route-01:slot:1'] = { markerId: raw.markerSupplyByPlayer.p2!.shift()!, ownerPlayerId: 'p2' };
    const s = send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(raw, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'remove', slotId: 'route:R-route-01:slot:1' }, { kind: 'replace', costDecision: 'pay' }] } });
    expect(s.players.p1!.balances.iron).toBe(1); expect(s.players.p1!.balances.orirock).toBe(0); expect(s.cityPatterns!.useTracks[0]!.remainingUses).toBe(1);
    const g = setup('PAT-009'), start = declare(g.state, g.definition, 'PAT-009');
    const twice = send(start, g.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(start, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'place', slotId: 'route:R-route-01:slot:1' }, { kind: 'place', slotId: 'route:R-route-02:slot:1' }] } });
    expect(twice.players.p1!.balances.originium).toBe(start.players.p1!.balances.originium + 2);
  });
  it('outpost places at the current city before moving an actual newly placed marker', () => {
    const f = setup('PAT-011'), raw = declare(f.state, f.definition, 'PAT-011'), board = loadFoundersBoard('three-player'), slots = board.resourceNodes['A-01']!.influenceSlotIds;
    const s = send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-011', markerId: markerFor(raw, 'PAT-011'), effect: { kind: 'outpost', slotIds: slots.slice(0, 2), moves: [{ sourceSlotId: slots[0], targetSlotId: 'route:R-route-01:slot:1' }] } });
    expect(s.board.influenceBySlot[slots[0]!]).toBeNull(); expect(s.board.influenceBySlot[slots[1]!]!.ownerPlayerId).toBe('p1'); expect(s.board.influenceBySlot['route:R-route-01:slot:1']!.ownerPlayerId).toBe('p1');
  });
  it('rejects an invalid second security target atomically and refuses to spend future rewards', () => {
    const f = setup('PAT-009'), raw = gameStateSchema.parse(declare(f.state, f.definition, 'PAT-009')), before = JSON.stringify(raw);
    code(() => send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(raw, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'place', slotId: 'route:R-route-01:slot:1' }, { kind: 'place', slotId: 'route:R-route-01:slot:1' }] } }), 'PLACEMENT_REQUIRED'); expect(JSON.stringify(raw)).toBe(before);
    code(() => send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(raw, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'replace', costDecision: 'pay' }, { kind: 'remove' }] } }), 'CANNOT_PAY'); expect(JSON.stringify(raw)).toBe(before);
  });
  it('blocks roles before and after a role-forbidding special, while allowing roles after other specials', () => {
    const f = setup('PAT-009'), raw = declare(f.state, f.definition, 'PAT-009');
    const used = applyBaseRoleCommand(raw, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(raw), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } });
    code(() => send(used, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(used, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'replace', costDecision: 'decline' }, { kind: 'replace', costDecision: 'decline' }] } }), 'ROLE_CONFLICT');
    const after = send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(raw, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'replace', costDecision: 'decline' }, { kind: 'replace', costDecision: 'decline' }] } });
    code(() => applyBaseRoleCommand(after, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(after), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } }), 'ROLE_CONFLICT');
    const g = setup(), start = declare(g.state, g.definition, 'PAT-001'), complete = send(start, g.definition, { type: 'use-pattern-special', patternId: 'PAT-001', markerId: markerFor(start, 'PAT-001'), effect: { kind: 'replace' } });
    expect(applyBaseRoleCommand(complete, g.definition, { authenticatedPlayerId: 'p1' }, { ...env(complete), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } }).roundFlow!.completedMajorAction).toBe('special');
  });
});

describe('round cleanup, lifetime limits, pending actions and save integrity', () => {
  it.each([2, 3, 4])('retains exhausted facilities, resets level-I cooldown and preserves markers through harvest/next round for %i players', count => {
    const f = setup('PAT-001', count), start = declare(f.state, f.definition, 'PAT-001'), used = send(start, f.definition, { type: 'use-pattern-special', patternId: 'PAT-001', markerId: markerFor(start, 'PAT-001'), effect: { kind: 'replace' } });
    const next = finish(saved(used, f.definition), f.definition);
    expect(next.roundFlow!.roundNumber).toBe(2); expect(next.cityPatterns!.usedSpecialActions).toEqual([]); expect(next.cityPatterns!.useTracks[0]!.remainingUses).toBe(1);
    expect(next.cityPatterns!.exhaustedFacilityIdsByPlayer).toEqual(start.cityPatterns!.exhaustedFacilityIdsByPlayer); expect(next.patternMarkers).toEqual(start.patternMarkers);
    expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(count * 30); expect(saved(next, f.definition)).toEqual(next);
  });
  it('never refills level-II lifetime uses during cleanup or repeated declarations', () => {
    const f = setup('PAT-009'), start = declare(f.state, f.definition, 'PAT-009');
    let s = send(start, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(start, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'replace', costDecision: 'decline' }, { kind: 'replace', costDecision: 'decline' }] } });
    s = finish(s, f.definition); expect(s.cityPatterns!.useTracks[0]!.remainingUses).toBe(1);
    while (s.roundFlow!.stage === 'role-placement') s = round(s, f.definition, { type: 'place-round-role', roleId: 'ROLE-02' });
    while (getRoundTurn(s, f.definition).actorId !== 'p1') s = dispatch(s, f.definition);
    s = send(s, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(s, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'replace', costDecision: 'decline' }, { kind: 'replace', costDecision: 'decline' }] } });
    s = finish(s, f.definition); expect(s.cityPatterns!.useTracks[0]!.remainingUses).toBe(0);
    const raw = gameStateSchema.parse(s); raw.cityPatterns!.useTracks[0]!.remainingUses = 0; expect(saved(raw, f.definition).cityPatterns!.useTracks[0]!.remainingUses).toBe(0);
  });
  it('allows announcements after a completed deployment without granting another major action', () => {
    const f = setup(), p = layout(f.state, 'PAT-001'); let s = round(p.raw, f.definition, { type: 'choose-major-action', action: 'deploy' });
    s = applyInfluenceCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'deploy-influence', slotId: getDeploymentSlotIds(s, f.definition, 'p1')[0] });
    s = send(s, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-001', facilityCardIds: p.cards });
    expect(s.roundFlow!.completedMajorAction).toBe('deploy'); expect(s.phase).toBe('round-control');
    code(() => round(s, f.definition, { type: 'choose-major-action', action: 'deploy' }), 'MAJOR_ACTION_USED'); expect(secondTurn(s, f.definition).schemaVersion).toBe('1.13.0');
  });
  it('cannot insert declarations into an unused opened action, exploration event or pending facility entry', () => {
    const f = setup(), p = layout(f.state, 'PAT-001'), opened = round(p.raw, f.definition, { type: 'choose-major-action', action: 'deploy' });
    code(() => send(opened, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-001', facilityCardIds: p.cards }), 'ACTION_PENDING');
    code(() => openDeploymentWindow(opened, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: opened.stateVersion }), 'ROUND_WINDOW');
    let explore = round(p.raw, f.definition, { type: 'choose-major-action', action: 'explore' });
    explore = applyExplorationCommand(explore, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(explore), type: 'explore', nodeId: 'B-01', path: [{ routeId: 'R-route-02', toNodeId: 'B-01' }] });
    code(() => send(explore, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-001', facilityCardIds: p.cards }), 'ACTION_PENDING');
  });
  it.each([2, 3, 4])('preserves declared markers through an exploration event, settlement and final placement for %i players', count => {
    const f = setup('PAT-001', count), start = declare(f.state, f.definition, 'PAT-001');
    let s = round(start, f.definition, { type: 'choose-major-action', action: 'explore' });
    s = applyExplorationCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
    expect(s.exploration!.cardId).toBe('Y01');
    s = applyExplorationCommand(saved(s, f.definition), f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'choose-exploration-event', choice: { choiceId: 'Y01:1' } });
    s = applyExplorationCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(s, f.definition, 'p1')[0] });
    expect(s.exploration!.status).toBe('complete'); expect(s.patternMarkers).toEqual(start.patternMarkers);
    expect(s.cityPatterns).toEqual(start.cityPatterns); expect(Object.keys(getMarkerLedger(s, f.definition))).toHaveLength(count * 30);
    expect(saved(s, f.definition)).toEqual(s);
  });
  it('preserves pattern marker locations through real construction quotes, settlement and nested entries', () => {
    const f = setup(), start = declare(f.state, f.definition, 'PAT-001'), raw = gameStateSchema.parse(start);
    raw.players.p1!.balances['columbia-voucher'] = 30;
    const target = FOUNDERS_FACILITY_STOCK.cards.find(c => c.facilityId === 'FAC-004')!.id, supply = raw.facilities!.supply;
    const at = supply.drawPile.indexOf(target); if (at >= 0) [supply.supply[0], supply.drawPile[at]] = [target, supply.supply[0]!];
    let s = round(raw, f.definition, { type: 'choose-major-action', action: 'construct' });
    s = applyConstructionCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId: target, cellId: 'CP-2-1', paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' } });
    expect(getNestedFacilityEntryOptions(s, f.definition, 'p1').kind).toBe('logistics');
    code(() => send(s, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-001', facilityCardIds: [...start.cityPatterns!.exhaustedFacilityIdsByPlayer.p1!] }), 'ACTION_PENDING');
    s = applyNestedFacilityEntryCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'build-logistics-extension', placement: null });
    expect(s.patternMarkers).toEqual(start.patternMarkers); expect(getGamePosition(s, f.definition).patternMarkers).toEqual(start.patternMarkers);
    expect(saved(s, f.definition)).toEqual(s);
  });
  it.each(['duplicate-marker', 'wrong-owner', 'unknown-pattern', 'too-many-uses', 'duplicate-track', 'foreign-exhaustion', 'old-format', 'missing-pattern-state', 'wrong-public-levels', 'unknown-special'])('rejects corrupt saved state %s without throwing internally', issue => {
    const f = setup(), raw = gameStateSchema.parse(declare(f.state, f.definition, 'PAT-001'));
    if (issue === 'duplicate-marker') raw.markerSupplyByPlayer.p1!.push(raw.patternMarkers![0]!.markerId);
    if (issue === 'wrong-owner') raw.patternMarkers![0]!.ownerPlayerId = 'p2';
    if (issue === 'unknown-pattern') raw.patternMarkers![0]!.patternId = 'PAT-999';
    if (issue === 'too-many-uses') raw.cityPatterns!.useTracks[0]!.remainingUses = 2;
    if (issue === 'duplicate-track') raw.cityPatterns!.useTracks.push(raw.cityPatterns!.useTracks[0]!);
    if (issue === 'foreign-exhaustion') raw.cityPatterns!.exhaustedFacilityIdsByPlayer.p1!.push(raw.facilities!.panels[1]!.placements[0]!.cardId);
    if (issue === 'old-format') raw.schemaVersion = '1.12.0';
    if (issue === 'missing-pattern-state') delete raw.cityPatterns;
    if (issue === 'wrong-public-levels') raw.cityPatterns!.publicPatternIds = ['PAT-001', 'PAT-002', 'PAT-003', 'PAT-006', 'PAT-009', 'PAT-010'];
    if (issue === 'unknown-special') raw.cityPatterns!.usedSpecialActions.push({ playerId: 'p1', patternId: 'PAT-999', turnIndex: 0 });
    expect(validateGameState(raw, f.definition).success).toBe(false);
  });
  it('returns actual special candidates without granting actions and advertises the partial execution boundary', () => {
    const f = setup(), s = declare(f.state, f.definition, 'PAT-001'), before = JSON.stringify(s);
    expect(getCityPatternSpecialOptions(s, f.definition, 'p1')[0]).toMatchObject({ patternId: 'PAT-001', remainingUses: 1 });
    expect(JSON.stringify(s)).toBe(before); expect(getCityPatternActionSupport().declarationPatternIds).toHaveLength(12);
    expect(getCityPatternActionSupport().specialActionPatternIds).toHaveLength(4); expect(getCityPatternActionSupport().allPatternActionsImplemented).toBe(false);
  });
  it('does not spend an unsupported nested special and still allows the normal major action', () => {
    const f = setup('PAT-003'), s = declare(f.state, f.definition, 'PAT-003'), before = JSON.stringify(s);
    code(() => send(s, f.definition, { type: 'use-pattern-special', patternId: 'PAT-003', markerId: markerFor(s, 'PAT-003'), effect: { kind: 'replace' } }), 'PATTERN_SPECIAL_UNSUPPORTED');
    expect(JSON.stringify(s)).toBe(before); expect(round(s, f.definition, { type: 'choose-major-action', action: 'deploy' }).schemaVersion).toBe('1.13.0');
  });
  it('permits the security special in the second cycle after a role in the first cycle', () => {
    const f = setup('PAT-009'), s = declare(f.state, f.definition, 'PAT-009');
    let used = applyBaseRoleCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } });
    used = round(used, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    used = secondTurn(used, f.definition);
    expect(send(used, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(used, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'replace', costDecision: 'decline' }, { kind: 'replace', costDecision: 'decline' }] } }).cityPatterns!.useTracks[0]!.remainingUses).toBe(1);
  });
  it('refuses a level-II or foreign marker for management-center reward, keeping the new declaration atomic', () => {
    const f = setup('PAT-014'), p = layout(f.state, 'PAT-014');
    p.raw.cityPatterns!.publicPatternIds = p.raw.cityPatterns!.publicPatternIds.map(id => id === 'PAT-003' ? 'PAT-009' : id);
    const own = p.raw.markerSupplyByPlayer.p1!.shift()!, foreign = p.raw.markerSupplyByPlayer.p2!.shift()!;
    p.raw.patternMarkers!.push({ markerId: own, ownerPlayerId: 'p1', patternId: 'PAT-009' }, { markerId: foreign, ownerPlayerId: 'p2', patternId: 'PAT-001' });
    p.raw.cityPatterns!.useTracks.push({ playerId: 'p1', patternId: 'PAT-009', remainingUses: 2 }, { playerId: 'p2', patternId: 'PAT-001', remainingUses: 1 });
    const before = JSON.stringify(p.raw);
    for (const returnMarkerId of [own, foreign]) code(() => send(p.raw, f.definition, { type: 'declare-city-pattern', patternId: 'PAT-014', facilityCardIds: p.cards, returnMarkerId }), 'PATTERN_MARKER_TARGET');
    expect(JSON.stringify(p.raw)).toBe(before);
  });
  it('a saved activation cannot keep a fresh use count', () => {
    const f = setup(), s = declare(f.state, f.definition, 'PAT-001'), used = gameStateSchema.parse(send(s, f.definition, { type: 'use-pattern-special', patternId: 'PAT-001', markerId: markerFor(s, 'PAT-001'), effect: { kind: 'replace' } }));
    used.cityPatterns!.useTracks[0]!.remainingUses = 1; expect(validateGameState(used, f.definition).success).toBe(false);
  });
  it('security reward overflow and a missing outpost movement return no partial state', () => {
    const f = setup('PAT-009'), raw = gameStateSchema.parse(declare(f.state, f.definition, 'PAT-009')); raw.players.p1!.balances.iron = Number.MAX_SAFE_INTEGER;
    const before = JSON.stringify(raw); code(() => send(raw, f.definition, { type: 'use-pattern-special', patternId: 'PAT-009', markerId: markerFor(raw, 'PAT-009'), effect: { kind: 'security', choices: [{ kind: 'remove' }, { kind: 'remove' }] } }), 'BALANCE_OVERFLOW'); expect(JSON.stringify(raw)).toBe(before);
    const g = setup('PAT-011'), s = declare(g.state, g.definition, 'PAT-011'), slots = loadFoundersBoard('three-player').resourceNodes['A-01']!.influenceSlotIds;
    code(() => send(s, g.definition, { type: 'use-pattern-special', patternId: 'PAT-011', markerId: markerFor(s, 'PAT-011'), effect: { kind: 'outpost', slotIds: slots.slice(0, 2), moves: [] } }), 'MOVE_REQUIRED');
    expect(s.board.influenceBySlot[slots[0]!]).toBeNull();
  });
});
