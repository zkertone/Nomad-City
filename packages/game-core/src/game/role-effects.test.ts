import { describe, expect, it } from 'vitest';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { FOUNDERS_FACILITY_STOCK } from '../facilities/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, beginRoundFlow, applyRoundCommand, getRoundTurn,
  enableBaseRoleEffects, applyBaseRoleCommand, BaseRoleEffectError, getBaseRoleEffectSupport,
  gameStateSchema, validateGameState, parseGameState, getRoundPublicView, getMarkerLedger,
  openHarvestPhase, applyHarvestCommand, finishManagedRound, applyInfluenceCommand, applyExplorationCommand,
} from './index.js';
import type { GameDefinition, GameState, PlayerSetup } from './types.js';
const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const env = (state: GameState) => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
function roundSend(state: GameState, definition: GameDefinition, command: Record<string, unknown>) {
  return applyRoundCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), ...command });
}
function prepare(count = 3) {
  const game = createPreEntryGame('role-effects-test', seats.slice(0, count));
  const ids = (color: 'green' | 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(game.state, game.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (const [index, player] of seats.slice(0, count).entries()) {
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: 'p2' }, { ...env(state), type: 'choose-entry-influence', slotId: null });
  // Explicit resource fixture, not amounts claimed to be earned during entry.
  const funded = gameStateSchema.parse(state);
  for (const player of Object.values(funded.players)) player.balances = { orirock: 5, originium: 5, iron: 5, 'columbia-voucher': 30, 'pure-originium': 0 };
  state = beginRoundFlow(funded, game.definition, { expectedVersion: funded.stateVersion, facilityDeckOrder: ordinary, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  return { definition: game.definition, state };
}
function fixture(roleId = 'ROLE-02', count = 3, actorId = 'p1') {
  const game = prepare(count), old = game.state;
  let state = enableBaseRoleEffects(old, game.definition, { expectedVersion: old.stateVersion });
  while (state.roundFlow!.stage === 'role-removal') state = roundSend(state, game.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply[0] });
  while (state.roundFlow!.stage === 'role-placement') state = roundSend(state, game.definition, { type: 'place-round-role', roleId: getRoundTurn(state, game.definition).actorId === actorId ? roleId : 'ROLE-01' });
  while (getRoundTurn(state, game.definition).actorId !== actorId) state = dispatchTurn(state, game.definition);
  return { definition: game.definition, old, state, roleId, actorId };
}
function dispatchTurn(state: GameState, definition: GameDefinition) {
  state = roundSend(state, definition, { type: 'choose-major-action', action: 'dispatch' });
  if (state.influenceAction!.status === 'ready') state = applyInfluenceCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...env(state), type: 'finish-dispatch' });
  return roundSend(state, definition, { type: 'finish-player-turn' });
}
type Fixture = ReturnType<typeof fixture>;
type MutableState = ReturnType<typeof gameStateSchema.parse>;
const ownedRoles = (state: GameState, actorId = 'p1') => state.roundFlow!.rolesByPlayer.find(role => role.playerId === actorId)!;
function command(f: Fixture, choice?: Record<string, unknown>, mode = 'strategy', scheme?: Record<string, unknown>, state = f.state) {
  return { ...env(state), type: 'use-base-role', roleId: f.roleId, mode, ...(choice ? { strategyChoice: choice } : {}), ...(scheme ? { schemeChoice: scheme } : {}) };
}
const run = (f: Fixture, payload: unknown, state = f.state, actor = f.actorId) => applyBaseRoleCommand(state, f.definition, { authenticatedPlayerId: actor }, payload);
function code(fn: () => unknown, expected: string) {
  try { fn(); throw new Error('Expected role rejection'); }
  catch (error) { expect(error).toBeInstanceOf(BaseRoleEffectError); expect((error as BaseRoleEffectError).code).toBe(expected); }
}
function discard(state: MutableState, ids: readonly string[], actorId = 'p1') {
  const roles = state.roundFlow!.rolesByPlayer.find(role => role.playerId === actorId)!;
  for (const id of ids) { const index = roles.hand.findIndex(role => role === id); if (index < 0) throw Error('Invalid discard fixture'); roles.discarded.push(roles.hand.splice(index, 1)[0]!); }
}
function put(state: MutableState, slotId: string, actor = 'p1') {
  const markerId = state.markerSupplyByPlayer[actor]!.shift()!; state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: actor }; return markerId;
}
const emptySales = { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 };

function completedRound(state: GameState, definition: GameDefinition) {
  while (state.roundFlow!.stage === 'player-actions') state = dispatchTurn(state, definition);
  state = openHarvestPhase(state, definition, { expectedVersion: state.stateVersion, roundNumber: state.roundFlow!.roundNumber });
  for (const player of definition.players) state = applyHarvestCommand(state, definition, { authenticatedPlayerId: player.id }, { ...env(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return finishManagedRound(state, definition, { expectedVersion: state.stateVersion });
}

describe('explicit format upgrade and bounded complete role modes', () => {
  it('reports ten base modes independently of city styles and the full game', () => {
    expect(getBaseRoleEffectSupport()).toMatchObject({ supportedModeCount: 10, allBaseRoleEffectsImplemented: true,
      source: { printedPages: [8, 11, 13, 14] }, roles: [
        { roleId: 'ROLE-01', strategy: true, scheme: true }, { roleId: 'ROLE-02', strategy: true, scheme: true },
        { roleId: 'ROLE-03', strategy: true, scheme: true }, { roleId: 'ROLE-04', strategy: true, scheme: true }, { roleId: 'ROLE-05', strategy: true, scheme: true },
      ] });
  });
  it.each([2, 3, 4])('upgrades %i-player 1.7.0 without changing existing cards, resources or progress', count => {
    const f = prepare(count), before = structuredClone(f.state), next = enableBaseRoleEffects(f.state, f.definition, { expectedVersion: f.state.stateVersion });
    expect(next.schemaVersion).toBe('1.8.0'); expect(next.stateVersion).toBe(f.state.stateVersion + 1);
    expect(next.facilities).toEqual(before.facilities); expect(next.board).toEqual(before.board); expect(next.players).toEqual(before.players);
    expect(next.roundFlow!.rolesByPlayer.every(role => role.used === null)).toBe(true); expect(next.roundFlow!.stage).toBe(before.roundFlow!.stage);
    expect(f.state).toEqual(before); expect(parseGameState(JSON.parse(JSON.stringify(next)), f.definition)).toEqual(next);
    code(() => enableBaseRoleEffects(next, f.definition, { expectedVersion: next.stateVersion }), 'ROLE_FORMAT');
    code(() => enableBaseRoleEffects(f.state, f.definition, { expectedVersion: 0 }), 'STALE_VERSION');
  });
  it('does not implicitly upgrade an old snapshot while executing a role', () => {
    const f = fixture(), old = gameStateSchema.parse(f.state); old.schemaVersion = '1.7.0'; for (const role of old.roundFlow!.rolesByPlayer) delete role.used;
    code(() => run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }, 'strategy', undefined, old), old), 'ROLE_FORMAT');
  });
  it.each([['ROLE-01', 'strategy'], ['ROLE-01', 'scheme'], ['ROLE-02', 'scheme'], ['ROLE-03', 'scheme'], ['ROLE-04', 'scheme'], ['ROLE-02', 'both'], ['ROLE-03', 'both']] as const)('refuses a missing required format %s/%s before partially executing', (roleId, mode) => {
    const f = fixture(roleId), before = structuredClone(f.state); code(() => run(f, command(f, undefined, mode)), 'ROLE_FORMAT'); expect(f.state).toEqual(before);
  });
});

describe('Elysium least-resource strategy and Texas 12-voucher market cycle', () => {
  it.each(['orirock', 'originium', 'iron'] as const)('lets the player choose tied minimum %s and gains exactly four', asset => {
    const f = fixture(), next = run(f, command(f, { kind: 'minimum-resource', asset }));
    expect(next.players.p1!.balances[asset]).toBe(9); expect(next.players.p1!.balances['columbia-voucher']).toBe(30);
    expect(next.players.p1!.balances['pure-originium']).toBe(0); expect(next.stateVersion).toBe(f.state.stateVersion + 1);
    expect(ownedRoles(next)).toMatchObject({ placed: null, discarded: ['ROLE-02'], used: { roleId: 'ROLE-02', mode: 'strategy', turnIndex: 0 } });
    expect(next.roundFlow!.turnIndex).toBe(0); expect(next.roundFlow!.majorActionOpened).toBe(false);
  });
  it('checks current basic-resource minima, excluding money and pure originium', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state); state.players.p1!.balances.iron = 4;
    const before = structuredClone(state); code(() => run(f, command(f, { kind: 'minimum-resource', asset: 'orirock' }), state), 'MINIMUM_RESOURCE'); expect(state).toEqual(before);
    expect(run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }), state).players.p1!.balances.iron).toBe(8);
  });
  it.each([2, 3, 4])('bottoms the chosen market card and refills once in %i-player state', count => {
    const f = fixture('ROLE-03', count), supply = f.state.facilities!.supply, selected = supply.supply[2]!, top = supply.drawPile[0]!, before = structuredClone(f.state);
    const next = run(f, command(f, { kind: 'cycle-facility', cardId: selected }));
    expect(next.players.p1!.balances['columbia-voucher']).toBe(42); expect(next.facilities!.supply.drawPile).toEqual([...supply.drawPile.slice(1), selected]);
    expect(next.facilities!.supply.supply).toEqual([...supply.supply.filter(id => id !== selected), top]); expect(next.facilities!.supply.revision).toBe(supply.revision + 1);
    expect(next.facilities!.panels).toEqual(f.state.facilities!.panels); expect(next.facilities!.supply.playerHoldings).toEqual(supply.playerHoldings);
    expect(f.state).toEqual(before); expect(next.roundFlow!.turnIndex).toBe(0);
  });
  it('executes the explicitly documented empty-deck Texas case by immediately showing the same card again', () => {
    const f = fixture('ROLE-03'), state = gameStateSchema.parse(f.state), supply = state.facilities!.supply;
    supply.returnedToBox.push(...supply.drawPile.splice(0)); const selected = supply.supply[2]!;
    const next = run(f, command(f, { kind: 'cycle-facility', cardId: selected }), state);
    expect(next.facilities!.supply.supply).toEqual([...supply.supply.filter(id => id !== selected), selected]);
    expect(next.facilities!.supply.drawPile).toEqual([]); expect(next.players.p1!.balances['columbia-voucher']).toBe(42);
  });
  it('refuses hidden/nonmarket Texas targets without keeping the voucher gain', () => {
    const f = fixture('ROLE-03'), before = structuredClone(f.state);
    code(() => run(f, command(f, { kind: 'cycle-facility', cardId: f.state.facilities!.supply.drawPile[0] })), 'CARD_SOURCE'); expect(f.state).toEqual(before);
  });
});

describe('Cannot voluntary sales and Tin Man strategy alternatives', () => {
  it.each([['orirock', 3], ['originium', 3], ['iron', 4], ['pure-originium', 15]] as const)('sells %s at its independently verified rate %i', (asset, rate) => {
    const f = fixture('ROLE-04'), state = gameStateSchema.parse(f.state); state.players.p1!.balances[asset] = 3;
    const next = run(f, command(f, { kind: 'sell-resources', amounts: { ...emptySales, [asset]: 2 } }), state);
    expect(next.players.p1!.balances[asset]).toBe(1); expect(next.players.p1!.balances['columbia-voucher']).toBe(30 + rate * 2);
  });
  it('sells several kinds together and permits explicitly selling zero of every kind', () => {
    const f = fixture('ROLE-04'), state = gameStateSchema.parse(f.state); state.players.p1!.balances['pure-originium'] = 2;
    const next = run(f, command(f, { kind: 'sell-resources', amounts: { orirock: 1, originium: 2, iron: 3, 'pure-originium': 1 } }), state);
    expect(next.players.p1!.balances).toEqual({ orirock: 4, originium: 3, iron: 2, 'pure-originium': 1, 'columbia-voucher': 66 });
    const zero = run(f, command(f, { kind: 'sell-resources', amounts: emptySales })); expect(zero.players).toEqual(f.state.players); expect(ownedRoles(zero).used).not.toBe(null);
  });
  it('refuses overselling atomically', () => {
    const f = fixture('ROLE-04'), before = structuredClone(f.state);
    code(() => run(f, command(f, { kind: 'sell-resources', amounts: { ...emptySales, iron: 6 } })), 'INSUFFICIENT_RESOURCE'); expect(f.state).toEqual(before);
  });
  it('grants exactly one point rather than cash for the Tin Man point branch', () => {
    const f = fixture('ROLE-05'), next = run(f, command(f, { kind: 'tin-point' }));
    expect(next.players.p1!.score).toBe(f.state.players.p1!.score + 1); expect(next.players.p1!.balances).toEqual(f.state.players.p1!.balances);
  });
  it.each([[false, false, 0, 0], [true, false, 12, 1], [false, true, 15, 1], [true, true, 27, 2]] as const)('resolves explicit purchase decisions %s/%s in order', (payFirst, paySecond, spent, pure) => {
    const f = fixture('ROLE-05'), next = run(f, command(f, { kind: 'tin-purchases', payFirst, paySecond }));
    expect(next.players.p1!.balances['columbia-voucher']).toBe(30 - spent); expect(next.players.p1!.balances['pure-originium']).toBe(pure);
    expect(next.players.p1!.score).toBe(f.state.players.p1!.score);
  });
  it('cannot fund an earlier strategy condition with later scheme recovery money', () => {
    const f = fixture('ROLE-05'), state = gameStateSchema.parse(f.state); discard(state, ['ROLE-01', 'ROLE-02']); state.players.p1!.balances['columbia-voucher'] = 10;
    const before = structuredClone(state), rewards = [{ roleId: 'ROLE-01', kind: 'vouchers' }, { roleId: 'ROLE-02', kind: 'vouchers' }];
    code(() => run(f, command(f, { kind: 'tin-purchases', payFirst: true, paySecond: false }, 'both', { kind: 'recover-roles', rewards }), state), 'CANNOT_PAY'); expect(state).toEqual(before);
    const next = run(f, command(f, { kind: 'tin-purchases', payFirst: false, paySecond: false }, 'both', { kind: 'recover-roles', rewards }), state);
    expect(next.players.p1!.balances['columbia-voucher']).toBe(20); expect(next.players.p1!.balances['pure-originium']).toBe(0);
  });
});

describe('Tin Man recovery and one move per recovered card', () => {
  it('recovers all prior discards, excludes this Tin Man, and gives five per selected cash reward', () => {
    const f = fixture('ROLE-05'), state = gameStateSchema.parse(f.state); discard(state, ['ROLE-01', 'ROLE-02', 'ROLE-03', 'ROLE-04']);
    const rewards = ['ROLE-04', 'ROLE-03', 'ROLE-02', 'ROLE-01'].map(roleId => ({ roleId, kind: 'vouchers' }));
    const next = run(f, command(f, undefined, 'scheme', { kind: 'recover-roles', rewards }), state);
    expect(next.players.p1!.balances['columbia-voucher']).toBe(50); expect(ownedRoles(next).hand).toEqual(['ROLE-01', 'ROLE-02', 'ROLE-03', 'ROLE-04']);
    expect(ownedRoles(next).discarded).toEqual(['ROLE-05']); expect(ownedRoles(next).used!.mode).toBe('scheme');
  });
  it('permits empty recovery without fabricating a reward from the Tin Man itself', () => {
    const f = fixture('ROLE-05'), next = run(f, command(f, undefined, 'scheme', { kind: 'recover-roles', rewards: [] }));
    expect(next.players).toEqual(f.state.players); expect(ownedRoles(next).discarded).toEqual(['ROLE-05']); expect(ownedRoles(next).hand).toHaveLength(4);
  });
  it('moves the same existing marker twice as two separate recovered-card rewards, without dispatch fees or supply markers', () => {
    const f = fixture('ROLE-05'), state = gameStateSchema.parse(f.state); discard(state, ['ROLE-01', 'ROLE-02']); const markerId = put(state, 'route:F-route-01:slot:1');
    const supplyCount = state.markerSupplyByPlayer.p1!.length;
    const next = run(f, command(f, undefined, 'scheme', { kind: 'recover-roles', rewards: [
      { roleId: 'ROLE-01', kind: 'move-influence', sourceSlotId: 'route:F-route-01:slot:1', targetSlotId: 'route:R-route-01:slot:1' },
      { roleId: 'ROLE-02', kind: 'move-influence', sourceSlotId: 'route:R-route-01:slot:1', targetSlotId: 'node:A-01:slot:1' },
    ] }), state);
    expect(next.board.influenceBySlot['route:F-route-01:slot:1']).toBe(null); expect(next.board.influenceBySlot['route:R-route-01:slot:1']).toBe(null);
    expect(next.board.influenceBySlot['node:A-01:slot:1']!.markerId).toBe(markerId); expect(next.markerSupplyByPlayer.p1).toHaveLength(supplyCount);
    expect(next.players).toEqual(state.players); expect(next.roundFlow!.majorActionOpened).toBe(false); expect(Object.keys(getMarkerLedger(next, f.definition))).toHaveLength(90);
  });
  it.each(['missing', 'duplicate', 'current-card', 'foreign-discard'] as const)('rejects %s recovery rewards without partial recovery or discard', problem => {
    const f = fixture('ROLE-05'), state = gameStateSchema.parse(f.state); discard(state, ['ROLE-01', 'ROLE-02']); const before = structuredClone(state);
    const roles = problem === 'missing' ? ['ROLE-01'] : problem === 'duplicate' ? ['ROLE-01', 'ROLE-01'] : problem === 'current-card' ? ['ROLE-01', 'ROLE-05'] : ['ROLE-01', 'ROLE-03'];
    code(() => run(f, command(f, undefined, 'scheme', { kind: 'recover-roles', rewards: roles.map(roleId => ({ roleId, kind: 'vouchers' })) }), state), 'RECOVERY_CHOICES'); expect(state).toEqual(before);
  });
  it.each(['foreign-source', 'occupied', 'unexplored', 'opponent-city', 'reuse-old-source'] as const)('rejects %s movement, rolling back any earlier reward', problem => {
    const f = fixture('ROLE-05'), state = gameStateSchema.parse(f.state); discard(state, ['ROLE-01', 'ROLE-02']); put(state, 'route:F-route-01:slot:1', problem === 'foreign-source' ? 'p2' : 'p1');
    if (problem === 'occupied') put(state, 'route:R-route-01:slot:1', 'p2');
    const target = problem === 'unexplored' ? 'node:D-01:slot:1' : problem === 'opponent-city' ? 'node:A-02:slot:1' : 'route:R-route-01:slot:1';
    const rewards = problem === 'reuse-old-source' ? [
      { roleId: 'ROLE-01', kind: 'move-influence', sourceSlotId: 'route:F-route-01:slot:1', targetSlotId: 'route:R-route-01:slot:1' },
      { roleId: 'ROLE-02', kind: 'move-influence', sourceSlotId: 'route:F-route-01:slot:1', targetSlotId: 'node:A-01:slot:1' },
    ] : [{ roleId: 'ROLE-01', kind: 'vouchers' }, { roleId: 'ROLE-02', kind: 'move-influence', sourceSlotId: 'route:F-route-01:slot:1', targetSlotId: target }];
    const before = structuredClone(state); code(() => run(f, command(f, undefined, 'scheme', { kind: 'recover-roles', rewards }), state), problem === 'foreign-source' || problem === 'reuse-old-source' ? 'MOVE_SOURCE' : 'MOVE_TARGET'); expect(state).toEqual(before);
  });
  it('executes both Tin Man modes for the starting player and discards only once', () => {
    const f = fixture('ROLE-05'), state = gameStateSchema.parse(f.state); discard(state, ['ROLE-02']);
    const next = run(f, command(f, { kind: 'tin-purchases', payFirst: true, paySecond: true }, 'both', { kind: 'recover-roles', rewards: [{ roleId: 'ROLE-02', kind: 'vouchers' }] }), state);
    expect(next.players.p1!.balances['columbia-voucher']).toBe(8); expect(next.players.p1!.balances['pure-originium']).toBe(2);
    expect(ownedRoles(next).discarded).toEqual(['ROLE-05']); expect(ownedRoles(next).hand).toContain('ROLE-02'); expect(ownedRoles(next).used!.mode).toBe('both');
  });
  it('forbids both modes for a nonstarting player but permits their scheme alone', () => {
    const f = fixture('ROLE-05', 3, 'p2'), scheme = { kind: 'recover-roles', rewards: [] };
    code(() => run(f, command(f, { kind: 'tin-point' }, 'both', scheme)), 'STARTING_PLAYER_ONLY');
    expect(ownedRoles(run(f, command(f, undefined, 'scheme', scheme)), 'p2').used!.mode).toBe('scheme');
  });
  it('uses the rotated round starting player rather than the original first seat for both modes', () => {
    const f = fixture('ROLE-05', 3, 'p2'); let state = completedRound(f.state, f.definition);
    expect(state.playerOrder![0]).toBe('p2');
    while (getRoundTurn(state, f.definition).stage === 'role-removal') state = roundSend(state, f.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply.at(-1) });
    while (state.roundFlow!.stage === 'role-placement') state = roundSend(state, f.definition, { type: 'place-round-role', roleId: getRoundTurn(state, f.definition).actorId === 'p2' ? 'ROLE-05' : 'ROLE-01' });
    const current = { ...f, state };
    const next = run(current, command(current, { kind: 'tin-point' }, 'both', { kind: 'recover-roles', rewards: [] }));
    expect(ownedRoles(next, 'p2').used).toEqual({ roleId: 'ROLE-05', mode: 'both', turnIndex: 0 });
  });
});

describe('quick action timing, atomic failures, privacy and lifecycle integration', () => {
  it.each(['deploy', 'dispatch', 'explore', 'city-move', 'construct'] as const)('cannot interrupt an active %s major action, even untouched preparation', action => {
    const f = fixture(), initial = gameStateSchema.parse(f.state);
    if (action === 'dispatch') put(initial, 'route:F-route-01:slot:1');
    const state = roundSend(initial, f.definition, { type: 'choose-major-action', action }), before = structuredClone(state);
    code(() => run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }, 'strategy', undefined, state), state), 'ACTION_PENDING'); expect(state).toEqual(before);
  });
  it('cannot interrupt a revealed exploration event or end the turn before that event resolves', () => {
    const f = fixture(); let state = roundSend(f.state, f.definition, { type: 'choose-major-action', action: 'explore' });
    state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
    code(() => run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }, 'strategy', undefined, state), state), 'ACTION_PENDING');
  });
  it('cannot interrupt a dispatch after its first move although its progress remains ready', () => {
    const f = fixture(), initial = gameStateSchema.parse(f.state); put(initial, 'route:F-route-01:slot:1');
    let state = roundSend(initial, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'dispatch-influence', sourceSlotId: 'route:F-route-01:slot:1', targetSlotId: 'route:R-route-01:slot:1' });
    expect(state.influenceAction).toMatchObject({ operationsCompleted: 1, status: 'ready' });
    code(() => run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }, 'strategy', undefined, state), state), 'ACTION_PENDING');
  });
  it.each(['texas-cash', 'tin-pure', 'second-purchase-cost'] as const)('rolls back %s failure before discarding or exposing any effect', problem => {
    const f = fixture(problem === 'texas-cash' ? 'ROLE-03' : 'ROLE-05'), state = gameStateSchema.parse(f.state);
    if (problem === 'texas-cash') state.players.p1!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER;
    if (problem === 'tin-pure') state.players.p1!.balances['pure-originium'] = Number.MAX_SAFE_INTEGER;
    if (problem === 'second-purchase-cost') state.players.p1!.balances['columbia-voucher'] = 20;
    const payload = problem === 'texas-cash' ? command(f, { kind: 'cycle-facility', cardId: state.facilities!.supply.supply[0] }) : command(f, { kind: 'tin-purchases', payFirst: true, paySecond: true });
    const before = structuredClone(state); code(() => run(f, payload, state), problem === 'second-purchase-cost' ? 'CANNOT_PAY' : 'BALANCE_OVERFLOW'); expect(state).toEqual(before);
  });
  it('can act after a completed major action without granting another one and rejects once used', () => {
    const f = fixture(); const state = roundSend(f.state, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    const payload = command(f, { kind: 'minimum-resource', asset: 'iron' }, 'strategy', undefined, state), next = run(f, payload, state);
    expect(next.influenceAction).toEqual(state.influenceAction); expect(next.roundFlow!.majorActionOpened).toBe(true);
    code(() => run(f, payload, next), 'STALE_VERSION');
    code(() => run(f, { ...payload, expectedVersion: next.stateVersion }, next), 'ROLE_ALREADY_USED');
    const ended = roundSend(next, f.definition, { type: 'finish-player-turn' }); expect(ended.roundFlow!.turnIndex).toBe(1);
  });
  it('keeps a used role unavailable in the second cycle of the same round', () => {
    const f = fixture(); let state = run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }));
    for (let i = 0; i < 3; i++) state = dispatchTurn(state, f.definition);
    expect(getRoundTurn(state, f.definition)).toMatchObject({ actorId: 'p1', cycle: 2 });
    code(() => run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }, 'strategy', undefined, state), state), 'ROLE_ALREADY_USED');
  });
  it.each(['gain', 'score', 'sale-product', 'supply-version', 'state-version', 'late-recovery-gain'] as const)('rolls back %s overflow including all costs, recovered cards and discard', problem => {
    const f = fixture(problem === 'score' || problem === 'late-recovery-gain' ? 'ROLE-05' : problem === 'sale-product' ? 'ROLE-04' : problem === 'supply-version' ? 'ROLE-03' : 'ROLE-02');
    const state = gameStateSchema.parse(f.state); let payload = command(f, { kind: 'minimum-resource', asset: 'iron' }); let expected = 'BALANCE_OVERFLOW';
    if (problem === 'gain') { for (const asset of ['orirock', 'originium', 'iron'] as const) state.players.p1!.balances[asset] = Number.MAX_SAFE_INTEGER; }
    if (problem === 'score') { state.players.p1!.score = Number.MAX_SAFE_INTEGER; payload = command(f, { kind: 'tin-point' }); expected = 'SCORE_OVERFLOW'; }
    if (problem === 'sale-product') { state.players.p1!.balances.iron = Number.MAX_SAFE_INTEGER; payload = command(f, { kind: 'sell-resources', amounts: { ...emptySales, iron: Number.MAX_SAFE_INTEGER } }); }
    if (problem === 'supply-version') { state.facilities!.supply.revision = Number.MAX_SAFE_INTEGER; payload = command(f, { kind: 'cycle-facility', cardId: state.facilities!.supply.supply[0] }); expected = 'VERSION_OVERFLOW'; }
    if (problem === 'state-version') { state.stateVersion = Number.MAX_SAFE_INTEGER; payload.expectedVersion = state.stateVersion; expected = 'VERSION_OVERFLOW'; }
    if (problem === 'late-recovery-gain') { state.players.p1!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER - 5; discard(state, ['ROLE-01', 'ROLE-02']); payload = command(f, undefined, 'scheme', { kind: 'recover-roles', rewards: [{ roleId: 'ROLE-01', kind: 'vouchers' }, { roleId: 'ROLE-02', kind: 'vouchers' }] }); }
    const before = structuredClone(state); code(() => run(f, payload, state), expected); expect(state).toEqual(before); expect(ownedRoles(state).used).toBe(null);
  });
  it('publishes the used card only after a complete successful use; other facedown cards stay hidden', () => {
    const f = fixture(), next = run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }));
    const view = getRoundPublicView(next, f.definition, 'p2');
    expect(view.roles[0]).toMatchObject({ discarded: ['ROLE-02'], hasPlacedRole: false, usedRole: { roleId: 'ROLE-02', mode: 'strategy', turnIndex: 0 } });
    expect(Object.hasOwn(view.roles[0]!, 'hand')).toBe(false); expect(Object.hasOwn(view.roles[2]!, 'placedRoleId')).toBe(false);
    expect(Object.isFrozen(next.roundFlow!.rolesByPlayer[0]!.discarded)).toBe(true); expect(parseGameState(JSON.parse(JSON.stringify(next)), f.definition)).toEqual(next);
  });
  it('preserves real discard history across cleanup and recovers it with a later-round Tin Man', () => {
    const f = fixture(); let state = run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }));
    state = completedRound(state, f.definition);
    expect(state.schemaVersion).toBe('1.8.0'); expect(state.playerOrder![0]).toBe('p2'); expect(ownedRoles(state)).toMatchObject({ placed: null, discarded: ['ROLE-02'], used: null });
    expect(ownedRoles(state).hand).not.toContain('ROLE-02');
    while (getRoundTurn(state, f.definition).stage === 'role-removal') state = roundSend(state, f.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply.at(-1) });
    while (state.roundFlow!.stage === 'role-placement') state = roundSend(state, f.definition, { type: 'place-round-role', roleId: getRoundTurn(state, f.definition).actorId === 'p1' ? 'ROLE-05' : 'ROLE-01' });
    state = dispatchTurn(state, f.definition); state = dispatchTurn(state, f.definition);
    const tin = { ...f, roleId: 'ROLE-05', state }, cash = state.players.p1!.balances['columbia-voucher'];
    state = run(tin, command(tin, undefined, 'scheme', { kind: 'recover-roles', rewards: [{ roleId: 'ROLE-02', kind: 'vouchers' }] }));
    expect(state.players.p1!.balances['columbia-voucher']).toBe(cash + 5); expect(ownedRoles(state).hand).toContain('ROLE-02'); expect(ownedRoles(state).discarded).toEqual(['ROLE-05']);
    state = completedRound(state, f.definition); expect(ownedRoles(state).used).toBe(null); expect(ownedRoles(state).discarded).toEqual(['ROLE-05']); expect(state.roundFlow!.roundNumber).toBe(3);
  });
});

describe('strict command and used-role snapshot integrity', () => {
  it.each(['actorId', 'free', 'amount', 'rate', 'score', 'roleEffectResolved', 'turnIndex'])('rejects client override %s', key => {
    const f = fixture(); code(() => run(f, { ...command(f, { kind: 'minimum-resource', asset: 'iron' }), [key]: 1 }), 'COMMAND_SCHEMA');
  });
  it.each(['missing', 'wrong-kind', 'extra-scheme', 'wrong-role', 'wrong-game', 'wrong-actor', 'stale'] as const)('rejects %s role selection without discarding', problem => {
    const f = fixture(), payload: Record<string, unknown> = command(f, { kind: 'minimum-resource', asset: 'iron' }); let expected = '';
    if (problem === 'missing') { delete payload.strategyChoice; expected = 'ROLE_CHOICES'; }
    if (problem === 'wrong-kind') { payload.strategyChoice = { kind: 'tin-point' }; expected = 'ROLE_CHOICES'; }
    if (problem === 'extra-scheme') { payload.schemeChoice = { kind: 'recover-roles', rewards: [] }; expected = 'ROLE_CHOICES'; }
    if (problem === 'wrong-role') { payload.roleId = 'ROLE-03'; expected = 'PLACED_ROLE'; }
    if (problem === 'wrong-game') { payload.gameId = 'other'; expected = 'GAME_REFERENCE'; }
    if (problem === 'wrong-actor') expected = 'ROLE_WINDOW';
    if (problem === 'stale') { payload.expectedVersion = 0; expected = 'STALE_VERSION'; }
    const before = structuredClone(f.state); code(() => run(f, payload, f.state, problem === 'wrong-actor' ? 'p2' : 'p1'), expected); expect(f.state).toEqual(before);
  });
  it.each(['missing-use-field', 'old-version', 'not-discarded', 'unimplemented-mode', 'future-turn', 'wrong-player-turn', 'placed-and-used', 'bad-both'])('rejects tampered %s used records', problem => {
    const f = fixture(), state = gameStateSchema.parse(run(f, command(f, { kind: 'minimum-resource', asset: 'iron' }))), roles = state.roundFlow!.rolesByPlayer[0]!;
    if (problem === 'missing-use-field') delete roles.used;
    if (problem === 'old-version') state.schemaVersion = '1.7.0';
    if (problem === 'not-discarded') roles.used!.roleId = 'ROLE-03';
    if (problem === 'unimplemented-mode') roles.used!.mode = 'scheme';
    if (problem === 'future-turn') roles.used!.turnIndex = 3;
    if (problem === 'wrong-player-turn') roles.used!.turnIndex = 1;
    if (problem === 'placed-and-used') { roles.placed = roles.discarded.pop()!; }
    if (problem === 'bad-both') roles.used!.mode = 'both';
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
});
