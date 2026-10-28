import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { FOUNDERS_FACILITY_STOCK } from '../facilities/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects,
  applyRoundCommand, getRoundTurn, applyBaseRoleCommand, applyInfluenceCommand,
  gameStateSchema, validateGameState, parseGameState, getMarkerLedger, getRoundPublicView,
  openHarvestPhase, applyHarvestCommand, finishManagedRound, openManagedCleanup, getRoleCleanupOptions, applyRoleCleanupCommand,
  BaseRoleEffectError, RoleCleanupError, RoundFlowError, getBaseRoleEffectSupport,
  openDeploymentWindow, openDispatchWindow, openExplorationWindow, openCityMoveWindow, openConstructionWindow,
} from './index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';
const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = (state: GameState) => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
const ownerSlots = (state: GameState, playerId = 'p1') => Object.entries(state.board.influenceBySlot).filter(([, marker]) => marker?.ownerPlayerId === playerId).map(([slotId]) => slotId);
const role = (state: GameState, actorId = 'p1') => state.roundFlow!.rolesByPlayer.find(row => row.playerId === actorId)!;
function roundSend(state: GameState, definition: GameDefinition, command: Record<string, unknown>) {
  return applyRoundCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), ...command });
}
function dispatchTurn(state: GameState, definition: GameDefinition) {
  state = roundSend(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction!.status === 'ready') state = applyInfluenceCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), type: 'finish-dispatch' });
  return roundSend(state, definition, { type: 'finish-player-turn' });
}
function fixture(count = 3, actorId = 'p1') {
  const setup = createPreEntryGame('liskarm-test', seats.slice(0, count));
  const ids = (color: 'green' | 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(setup.state, setup.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (const [index, player] of seats.slice(0, count).entries()) {
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
    state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) state = applyEntryCommand(state, setup.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  // Explicit funding fixture; no claim that these vouchers were earned during entry.
  const funded = gameStateSchema.parse(state); for (const player of Object.values(funded.players)) player.balances['columbia-voucher'] = 30;
  state = beginRoundFlow(funded, setup.definition, { expectedVersion: funded.stateVersion, facilityDeckOrder: ordinary, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  state = enableBaseRoleEffects(state, setup.definition, { expectedVersion: state.stateVersion }); const legacy = state;
  state = enableLiskarmEffects(state, setup.definition, { expectedVersion: state.stateVersion });
  while (state.roundFlow!.stage === 'role-removal') state = roundSend(state, setup.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply[0] });
  while (state.roundFlow!.stage === 'role-placement') state = roundSend(state, setup.definition, { type: 'place-round-role', roleId: 'ROLE-01' });
  while (getRoundTurn(state, setup.definition).actorId !== actorId) state = dispatchTurn(state, setup.definition);
  const board = loadFoundersBoard(count === 4 ? 'four-player' : 'three-player');
  const routeSlots = Object.values(board.routes).flatMap(route => route.influenceSlotIds);
  return { definition: setup.definition, state, actorId, board, routeSlots, legacy };
}
type Fixture = ReturnType<typeof fixture>;
type MutableState = ReturnType<typeof gameStateSchema.parse>;
const use = (f: Fixture, mode: string, strategyChoice?: unknown, schemeChoice?: unknown, state = f.state, actorId = f.actorId) => applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: actorId }, {
  ...env(state), type: 'use-base-role', roleId: 'ROLE-01', mode,
  ...(strategyChoice !== undefined ? { strategyChoice } : {}), ...(schemeChoice !== undefined ? { schemeChoice } : {}),
});
function put(state: MutableState, slotId: string, actorId = 'p1') {
  if (state.board.influenceBySlot[slotId] !== null) throw Error('Occupied fixture slot');
  const markerId = state.markerSupplyByPlayer[actorId]!.shift(); if (!markerId) throw Error('Empty fixture supply');
  state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: actorId }; return markerId;
}
function clear(state: MutableState) {
  for (const [slotId, marker] of Object.entries(state.board.influenceBySlot)) if (marker) { state.markerSupplyByPlayer[marker.ownerPlayerId]!.push(marker.markerId); state.board.influenceBySlot[slotId] = null; }
}
const placeChoice = (slots: readonly string[]) => ({ kind: 'liskarm-place', slotIds: slots });
const replaceChoice = (slotId?: string, costDecision = 'pay') => ({ kind: 'liskarm-replace', costDecision, ...(slotId ? { slotId } : {}) });
function errorCode(fn: () => unknown, code: string, kind: typeof BaseRoleEffectError | typeof RoleCleanupError | typeof RoundFlowError = BaseRoleEffectError) {
  try { fn(); throw Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(kind); expect((error as { code: string }).code).toBe(code); }
}
function harvest(state: GameState, definition: GameDefinition) {
  while (state.roundFlow!.stage === 'player-actions') state = dispatchTurn(state, definition);
  state = openHarvestPhase(state, definition, { expectedVersion: state.stateVersion, roundNumber: state.roundFlow!.roundNumber });
  for (const player of definition.players) state = applyHarvestCommand(state, definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return state;
}
const cleanupSend = (state: GameState, f: Fixture, slotId: string, actorId = getRoundTurn(state, f.definition).actorId!) => applyRoleCleanupCommand(state, f.definition, { authenticatedPlayerId: actorId }, { ...env(state), type: 'resolve-role-cleanup', slotId });


describe('explicit 1.9.0 Liskarm support and complete strategy', () => {
  it.each([2, 3, 4])('upgrades %i players without resetting the existing game or role history', count => {
    const f = fixture(count), before = structuredClone(f.legacy), upgraded = enableLiskarmEffects(f.legacy, f.definition, { expectedVersion: f.legacy.stateVersion });
    expect(upgraded.schemaVersion).toBe('1.9.0'); expect(upgraded.stateVersion).toBe(f.legacy.stateVersion + 1);
    expect(upgraded.roundFlow).toEqual(f.legacy.roundFlow); expect(upgraded.board).toEqual(f.legacy.board); expect(upgraded.players).toEqual(f.legacy.players); expect(upgraded.facilities).toEqual(f.legacy.facilities);
    expect(f.legacy).toEqual(before); expect(getBaseRoleEffectSupport()).toMatchObject({ supportedModeCount: 10, liskarmMinimumSnapshotVersion: '1.9.0', allBaseRoleEffectsImplemented: true });
    errorCode(() => enableLiskarmEffects(upgraded, f.definition, { expectedVersion: upgraded.stateVersion }), 'ROLE_FORMAT', RoleCleanupError);
    errorCode(() => enableLiskarmEffects(f.legacy, f.definition, { expectedVersion: 0 }), 'STALE_VERSION', RoleCleanupError);
  });
  it.each([2, 3, 4])('places two distinct existing supply markers for %i players and registers cleanup', count => {
    const f = fixture(count), slots = f.routeSlots.slice(0, 2), markers = f.state.markerSupplyByPlayer.p1!.slice(0, 2), before = structuredClone(f.state);
    const next = use(f, 'strategy', placeChoice(slots));
    for (const [index, slotId] of slots.entries()) expect(next.board.influenceBySlot[slotId]).toEqual({ markerId: markers[index], ownerPlayerId: 'p1' });
    expect(next.markerSupplyByPlayer.p1).toHaveLength(f.state.markerSupplyByPlayer.p1!.length - 2);
    expect(role(next).used).toEqual({ roleId: 'ROLE-01', mode: 'strategy', turnIndex: 0, cleanupResolved: false });
    expect(next.players).toEqual(f.state.players); expect(next.facilities).toEqual(f.state.facilities); expect(next.roundFlow!.majorActionOpened).toBe(false);
    expect(f.state).toEqual(before); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(count * 30);
  });
  it('requires every executable placement and refuses duplicate/extra/blocked choices atomically', () => {
    const f = fixture();
    for (const slots of [[], [f.routeSlots[0]!], [f.routeSlots[0]!, f.routeSlots[0]!], ['node:D-01:slot:1', f.routeSlots[0]!], ['node:A-02:slot:1', f.routeSlots[0]!]]) {
      const before = structuredClone(f.state); errorCode(() => use(f, 'strategy', placeChoice(slots)), slots.length < 2 ? 'PLACEMENT_REQUIRED' : 'PLACEMENT_TARGET'); expect(f.state).toEqual(before);
    }
    errorCode(() => use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 3))), 'COMMAND_SCHEMA');
  });
  it('upgrades a real prior role use without erasing its discard history', () => {
    const f = fixture(); let state = f.legacy;
    while (getRoundTurn(state, f.definition).stage === 'role-removal') state = roundSend(state, f.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply.at(-1) });
    while (state.roundFlow!.stage === 'role-placement') state = roundSend(state, f.definition, { type: 'place-round-role', roleId: getRoundTurn(state, f.definition).actorId === 'p1' ? 'ROLE-02' : 'ROLE-01' });
    state = applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'iron' } });
    const upgraded = enableLiskarmEffects(state, f.definition, { expectedVersion: state.stateVersion });
    expect(role(upgraded).used).toEqual(role(state).used); expect(role(upgraded).discarded).toEqual(['ROLE-02']); expect(upgraded.players).toEqual(state.players); expect(upgraded.roundFlow).toEqual(state.roundFlow);
  });
  it('uses a last supply marker once and skips the impossible second attempt', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state);
    for (const slot of f.routeSlots.slice(0, 28)) put(state, slot);
    expect(state.markerSupplyByPlayer.p1).toHaveLength(1); const target = f.routeSlots[28]!;
    const next = use(f, 'strategy', placeChoice([target]), undefined, state);
    expect(next.markerSupplyByPlayer.p1).toHaveLength(0); expect(ownerSlots(next)).toHaveLength(29); expect(role(next).used!.cleanupResolved).toBe(false);
    errorCode(() => use(f, 'strategy', placeChoice([target, f.routeSlots[29]!]), undefined, state), 'UNEXPECTED_PLACEMENT');
  });
  it('skips both placements with no supply and still owes removal from pre-existing influence', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); for (const slot of f.routeSlots.slice(0, 29)) put(state, slot);
    const next = use(f, 'strategy', placeChoice([]), undefined, state);
    expect(ownerSlots(next)).toEqual(ownerSlots(state)); expect(role(next).used!.cleanupResolved).toBe(false);
    errorCode(() => use(f, 'strategy', placeChoice([f.routeSlots[29]!]), undefined, state), 'UNEXPECTED_PLACEMENT');
  });
  it('skips placements when every legal target is full even with markers remaining', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state);
    for (const slot of f.board.resourceNodes['A-01']!.influenceSlotIds) put(state, slot);
    for (const slot of f.routeSlots) put(state, slot, state.markerSupplyByPlayer.p1!.length > 1 ? 'p1' : 'p2');
    const next = use(f, 'strategy', placeChoice([]), undefined, state);
    expect(next.markerSupplyByPlayer.p1).toEqual(state.markerSupplyByPlayer.p1); expect(next.board).toEqual(state.board);
  });
  it('skips the second placement when the first fills the last legal slot, with supply still remaining', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state);
    for (const slot of f.board.resourceNodes['A-01']!.influenceSlotIds) put(state, slot);
    for (const slot of f.routeSlots.slice(0, -1)) put(state, slot, 'p2');
    const target = f.routeSlots.at(-1)!, next = use(f, 'strategy', placeChoice([target]), undefined, state);
    expect(next.board.influenceBySlot[target]!.ownerPlayerId).toBe('p1'); expect(next.markerSupplyByPlayer.p1!.length).toBeGreaterThan(0);
    expect(next.markerSupplyByPlayer.p1!.length).toBe(state.markerSupplyByPlayer.p1!.length - 1);
  });
});

describe('conditional same-slot replacement, not an atomic opponent-to-own swap', () => {
  it('returns the target marker to its owner then places an actual actor supply marker in the same slot', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), slot = f.routeSlots[0]!, removed = put(state, slot, 'p2'), incoming = state.markerSupplyByPlayer.p1![0]!;
    const next = use(f, 'scheme', undefined, replaceChoice(slot), state);
    expect(next.board.influenceBySlot[slot]).toEqual({ markerId: incoming, ownerPlayerId: 'p1' }); expect(next.markerSupplyByPlayer.p2).toContain(removed);
    expect(next.markerSupplyByPlayer.p1).toHaveLength(state.markerSupplyByPlayer.p1!.length - 1); expect(next.players.p1!.balances['columbia-voucher']).toBe(27);
    expect(role(next).used).toEqual({ roleId: 'ROLE-01', mode: 'scheme', turnIndex: 0 });
  });
  it('removes influence at an opponent city but cannot place its own there', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), slot = 'node:A-02:slot:1', removed = put(state, slot, 'p2');
    const next = use(f, 'scheme', undefined, replaceChoice(slot), state);
    expect(next.board.influenceBySlot[slot]).toBe(null); expect(next.markerSupplyByPlayer.p2).toContain(removed); expect(next.markerSupplyByPlayer.p1).toEqual(state.markerSupplyByPlayer.p1);
    expect(next.players.p1!.balances['columbia-voucher']).toBe(27);
  });
  it('can remove an opponent marker with exhausted own supply without inventing a replacement marker', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); for (const slot of f.routeSlots.slice(0, 29)) put(state, slot);
    const target = f.routeSlots[29]!, removed = put(state, target, 'p2');
    const next = use(f, 'scheme', undefined, replaceChoice(target), state);
    expect(next.board.influenceBySlot[target]).toBe(null); expect(next.markerSupplyByPlayer.p1).toHaveLength(0); expect(next.markerSupplyByPlayer.p2).toContain(removed);
    expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(90);
  });
  it('can replace existing own influence, reusing the returned marker when supply was empty', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); for (const slot of f.routeSlots.slice(0, 29)) put(state, slot);
    const target = f.routeSlots[0]!, marker = state.board.influenceBySlot[target];
    const next = use(f, 'scheme', undefined, replaceChoice(target), state);
    expect(next.board.influenceBySlot[target]).toEqual(marker); expect(next.markerSupplyByPlayer.p1).toHaveLength(0); expect(next.players.p1!.balances['columbia-voucher']).toBe(27);
  });
  it('may decline the conditional cost with no target; paid but impossible replacement skips', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); clear(state);
    const declined = use(f, 'scheme', undefined, replaceChoice(undefined, 'decline'), state);
    expect(declined.players).toEqual(state.players); expect(declined.board).toEqual(state.board); expect(role(declined).used!.mode).toBe('scheme');
    const paid = use(f, 'scheme', undefined, replaceChoice(), state); expect(paid.players.p1!.balances['columbia-voucher']).toBe(27); expect(paid.board).toEqual(state.board);
    errorCode(() => use(f, 'scheme', undefined, replaceChoice(f.routeSlots[0], 'decline'), state), 'UNEXPECTED_REPLACEMENT');
  });
  it.each(['missing', 'empty', 'not-affordable', 'wrong-choice'] as const)('rejects %s replacement without costs or discard', problem => {
    const f = fixture(), state = gameStateSchema.parse(f.state); put(state, f.routeSlots[0]!, 'p2');
    if (problem === 'not-affordable') state.players.p1!.balances['columbia-voucher'] = 2;
    const before = structuredClone(state), choice = problem === 'wrong-choice' ? { kind: 'recover-roles', rewards: [] } : replaceChoice(problem === 'missing' ? undefined : problem === 'empty' ? f.routeSlots[1] : f.routeSlots[0]);
    errorCode(() => use(f, 'scheme', undefined, choice, state), problem === 'missing' ? 'REPLACEMENT_REQUIRED' : problem === 'empty' ? 'REPLACEMENT_TARGET' : problem === 'not-affordable' ? 'CANNOT_PAY' : 'ROLE_CHOICES'); expect(state).toEqual(before);
  });
  it('starting player both mode places first then replaces, with one deferred obligation and one discard', () => {
    const f = fixture(), slots = f.routeSlots.slice(0, 2), next = use(f, 'both', placeChoice(slots), replaceChoice(slots[0]));
    expect(ownerSlots(next)).toHaveLength(2); expect(next.players.p1!.balances['columbia-voucher']).toBe(27);
    expect(role(next).discarded).toEqual(['ROLE-01']); expect(role(next).used).toMatchObject({ mode: 'both', cleanupResolved: false });
  });
  it('rolls back both placements when the later conditional payment fails', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances['columbia-voucher'] = 2; const before = structuredClone(state);
    errorCode(() => use(f, 'both', placeChoice(f.routeSlots.slice(0, 2)), replaceChoice(f.routeSlots[0]), state), 'CANNOT_PAY'); expect(state).toEqual(before);
  });
  it('keeps the strategy cleanup obligation when the starting player declines the scheme cost in both mode', () => {
    const f = fixture(), next = use(f, 'both', placeChoice(f.routeSlots.slice(0, 2)), replaceChoice(undefined, 'decline'));
    expect(next.players).toEqual(f.state.players); expect(role(next).used).toMatchObject({ mode: 'both', cleanupResolved: false }); expect(ownerSlots(next)).toHaveLength(2);
  });
  it('permits a nonstarting player scheme but rejects both modes', () => {
    const f = fixture(3, 'p2');
    expect(role(use(f, 'scheme', undefined, replaceChoice(undefined, 'decline')), 'p2').used!.mode).toBe('scheme');
    errorCode(() => use(f, 'both', placeChoice(f.routeSlots.slice(0, 2)), replaceChoice(undefined, 'decline')), 'STARTING_PLAYER_ONLY');
  });
});

describe('delayed cleanup gating, player choices and actual marker conservation', () => {
  it.each([2, 3, 4])('requires cleanup for %i players and allows removal of older influence instead of newly placed markers', count => {
    const f = fixture(count), initial = gameStateSchema.parse(f.state), oldSlot = f.routeSlots[2]!, oldId = put(initial, oldSlot);
    let state = use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 2)), undefined, initial); state = harvest(state, f.definition);
    const before = structuredClone(state);
    errorCode(() => finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), 'CLEANUP_PENDING', RoundFlowError); expect(state).toEqual(before);
    state = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion });
    expect(state.roundFlow!.stage).toBe('cleanup'); expect(state.playerOrder).toEqual(before.playerOrder); expect(getRoundTurn(state, f.definition).actorId).toBe('p1');
    expect(getRoleCleanupOptions(state, f.definition, 'p1')).toContain(oldSlot); expect(getRoleCleanupOptions(state, f.definition, 'p2')).toEqual([]);
    const supplyCount = state.markerSupplyByPlayer.p1!.length;
    state = cleanupSend(state, f, oldSlot); expect(state.board.influenceBySlot[oldSlot]).toBe(null); expect(state.markerSupplyByPlayer.p1).toContain(oldId); expect(state.markerSupplyByPlayer.p1).toHaveLength(supplyCount + 1);
    for (const slot of f.routeSlots.slice(0, 2)) expect(state.board.influenceBySlot[slot]!.ownerPlayerId).toBe('p1');
    expect(role(state).used!.cleanupResolved).toBe(true); expect(getRoundTurn(state, f.definition).actorId).toBe(null);
    const saved = parseGameState(JSON.parse(JSON.stringify(state)), f.definition); expect(saved).toEqual(state);
    state = finishManagedRound(saved, f.definition, { expectedVersion: saved.stateVersion });
    expect(state.roundFlow!.roundNumber).toBe(2); expect(state.playerOrder![0]).toBe('p2'); expect(role(state).discarded).toEqual(['ROLE-01']); expect(role(state).used).toBe(null); expect(state.schemaVersion).toBe('1.9.0');
    expect(Object.keys(getMarkerLedger(state, f.definition))).toHaveLength(count * 30);
  });
  it('settles three independent owners in clockwise order and cannot finish after just one', () => {
    const f = fixture(); let state = f.state;
    for (let i = 0; i < 3; i++) {
      const actor = getRoundTurn(state, f.definition).actorId!, slots = f.routeSlots.filter(id => state.board.influenceBySlot[id] === null).slice(0, 2);
      state = use(f, 'strategy', placeChoice(slots), undefined, state, actor); state = dispatchTurn(state, f.definition);
    }
    state = harvest(state, f.definition); state = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion });
    for (const actor of ['p1', 'p2', 'p3']) {
      expect(getRoundTurn(state, f.definition).actorId).toBe(actor); const target = getRoleCleanupOptions(state, f.definition, actor)[0]!;
      errorCode(() => cleanupSend(state, f, target, actor === 'p1' ? 'p2' : 'p1'), 'WRONG_ACTOR', RoleCleanupError);
      state = cleanupSend(state, f, target, actor);
      if (actor !== 'p3') errorCode(() => finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), 'CLEANUP_PENDING', RoundFlowError);
    }
    expect(finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }).playerOrder).toEqual(['p2', 'p3', 'p1']);
  });
  it('skips only an impossible removal after opponents really replace both of the strategy markers', () => {
    const f = fixture(), slots = f.routeSlots.slice(0, 2); let state = use(f, 'strategy', placeChoice(slots)); state = dispatchTurn(state, f.definition);
    state = use(f, 'scheme', undefined, replaceChoice(slots[0]), state, 'p2'); state = dispatchTurn(state, f.definition);
    state = use(f, 'scheme', undefined, replaceChoice(slots[1]), state, 'p3'); state = dispatchTurn(state, f.definition);
    expect(ownerSlots(state)).toHaveLength(0); state = harvest(state, f.definition);
    const opened = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion }); expect(role(opened).used!.cleanupResolved).toBe(true); expect(getRoundTurn(opened, f.definition).actorId).toBe(null);
    const direct = finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }); const explicit = finishManagedRound(opened, f.definition, { expectedVersion: opened.stateVersion });
    expect(direct.board).toEqual(explicit.board); expect(direct.roundFlow).toEqual(explicit.roundFlow); expect(direct.roundFlow!.roundNumber).toBe(2);
  });
  it('does not open cleanup before all harvest plans, even when a delayed effect already exists', () => {
    const f = fixture(); let state = use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 2)));
    errorCode(() => openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion }), 'HARVEST_PENDING', RoleCleanupError);
    while (state.roundFlow!.stage === 'player-actions') state = dispatchTurn(state, f.definition);
    state = openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: 1 });
    state = applyHarvestCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
    errorCode(() => openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion }), 'HARVEST_PENDING', RoleCleanupError);
  });
  it('preserves unresolved obligations through saves and selects a marker at its new location after actual dispatch', () => {
    const f = fixture(); let state = use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 2)));
    state = parseGameState(JSON.parse(JSON.stringify(state)), f.definition); expect(role(state).used!.cleanupResolved).toBe(false);
    const markerId = state.board.influenceBySlot[f.routeSlots[0]!]!.markerId;
    state = roundSend(state, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'dispatch-influence', sourceSlotId: f.routeSlots[0], targetSlotId: f.routeSlots[2] });
    state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'finish-dispatch' });
    state = roundSend(state, f.definition, { type: 'finish-player-turn' }); state = harvest(state, f.definition);
    state = parseGameState(JSON.parse(JSON.stringify(state)), f.definition); expect(role(state).used!.cleanupResolved).toBe(false);
    state = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion });
    expect(getRoleCleanupOptions(state, f.definition, 'p1')).not.toContain(f.routeSlots[0]); expect(getRoleCleanupOptions(state, f.definition, 'p1')).toContain(f.routeSlots[2]);
    state = cleanupSend(state, f, f.routeSlots[2]!); expect(state.markerSupplyByPlayer.p1).toContain(markerId);
  });
  it('does not resolve a scheme-only role as though it owed a strategy removal', () => {
    const f = fixture(); let state = use(f, 'scheme', undefined, replaceChoice(undefined, 'decline'));
    state = harvest(state, f.definition); expect(role(state).used!.cleanupResolved).toBeUndefined();
    expect(finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }).roundFlow!.roundNumber).toBe(2);
  });
});

describe('strict cleanup authorization, replays, privacy and snapshot obligations', () => {
  it.each(['wrong-game', 'stale', 'wrong-owner', 'foreign-target', 'empty-target', 'overflow', 'override'] as const)('rejects %s cleanup without removing influence or resolving the obligation', problem => {
    const f = fixture(); let current = use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 2))); current = harvest(current, f.definition);
    current = openManagedCleanup(current, f.definition, { expectedVersion: current.stateVersion }); const state = gameStateSchema.parse(current);
    const payload: Record<string, unknown> = { ...env(state), type: 'resolve-role-cleanup', slotId: f.routeSlots[0] };
    if (problem === 'wrong-game') payload.gameId = 'other'; if (problem === 'stale') payload.expectedVersion = 0;
    if (problem === 'foreign-target') { put(state, f.routeSlots[3]!, 'p2'); payload.slotId = f.routeSlots[3]; }
    if (problem === 'empty-target') payload.slotId = f.routeSlots[4];
    if (problem === 'overflow') payload.expectedVersion = state.stateVersion = Number.MAX_SAFE_INTEGER;
    if (problem === 'override') payload.cleanupResolved = true;
    const before = structuredClone(state);
    const expected = problem === 'wrong-game' ? 'GAME_REFERENCE' : problem === 'stale' ? 'STALE_VERSION' : problem === 'wrong-owner' ? 'WRONG_ACTOR' : problem === 'overflow' ? 'VERSION_OVERFLOW' : problem === 'override' ? 'COMMAND_SCHEMA' : 'CLEANUP_TARGET';
    errorCode(() => applyRoleCleanupCommand(state, f.definition, { authenticatedPlayerId: problem === 'wrong-owner' ? 'p2' : 'p1' }, payload), expected, RoleCleanupError); expect(state).toEqual(before); expect(role(state).used!.cleanupResolved).toBe(false);
  });
  it('rejects replay and a second removal, and keeps the source obligation publicly visible', () => {
    const f = fixture(); let state = harvest(use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 2))), f.definition);
    state = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion });
    const payload = { ...env(state), type: 'resolve-role-cleanup', slotId: f.routeSlots[0] };
    const next = applyRoleCleanupCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, payload);
    errorCode(() => applyRoleCleanupCommand(next, f.definition, { authenticatedPlayerId: 'p1' }, payload), 'STALE_VERSION', RoleCleanupError);
    errorCode(() => applyRoleCleanupCommand(next, f.definition, { authenticatedPlayerId: 'p1' }, { ...payload, expectedVersion: next.stateVersion }), 'WRONG_ACTOR', RoleCleanupError);
    const view = getRoundPublicView(next, f.definition, 'p2'); expect(view.roles[0]!.usedRole).toMatchObject({ roleId: 'ROLE-01', cleanupResolved: true });
    expect(Object.hasOwn(view.roles[2]!, 'placedRoleId')).toBe(false); expect(Object.isFrozen(next.roundFlow!.rolesByPlayer[0]!.used)).toBe(true);
  });
  it.each(['missing', 'prematurely-resolved', 'old-format', 'scheme-with-obligation', 'unrelated-role', 'legacy-cleanup-stage'] as const)('rejects corrupt %s delayed state', problem => {
    const f = fixture(), state = gameStateSchema.parse(use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 2)))), used = state.roundFlow!.rolesByPlayer[0]!.used!;
    if (problem === 'missing') delete used.cleanupResolved;
    if (problem === 'prematurely-resolved') used.cleanupResolved = true;
    if (problem === 'old-format') state.schemaVersion = '1.8.0';
    if (problem === 'scheme-with-obligation') used.mode = 'scheme';
    if (problem === 'unrelated-role') { const roles = state.roundFlow!.rolesByPlayer[0]!; roles.hand = roles.hand.filter(id => id !== 'ROLE-02'); roles.hand.push('ROLE-01'); roles.discarded = ['ROLE-02']; used.roleId = 'ROLE-02'; }
    if (problem === 'legacy-cleanup-stage') { state.schemaVersion = '1.8.0'; state.roundFlow!.stage = 'cleanup'; state.roundFlow!.turnIndex = 6; }
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('does not permit role use or a new major action during cleanup', () => {
    const f = fixture(); let state = harvest(use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 2))), f.definition); state = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion });
    errorCode(() => use(f, 'scheme', undefined, replaceChoice(undefined, 'decline'), state), 'ROLE_WINDOW');
    errorCode(() => roundSend(state, f.definition, { type: 'choose-major-action', action: 'dispatch' }), 'MAJOR_ACTION_USED', RoundFlowError);
  });
  it('cannot bypass cleanup by calling any old trusted action/harvest window directly', () => {
    const f = fixture(); let state = harvest(use(f, 'strategy', placeChoice(f.routeSlots.slice(0, 2))), f.definition); state = openManagedCleanup(state, f.definition, { expectedVersion: state.stateVersion });
    for (const open of [openDeploymentWindow, openDispatchWindow, openExplorationWindow, openCityMoveWindow, openConstructionWindow]) {
      expect(() => open(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion })).toThrow('Managed round cannot reset decks or choose a different round');
      expect(() => open(state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion })).toThrow('Only the scheduled actor/action or scheduled harvest can open');
    }
    expect(() => openHarvestPhase(state, f.definition, { roundNumber: 1, expectedVersion: state.stateVersion })).toThrow('Only the scheduled actor/action or scheduled harvest can open');
  });
});
