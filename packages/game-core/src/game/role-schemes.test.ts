import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_EVENT_CATALOG, getFoundersEventCard } from '../events/index.js';
import { FOUNDERS_FACILITY_STOCK } from '../facilities/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects,
  enableRemainingBaseRoleEffects, applyRoundCommand, getRoundTurn, applyBaseRoleCommand, applyInfluenceCommand,
  gameStateSchema, validateGameState, parseGameState, getMarkerLedger, getRoundPublicView, getBaseRoleEffectSupport,
  getElysiumSchemeOptions, applyCityMoveCommand, openHarvestPhase, applyHarvestCommand, finishManagedRound,
  openManagedCleanup, getRoleCleanupOptions, applyRoleCleanupCommand, openDeploymentWindow,
  BaseRoleEffectError, RoundFlowError, CityMoveCommandError,
} from './index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';
const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = (state: GameState) => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const roles = (state: GameState, id = 'p1') => state.roundFlow!.rolesByPlayer.find(role => role.playerId === id)!;
function roundSend(state: GameState, definition: GameDefinition, command: Record<string, unknown>) {
  return applyRoundCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), ...command });
}
function dispatchTurn(state: GameState, definition: GameDefinition) {
  state = roundSend(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction!.status === 'ready') state = applyInfluenceCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), type: 'finish-dispatch' });
  return roundSend(state, definition, { type: 'finish-player-turn' });
}
function fixture(roleId: 'ROLE-01' | 'ROLE-02' | 'ROLE-03' | 'ROLE-04' | 'ROLE-05' = 'ROLE-02', count = 3, actorId = 'p1') {
  const setup = createPreEntryGame('remaining-roles-test', seats.slice(0, count));
  const ids = (color: 'green' | 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id), expectedVersion: 0,
    greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (const [index, player] of seats.slice(0, count).entries()) {
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  // Explicit balances fixture, not resources claimed to have been earned in entry.
  const funded = gameStateSchema.parse(state);
  for (const player of Object.values(funded.players)) player.balances = { orirock: 5, originium: 5, iron: 5, 'columbia-voucher': 30, 'pure-originium': 2 };
  state = beginRoundFlow(funded, setup.definition, { expectedVersion: funded.stateVersion, facilityDeckOrder: ordinary, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  state = enableBaseRoleEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  state = enableLiskarmEffects(state, setup.definition, { expectedVersion: state.stateVersion }); const legacy = state;
  state = enableRemainingBaseRoleEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  while (state.roundFlow!.stage === 'role-removal') state = roundSend(state, setup.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply[0] });
  while (state.roundFlow!.stage === 'role-placement') state = roundSend(state, setup.definition, { type: 'place-round-role', roleId: getRoundTurn(state, setup.definition).actorId === actorId ? roleId : 'ROLE-01' });
  while (getRoundTurn(state, setup.definition).actorId !== actorId) state = dispatchTurn(state, setup.definition);
  const board = loadFoundersBoard(count === 4 ? 'four-player' : 'three-player');
  const routeSlots = Object.values(board.routes).flatMap(route => route.influenceSlotIds);
  return { definition: setup.definition, state, legacy, actorId, roleId, board, routeSlots };
}
type Fixture = ReturnType<typeof fixture>;
type MutableState = ReturnType<typeof gameStateSchema.parse>;
function use(f: Fixture, schemeChoice: unknown, state = f.state, strategyChoice?: unknown, actorId = f.actorId) {
  return applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: actorId }, { ...env(state), type: 'use-base-role', roleId: f.roleId,
    mode: strategyChoice === undefined ? 'scheme' : 'both', schemeChoice, ...(strategyChoice === undefined ? {} : { strategyChoice }) });
}
function put(state: MutableState, slotId: string, actorId = 'p1') {
  if (state.board.influenceBySlot[slotId] !== null) throw Error('Occupied fixture slot');
  const markerId = state.markerSupplyByPlayer[actorId]!.shift(); if (!markerId) throw Error('Empty fixture supply');
  state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: actorId }; return markerId;
}
function reveal(state: MutableState, f: Fixture, nodeId: string) {
  const color = f.board.resourceNodes[nodeId]!.eventDeckColor;
  const id = state.eventDecks![color].shift()!, card = getFoundersEventCard(id);
  state.board.resourceMarkerByNode[nodeId] = { markerDefinitionId: id, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
}
function elysiumFixture(count = 3) {
  const f = fixture('ROLE-02', count), state = gameStateSchema.parse(f.state), node = f.board.resourceNodes['B-01']!;
  reveal(state, f, node.id); const own = put(state, node.influenceSlotIds[0]!);
  const route = f.board.routes['R-route-02']!, opponent = put(state, route.influenceSlotIds[0]!, 'p2');
  return { ...f, state: parseGameState(state, f.definition), target: node.id, own, opponent, ownSlot: node.influenceSlotIds[0]!, final: node.influenceSlotIds[1]!, route: route.id, cleared: route.influenceSlotIds[0]! };
}
const ely = (f: ReturnType<typeof elysiumFixture>) => ({ kind: 'elysium-city-move', costDecision: 'pay', nodeId: f.target, routeId: f.route, finalSlotId: f.final });
const texas = (extra: Record<string, unknown> = {}) => ({ kind: 'texas-influence', costDecision: 'pay', ...extra });
function errorCode(fn: () => unknown, code: string, kind: typeof BaseRoleEffectError | typeof RoundFlowError | typeof CityMoveCommandError = BaseRoleEffectError) {
  try { fn(); throw Error('Expected rejection'); } catch (error) { expect(error).toBeInstanceOf(kind); expect((error as { code: string }).code).toBe(code); }
}
function harvest(state: GameState, definition: GameDefinition) {
  while (state.roundFlow!.stage === 'player-actions') state = dispatchTurn(state, definition);
  state = openHarvestPhase(state, definition, { expectedVersion: state.stateVersion, roundNumber: state.roundFlow!.roundNumber });
  for (const player of definition.players) state = applyHarvestCommand(state, definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return state;
}

describe('explicit complete BASE role-mode capability and 1.10.0 compatibility', () => {
  it('reports precisely ten base modes with no assertion about facilities or city styles', () => {
    expect(getBaseRoleEffectSupport()).toMatchObject({ supportedModeCount: 10, allBaseRoleEffectsImplemented: true, remainingSchemesMinimumSnapshotVersion: '1.10.0' });
    expect(getBaseRoleEffectSupport().roles.every(role => role.strategy && role.scheme)).toBe(true);
  });
  it.each([2, 3, 4])('upgrades %i players once and preserves all existing facts', count => {
    const f = fixture('ROLE-02', count), before = structuredClone(f.legacy), next = enableRemainingBaseRoleEffects(f.legacy, f.definition, { expectedVersion: f.legacy.stateVersion });
    expect(next.schemaVersion).toBe('1.10.0'); expect(next.stateVersion).toBe(before.stateVersion + 1); expect(next.board).toEqual(before.board); expect(next.players).toEqual(before.players); expect(next.facilities).toEqual(before.facilities);
    expect(next.roundFlow).toEqual({ ...before.roundFlow!, completedMajorAction: null }); expect(f.legacy).toEqual(before);
    expect(parseGameState(JSON.parse(JSON.stringify(next)), f.definition)).toEqual(next);
    errorCode(() => enableRemainingBaseRoleEffects(next, f.definition, { expectedVersion: next.stateVersion }), 'ROLE_FORMAT');
    errorCode(() => enableRemainingBaseRoleEffects(f.legacy, f.definition, { expectedVersion: 0 }), 'STALE_VERSION');
  });
  it('preserves actual Liskarm delayed duty when upgrading mid-round', () => {
    const f = fixture('ROLE-01'), legacy = gameStateSchema.parse(f.state); legacy.schemaVersion = '1.9.0'; delete legacy.roundFlow!.completedMajorAction;
    const used = applyBaseRoleCommand(legacy, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(legacy), type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: f.routeSlots.slice(0, 2) } });
    const next = enableRemainingBaseRoleEffects(used, f.definition, { expectedVersion: used.stateVersion });
    expect(roles(next).used).toEqual(roles(used).used); expect(roles(next).used!.cleanupResolved).toBe(false); expect(next.board).toEqual(used.board);
  });
  it.each(['ROLE-02', 'ROLE-03', 'ROLE-04'] as const)('refuses %s scheme in saved 1.9.0 and forged saved use', roleId => {
    const f = fixture(roleId), state = gameStateSchema.parse(f.state); state.schemaVersion = '1.9.0'; delete state.roundFlow!.completedMajorAction;
    const before = structuredClone(state); errorCode(() => use(f, { kind: 'forced-sale', asset: 'iron' }, state), 'ROLE_FORMAT'); expect(state).toEqual(before);
    const role = state.roundFlow!.rolesByPlayer.find(row => row.playerId === 'p1')!; role.discarded.push(role.placed!); role.placed = null; role.used = { roleId, mode: 'scheme', turnIndex: 0 };
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('rejects absent/old-format/forged retired major progress and premature completion', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); delete state.roundFlow!.completedMajorAction; expect(validateGameState(state, f.definition).success).toBe(false);
    state.schemaVersion = '1.9.0'; state.roundFlow!.completedMajorAction = null; expect(validateGameState(state, f.definition).success).toBe(false);
    state.schemaVersion = '1.10.0'; state.roundFlow!.completedMajorAction = 'city-move'; expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('refuses upgrade options overrides and version overflow', () => {
    const f = fixture(); errorCode(() => enableRemainingBaseRoleEffects(f.legacy, f.definition, { expectedVersion: f.legacy.stateVersion, completedMajorAction: 'deploy' } as { expectedVersion: number }), 'OPTIONS_SCHEMA');
    const state = gameStateSchema.parse(f.legacy); state.stateVersion = Number.MAX_SAFE_INTEGER;
    errorCode(() => enableRemainingBaseRoleEffects(state, f.definition, { expectedVersion: state.stateVersion }), 'VERSION_OVERFLOW');
  });
});

describe('Elysium scheme: iron cost, exclusive-own adjacency and free complete city movement', () => {
  it.each([2, 3, 4])('moves %i players along exactly the selected route and resolves placement without another event', count => {
    const f = elysiumFixture(count), before = structuredClone(f.state), next = use(f, ely(f));
    expect(next.players.p1!.balances.iron).toBe(2); expect(next.players.p1!.balances.originium).toBe(5); expect(next.players.p1!.balances['columbia-voucher']).toBe(30);
    expect(next.board.cityNodeByPlayer.p1).toBe(f.target); expect(next.board.influenceBySlot[f.ownSlot]!.markerId).toBe(f.own);
    expect(next.board.influenceBySlot[f.cleared]).toBe(null); expect(next.markerSupplyByPlayer.p2).toContain(f.opponent); expect(next.board.influenceBySlot[f.final]!.ownerPlayerId).toBe('p1');
    expect(next.eventDecks).toEqual(before.eventDecks); expect(next.board.resourceMarkerByNode).toEqual(before.board.resourceMarkerByNode); expect(next.roundFlow!.majorActionOpened).toBe(false);
    expect(next.stateVersion).toBe(before.stateVersion + 1); expect(roles(next).discarded).toEqual(['ROLE-02']); expect(f.state).toEqual(before); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(count * 30);
  });
  it('keeps another route intact and preserves own influence on the chosen route', () => {
    const f = elysiumFixture(), state = gameStateSchema.parse(f.state), unrelated = f.board.routes['A-route-01']!.influenceSlotIds[0]!;
    const marker = put(state, unrelated, 'p2'); const next = use(f, ely(f), state);
    expect(next.board.influenceBySlot[unrelated]!.markerId).toBe(marker);
    const ownState = gameStateSchema.parse(f.state), old = ownState.board.influenceBySlot[f.cleared]!; ownState.markerSupplyByPlayer.p2!.push(old.markerId); ownState.board.influenceBySlot[f.cleared] = null; const own = put(ownState, f.cleared);
    expect(use(f, ely(f), ownState).board.influenceBySlot[f.cleared]!.markerId).toBe(own);
  });
  it('allows one own plus one empty node slot but excludes zero-own, mixed-owner and nonadjacent nodes', () => {
    const f = elysiumFixture(); expect(getElysiumSchemeOptions(f.state, f.definition, 'p1')).toContainEqual({ nodeId: f.target, routeId: f.route });
    const mixed = gameStateSchema.parse(f.state); put(mixed, f.final, 'p2'); expect(getElysiumSchemeOptions(mixed, f.definition, 'p1')).not.toContainEqual({ nodeId: f.target, routeId: f.route });
    errorCode(() => use(f, ely(f), mixed), 'MOVE_TARGET');
    const empty = gameStateSchema.parse(f.state), marker = empty.board.influenceBySlot[f.ownSlot]!; empty.markerSupplyByPlayer.p1!.push(marker.markerId); empty.board.influenceBySlot[f.ownSlot] = null;
    errorCode(() => use(f, ely(f), empty), 'MOVE_TARGET');
    errorCode(() => use(f, { ...ely(f), nodeId: 'C-01' }), 'MOVE_TARGET');
  });
  it('does not permit teleportation, another route, the source or an opposing city', () => {
    const f = elysiumFixture(); for (const selection of [{ routeId: 'A-route-01' }, { nodeId: 'A-01' }, { nodeId: 'A-02' }, { nodeId: 'F-03' }]) errorCode(() => use(f, { ...ely(f), ...selection }), 'MOVE_TARGET');
    expect(getElysiumSchemeOptions(f.state, f.definition, 'missing')).toEqual([]);
  });
  it('can spend strategy-earned iron in starting-player both, in strategy-first order', () => {
    const f = elysiumFixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances.iron = 0;
    const next = use(f, ely(f), state, { kind: 'minimum-resource', asset: 'iron' }); expect(next.players.p1!.balances.iron).toBe(1); expect(roles(next).used!.mode).toBe('both'); expect(roles(next).discarded).toEqual(['ROLE-02']);
  });
  it('rolls back both strategy gain and payment on an invalid final placement', () => {
    const f = elysiumFixture(), state = gameStateSchema.parse(f.state), before = structuredClone(state);
    errorCode(() => use(f, { ...ely(f), finalSlotId: f.ownSlot }, state, { kind: 'minimum-resource', asset: 'iron' }), 'FINAL_SLOT'); expect(state).toEqual(before);
  });
  it('requires the final slot while executable and skips it when both target slots are occupied by own markers', () => {
    const f = elysiumFixture(); errorCode(() => use(f, { ...ely(f), finalSlotId: undefined }), 'FINAL_SLOT');
    const state = gameStateSchema.parse(f.state); put(state, f.final); const choice = { ...ely(f) }; delete (choice as { finalSlotId?: string }).finalSlotId;
    expect(use(f, choice, state).board.cityNodeByPlayer.p1).toBe(f.target); errorCode(() => use(f, ely(f), state), 'FINAL_SLOT');
  });
  it('needs no final supply marker when none remains and never manufactures one', () => {
    const f = elysiumFixture(), state = gameStateSchema.parse(f.state);
    for (const slot of f.routeSlots.filter(slot => state.board.influenceBySlot[slot] === null)) { if (!state.markerSupplyByPlayer.p1!.length) break; put(state, slot); }
    expect(state.markerSupplyByPlayer.p1).toHaveLength(0);
    const next = use(f, { kind: 'elysium-city-move', costDecision: 'pay', nodeId: f.target, routeId: f.route }, state);
    expect(next.board.cityNodeByPlayer.p1).toBe(f.target); expect(next.board.influenceBySlot[f.final]).toBe(null); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(90);
  });
  it('pays then skips an impossible move, or declines without paying; declining cannot include targets', () => {
    const f = fixture(), next = use(f, { kind: 'elysium-city-move', costDecision: 'pay' }); expect(next.players.p1!.balances.iron).toBe(2); expect(next.board).toEqual(f.state.board);
    const decline = use(f, { kind: 'elysium-city-move', costDecision: 'decline' }); expect(decline.players).toEqual(f.state.players);
    errorCode(() => use(f, { kind: 'elysium-city-move', costDecision: 'decline', nodeId: 'B-01' }), 'UNEXPECTED_MOVE');
  });
  it('refuses insufficient iron before movement and rejects voluntary omission of an executable target', () => {
    const f = elysiumFixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances.iron = 2; const before = structuredClone(state);
    errorCode(() => use(f, ely(f), state), 'CANNOT_PAY'); expect(state).toEqual(before); errorCode(() => use(f, { kind: 'elysium-city-move', costDecision: 'pay' }), 'MOVE_TARGET');
  });
});

describe('Texas scheme: sequential replacement, one movement and removal at a single cost', () => {
  it.each([2, 3, 4])('performs all steps with real marker ownership and inventory for %i players', count => {
    const f = fixture('ROLE-03', count), state = gameStateSchema.parse(f.state), [a, b] = f.routeSlots; const old = put(state, a!, 'p2'), own = state.markerSupplyByPlayer.p1![0]!, before = structuredClone(state);
    const next = use(f, texas({ replaceSlotId: a, move: { sourceSlotId: a, targetSlotId: b }, removeSlotId: b }), state);
    expect(next.players.p1!.balances['columbia-voucher']).toBe(27); expect(next.markerSupplyByPlayer.p2).toContain(old); expect(next.markerSupplyByPlayer.p1).toContain(own); expect(next.board.influenceBySlot[a!]).toBe(null); expect(next.board.influenceBySlot[b!]).toBe(null);
    expect(next.players.p1!.balances.originium).toBe(5); expect(next.roundFlow!.majorActionOpened).toBe(false); expect(next.stateVersion).toBe(state.stateVersion + 1); expect(state).toEqual(before); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(count * 30);
  });
  it('can remove an opponent marker after moving the newly replaced marker', () => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state), [a, b, c] = f.routeSlots; put(state, a!, 'p2'); const other = put(state, c!, 'p3');
    const next = use(f, texas({ replaceSlotId: a, move: { sourceSlotId: a, targetSlotId: b }, removeSlotId: c }), state); expect(next.board.influenceBySlot[b!]!.ownerPlayerId).toBe('p1'); expect(next.markerSupplyByPlayer.p3).toContain(other);
  });
  it('may replace own influence and move/remove the same physical marker without requiring new supply', () => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state), [a, b] = f.routeSlots; const marker = put(state, a!);
    const next = use(f, texas({ replaceSlotId: a, move: { sourceSlotId: a, targetSlotId: b }, removeSlotId: b }), state); expect(next.markerSupplyByPlayer.p1).toContain(marker); expect(next.board.influenceBySlot[a!]).toBe(null);
  });
  it('removes from an opponent city in replacement, skips an impossible own move, then continues removal', () => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state), citySlot = f.board.resourceNodes['A-02']!.influenceSlotIds[0]!, other = f.routeSlots[0]!;
    const city = put(state, citySlot, 'p2'), route = put(state, other, 'p2');
    const next = use(f, texas({ replaceSlotId: citySlot, removeSlotId: other }), state); expect(next.board.influenceBySlot[citySlot]).toBe(null); expect(next.markerSupplyByPlayer.p2).toEqual(expect.arrayContaining([city, route])); expect(next.markerSupplyByPlayer.p1).toEqual(state.markerSupplyByPlayer.p1);
  });
  it('pays once when no influence exists, skips all three impossible effects, and rejects surplus choices', () => {
    const f = fixture('ROLE-03'), next = use(f, texas()); expect(next.players.p1!.balances['columbia-voucher']).toBe(27); expect(next.board).toEqual(f.state.board);
    errorCode(() => use(f, texas({ removeSlotId: f.routeSlots[0] })), 'REMOVAL_TARGET'); errorCode(() => use(f, texas({ move: { sourceSlotId: f.routeSlots[0], targetSlotId: f.routeSlots[1] } })), 'UNEXPECTED_MOVE');
  });
  it('requires each feasible step and recalculates occupancy after each one', () => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state), [a, b] = f.routeSlots; put(state, a!, 'p2');
    errorCode(() => use(f, texas(), state), 'REPLACEMENT_REQUIRED'); errorCode(() => use(f, texas({ replaceSlotId: a }), state), 'MOVE_REQUIRED');
    errorCode(() => use(f, texas({ replaceSlotId: a, move: { sourceSlotId: a, targetSlotId: b } }), state), 'REMOVAL_REQUIRED');
    errorCode(() => use(f, texas({ replaceSlotId: a, move: { sourceSlotId: a, targetSlotId: b }, removeSlotId: a }), state), 'REMOVAL_TARGET');
  });
  it.each(['source', 'occupied', 'same'] as const)('refuses invalid %s movement and rolls back the earlier replacement and payment', variant => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state), [a, b, c] = f.routeSlots; put(state, a!, 'p2'); put(state, c!, 'p2'); const before = structuredClone(state);
    const move = variant === 'source' ? { sourceSlotId: c, targetSlotId: b } : { sourceSlotId: a, targetSlotId: variant === 'occupied' ? c : a };
    errorCode(() => use(f, texas({ replaceSlotId: a, move, removeSlotId: c }), state), variant === 'source' ? 'MOVE_SOURCE' : 'MOVE_TARGET'); expect(state).toEqual(before);
  });
  it('declines the entire conditional sequence without payment or choices', () => {
    const f = fixture('ROLE-03'), next = use(f, { kind: 'texas-influence', costDecision: 'decline' }); expect(next.players).toEqual(f.state.players); expect(next.board).toEqual(f.state.board); expect(roles(next).used!.mode).toBe('scheme');
    errorCode(() => use(f, { kind: 'texas-influence', costDecision: 'decline', removeSlotId: f.routeSlots[0] }), 'UNEXPECTED_INFLUENCE');
  });
  it('uses Texas strategy income before conditional cost and rolls back the market cycle on a later invalid step', () => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 0; const cardId = state.facilities!.supply.supply[0]!;
    const next = use(f, texas(), state, { kind: 'cycle-facility', cardId }); expect(next.players.p1!.balances['columbia-voucher']).toBe(9); expect(roles(next).discarded).toEqual(['ROLE-03']);
    const before = structuredClone(state); errorCode(() => use(f, texas({ removeSlotId: f.routeSlots[0] }), state, { kind: 'cycle-facility', cardId }), 'REMOVAL_TARGET'); expect(state).toEqual(before);
  });
  it('refuses insufficient vouchers and a final removal cannot select a nonexistent object', () => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 2;
    errorCode(() => use(f, texas(), state), 'CANNOT_PAY'); errorCode(() => use(f, texas({ replaceSlotId: f.routeSlots[0] })), 'REPLACEMENT_TARGET');
  });
});

describe('Cannot scheme: mandatory complete sales for everyone and one point', () => {
  it.each([2, 3, 4])('settles every player, including self, with server-derived quantities in %i-player games', count => {
    const f = fixture('ROLE-04', count), state = gameStateSchema.parse(f.state);
    for (const [index, player] of Object.values(state.players).entries()) player.balances.iron = index;
    const before = structuredClone(state), next = use(f, { kind: 'forced-sale', asset: 'iron' }, state);
    for (const [id, player] of Object.entries(before.players)) expect(next.players[id]!.balances).toEqual({ ...player.balances, iron: 0, 'columbia-voucher': 30 + player.balances.iron * 2 });
    expect(next.players.p1!.score).toBe(before.players.p1!.score + 1); expect(next.players.p1!.balances['pure-originium']).toBe(2); expect(next.roundFlow!.majorActionOpened).toBe(false); expect(state).toEqual(before);
  });
  it.each(['orirock', 'originium', 'iron'] as const)('selects only %s while preserving every other resource and opponent score', asset => {
    const f = fixture('ROLE-04'), next = use(f, { kind: 'forced-sale', asset });
    for (const [id, player] of Object.entries(f.state.players)) { expect(next.players[id]!.balances).toEqual({ ...player.balances, [asset]: 0, 'columbia-voucher': 40 }); expect(next.players[id]!.score).toBe(player.score + (id === 'p1' ? 1 : 0)); }
  });
  it('still gains exactly one point when all players have zero of the selected resource', () => {
    const f = fixture('ROLE-04'), state = gameStateSchema.parse(f.state); for (const player of Object.values(state.players)) player.balances.originium = 0;
    const next = use(f, { kind: 'forced-sale', asset: 'originium' }, state); expect(next.players.p1!.score).toBe(state.players.p1!.score + 1); expect(Object.values(next.players).map(player => player.balances['columbia-voucher'])).toEqual([30, 30, 30]);
  });
  it('executes the voluntary strategy sale first, then sells every remainder at the forced rate', () => {
    const f = fixture('ROLE-04'), next = use(f, { kind: 'forced-sale', asset: 'iron' }, f.state, { kind: 'sell-resources', amounts: { orirock: 0, originium: 0, iron: 2, 'pure-originium': 0 } });
    expect(next.players.p1!.balances.iron).toBe(0); expect(next.players.p1!.balances['columbia-voucher']).toBe(44); expect(next.players.p2!.balances['columbia-voucher']).toBe(40); expect(roles(next).discarded).toEqual(['ROLE-04']);
  });
  it.each(['pure-originium', 'columbia-voucher'] as const)('rejects %s as a forced-sale resource', asset => { const f = fixture('ROLE-04'); errorCode(() => use(f, { kind: 'forced-sale', asset }), 'COMMAND_SCHEMA'); });
  it.each(['amount', 'players', 'rate'] as const)('does not accept client-selected %s', key => { const f = fixture('ROLE-04'); errorCode(() => use(f, { kind: 'forced-sale', asset: 'iron', [key]: 0 }), 'COMMAND_SCHEMA'); });
  it.each(['proceeds', 'opponent', 'score'] as const)('rolls back every player and earlier strategy changes on %s overflow', variant => {
    const f = fixture('ROLE-04'), state = gameStateSchema.parse(f.state);
    if (variant === 'proceeds') state.players.p2!.balances.iron = Number.MAX_SAFE_INTEGER;
    if (variant === 'opponent') state.players.p2!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER;
    if (variant === 'score') state.players.p1!.score = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(state); errorCode(() => use(f, { kind: 'forced-sale', asset: 'iron' }, state, { kind: 'sell-resources', amounts: { orirock: 1, originium: 0, iron: 0, 'pure-originium': 0 } }), variant === 'score' ? 'SCORE_OVERFLOW' : 'BALANCE_OVERFLOW'); expect(state).toEqual(before);
  });
});

describe('shared permissions, completed action retirement, persistence and next-round schedule', () => {
  it('can move again with Elysium after a completed ordinary move without reopening or losing the major action', () => {
    const f = elysiumFixture(), definition = f.definition;
    let state = roundSend(f.state, definition, { type: 'choose-major-action', action: 'city-move' });
    // From A-01 to already-explored B-01, consuming ordinary 3 originium and completing its final placement.
    state = applyCityMoveCommand(state, definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'move-city', nodeId: f.target, routeId: f.route });
    state = applyCityMoveCommand(state, definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'place-city-move-influence', slotId: f.final });
    const amended = gameStateSchema.parse(state), back = f.board.resourceNodes['A-01']!.influenceSlotIds; put(amended, back[0]!);
    const next = use(f, { kind: 'elysium-city-move', costDecision: 'pay', nodeId: 'A-01', routeId: f.route, finalSlotId: back[1] }, amended);
    expect(next.board.cityNodeByPlayer.p1).toBe('A-01'); expect(next.cityMove).toBeUndefined(); expect(next.phase).toBe('round-control'); expect(next.roundFlow!.completedMajorAction).toBe('city-move'); expect(getRoundTurn(next, definition).majorActionStatus).toBe('complete');
    expect(next.players.p1!.balances.originium).toBe(2); expect(next.players.p1!.balances.iron).toBe(2);
    errorCode(() => roundSend(next, definition, { type: 'choose-major-action', action: 'dispatch' }), 'MAJOR_ACTION_USED', RoundFlowError);
    errorCode(() => roundSend(next, definition, { type: 'cancel-major-preparation' }), 'ACTION_STARTED', RoundFlowError);
    expect(() => openDeploymentWindow(next, definition, { actorId: 'p1', roundNumber: 1, expectedVersion: next.stateVersion })).toThrow();
    errorCode(() => applyCityMoveCommand(next, definition, { authenticatedPlayerId: 'p1' }, { ...env(next), type: 'move-city', nodeId: f.target, routeId: f.route }), 'ACTION_STAGE', CityMoveCommandError);
    const saved = parseGameState(JSON.parse(JSON.stringify(next)), definition); const ended = roundSend(saved, definition, { type: 'finish-player-turn' }); expect(ended.roundFlow!.completedMajorAction).toBe(null); expect(getRoundTurn(ended, definition).actorId).toBe('p2');
  });
  it('retires a completed dispatch before a post-action forced sale and resets the fact for the next player', () => {
    const f = fixture('ROLE-04'), definition = f.definition; let state = roundSend(f.state, definition, { type: 'choose-major-action', action: 'dispatch' });
    const next = use(f, { kind: 'forced-sale', asset: 'iron' }, state); expect(next.influenceAction).toBeUndefined(); expect(next.roundFlow!.completedMajorAction).toBe('dispatch');
    expect(getRoundTurn(next, definition).majorActionStatus).toBe('complete'); state = roundSend(next, definition, { type: 'finish-player-turn' }); expect(state.roundFlow!.completedMajorAction).toBe(null);
  });
  it('rejects a role inside uncompleted action preparation and after a performed partial action', () => {
    const f = elysiumFixture(), state = roundSend(f.state, f.definition, { type: 'choose-major-action', action: 'dispatch' }); errorCode(() => use(f, ely(f), state), 'ACTION_PENDING');
    const progressed = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'dispatch-influence', sourceSlotId: f.ownSlot, targetSlotId: f.routeSlots[0] });
    errorCode(() => use(f, ely(f), progressed), 'ACTION_PENDING');
  });
  it('uses only the placed role, current player, correct mode choices and once per round', () => {
    const f = fixture('ROLE-04'); errorCode(() => use(f, { kind: 'forced-sale', asset: 'iron' }, f.state, undefined, 'p2'), 'ROLE_WINDOW');
    errorCode(() => use(f, { kind: 'elysium-city-move', costDecision: 'decline' }), 'ROLE_CHOICES');
    const next = use(f, { kind: 'forced-sale', asset: 'iron' }); errorCode(() => use(f, { kind: 'forced-sale', asset: 'iron' }, next), 'ROLE_ALREADY_USED');
    const nonstarter = fixture('ROLE-04', 3, 'p2'); errorCode(() => use(nonstarter, { kind: 'forced-sale', asset: 'iron' }, nonstarter.state, { kind: 'sell-resources', amounts: { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 } }), 'STARTING_PLAYER_ONLY');
  });
  it('rejects stale/game/overflow and client authority fields, preserving state', () => {
    const f = fixture('ROLE-04'), payload = { ...env(f.state), type: 'use-base-role', roleId: f.roleId, mode: 'scheme', schemeChoice: { kind: 'forced-sale', asset: 'iron' } }, before = structuredClone(f.state);
    for (const [patch, code] of [[{ expectedVersion: 0 }, 'STALE_VERSION'], [{ gameId: 'other' }, 'GAME_REFERENCE'], [{ actorId: 'p2' }, 'COMMAND_SCHEMA']] as const) errorCode(() => applyBaseRoleCommand(f.state, f.definition, { authenticatedPlayerId: 'p1' }, { ...payload, ...patch }), code);
    const state = gameStateSchema.parse(f.state); state.stateVersion = Number.MAX_SAFE_INTEGER; errorCode(() => use(f, { kind: 'forced-sale', asset: 'iron' }, state), 'VERSION_OVERFLOW'); expect(f.state).toEqual(before);
  });
  it.each([2, 3, 4])('preserves 1.10.0 through both action cycles, harvest and next-round role inventory for %i players', count => {
    const f = fixture('ROLE-04', count), used = use(f, { kind: 'forced-sale', asset: 'orirock' });
    expect(getRoundPublicView(used, f.definition, 'p2').roles.find(role => role.playerId === 'p1')!.usedRole!.roleId).toBe('ROLE-04');
    const settled = harvest(used, f.definition); expect(settled.schemaVersion).toBe('1.10.0'); const next = finishManagedRound(settled, f.definition, { expectedVersion: settled.stateVersion });
    expect(next.schemaVersion).toBe('1.10.0'); expect(next.roundFlow!.roundNumber).toBe(2); expect(next.roundFlow!.completedMajorAction).toBe(null); expect(roles(next).discarded).toEqual(['ROLE-04']); expect(roles(next).used).toBe(null); expect(next.playerOrder![0]).toBe('p2');
  });
  it('still blocks and resolves real Liskarm cleanup in 1.10.0', () => {
    const f = fixture('ROLE-01'); let state = applyBaseRoleCommand(f.state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(f.state), type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: f.routeSlots.slice(0, 2) } });
    state = harvest(state, f.definition); errorCode(() => finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), 'CLEANUP_PENDING', RoundFlowError);
    state = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion }); state = applyRoleCleanupCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'resolve-role-cleanup', slotId: getRoleCleanupOptions(state, f.definition, 'p1')[0] });
    expect(finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }).schemaVersion).toBe('1.10.0');
  });
});


describe('additional physical-supply and route boundary regressions', () => {
  it.each([2, 3, 4])('does not enter an already marked red target before its opening round for %i players', count => {
    const f = fixture('ROLE-02', count), state = gameStateSchema.parse(f.state);
    reveal(state, f, 'D-02'); reveal(state, f, 'F-01'); state.board.cityNodeByPlayer.p1 = 'D-02'; put(state, f.board.resourceNodes['F-01']!.influenceSlotIds[0]!);
    expect(getElysiumSchemeOptions(state, f.definition, 'p1')).not.toContainEqual({ nodeId: 'F-01', routeId: 'F-route-02' });
    errorCode(() => use(f, { kind: 'elysium-city-move', costDecision: 'pay', nodeId: 'F-01', routeId: 'F-route-02' }, state), 'MOVE_TARGET');
  });
  it('handles a four-end route as a single free city movement, clearing only that independent route', () => {
    const f = fixture('ROLE-02', 2), state = gameStateSchema.parse(f.state); reveal(state, f, 'C-01'); reveal(state, f, 'B-03'); state.board.cityNodeByPlayer.p1 = 'C-01';
    const target = f.board.resourceNodes['B-03']!, route = f.board.routes['C-route-02']!; put(state, target.influenceSlotIds[0]!); const opposing = route.influenceSlotIds.map(slot => put(state, slot, 'p2'));
    const next = use(f, { kind: 'elysium-city-move', costDecision: 'pay', nodeId: target.id, routeId: route.id, finalSlotId: target.influenceSlotIds[1] }, state);
    expect(route.incidentNodeIds).toHaveLength(4); expect(next.board.cityNodeByPlayer.p1).toBe(target.id); expect(next.markerSupplyByPlayer.p2).toEqual(expect.arrayContaining(opposing)); expect(next.players.p1!.balances.originium).toBe(5);
  });
  it('with empty own supply, replacement only removes, then an existing marker moves into the freed slot', () => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state), [a, b] = f.routeSlots; const opponent = put(state, a!, 'p2');
    for (const slot of f.routeSlots.slice(1)) { if (!state.markerSupplyByPlayer.p1!.length) break; put(state, slot); }
    expect(state.markerSupplyByPlayer.p1).toHaveLength(0); const old = state.board.influenceBySlot[b!]!.markerId;
    const next = use(f, texas({ replaceSlotId: a, move: { sourceSlotId: b, targetSlotId: a }, removeSlotId: a }), state);
    expect(next.markerSupplyByPlayer.p1).toEqual([old]); expect(next.markerSupplyByPlayer.p2).toContain(opponent); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(90);
  });
  it.each(['opposing-city', 'unexplored-node'] as const)('rejects moving Texas influence to %s and keeps all earlier facts', target => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state), a = f.routeSlots[0]!; put(state, a, 'p2');
    const destination = f.board.resourceNodes[target === 'opposing-city' ? 'A-02' : 'B-01']!.influenceSlotIds[0]!, before = structuredClone(state);
    errorCode(() => use(f, texas({ replaceSlotId: a, move: { sourceSlotId: a, targetSlotId: destination }, removeSlotId: destination }), state), 'MOVE_TARGET'); expect(state).toEqual(before);
  });
  it('retires a real completed deployment before Texas moves and removes that marker', () => {
    const f = fixture('ROLE-03'), definition = f.definition, [a, b] = f.routeSlots;
    let state = roundSend(f.state, definition, { type: 'choose-major-action', action: 'deploy' });
    state = applyInfluenceCommand(state, definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'deploy-influence', slotId: a });
    const next = use(f, texas({ replaceSlotId: a, move: { sourceSlotId: a, targetSlotId: b }, removeSlotId: b }), state);
    expect(next.roundFlow!.completedMajorAction).toBe('deploy'); expect(next.influenceAction).toBeUndefined(); expect(next.markerSupplyByPlayer.p1).toEqual(expect.arrayContaining([...state.markerSupplyByPlayer.p1!]));
    expect(getRoundTurn(roundSend(next, definition, { type: 'finish-player-turn' }), definition).actorId).toBe('p2');
  });
  it('does not discard completed-action progress or consume the role when a subsequent scheme fails', () => {
    const f = fixture('ROLE-03'), state = roundSend(f.state, f.definition, { type: 'choose-major-action', action: 'dispatch' }), before = structuredClone(state);
    errorCode(() => use(f, texas({ removeSlotId: f.routeSlots[0] }), state), 'REMOVAL_TARGET'); expect(state).toEqual(before); expect(state.influenceAction!.status).toBe('complete'); expect(state.roundFlow!.completedMajorAction).toBe(null); expect(roles(state).placed).toBe('ROLE-03');
  });
});
