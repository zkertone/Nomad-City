import { describe, expect, it } from 'vitest';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { FOUNDERS_FACILITY_STOCK } from '../facilities/index.js';
import {
  FOUNDERS_BASE_ROLES, ROUND_RULE_SOURCE, beginRoundFlow, applyRoundCommand, getRoundTurn, finishManagedRound, getRoundPublicView,
  createPreEntryGame, beginEntry, applyEntryCommand, gameStateSchema, parseGameState, validateGameState,
  openDeploymentWindow, openDispatchWindow, applyInfluenceCommand, getDeploymentSlotIds,
  openExplorationWindow, applyExplorationCommand, getExplorationFinalSlotIds,
  openCityMoveWindow, applyCityMoveCommand, getCityMoveOptions, getCityMoveFinalSlotIds,
  openConstructionWindow, applyConstructionCommand, openHarvestPhase, applyHarvestCommand,
  getGamePosition, getEventChoiceRequirements, getMarkerLedger, RoundFlowError,
} from './index.js';
import type { GameDefinition, GameState, PlayerSetup } from './types.js';
const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
const admin = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-013')!.id;
function entered(count = 3, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const game = createPreEntryGame('round-test', players);
  const ids = (color: 'green' | 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(game.state, game.definition, { startingPlayerId: players[0]!.id, clockwisePlayerIds: players.map(player => player.id),
    expectedVersion: 0, greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (const [index, player] of players.entries()) {
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: player.id }, { type: 'select-initial-node', gameId: state.gameId,
      expectedVersion: state.stateVersion, nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: player.id }, { type: 'choose-green-event', gameId: state.gameId,
      expectedVersion: state.stateVersion, choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: players[1]!.id }, { type: 'choose-entry-influence', gameId: state.gameId,
    expectedVersion: state.stateVersion, slotId: null });
  // Funding fixture only, not a claimed result of these entry choices.
  const funded = gameStateSchema.parse(state);
  for (const player of Object.values(funded.players)) for (const asset of ['orirock', 'originium', 'iron', 'columbia-voucher', 'pure-originium'] as const) player.balances[asset] = 50;
  return { definition: game.definition, state: parseGameState(funded, game.definition), options: { expectedVersion: funded.stateVersion,
    facilityDeckOrder: [admin, ...ordinary.filter(id => id !== admin)], deckOrder: { yellow: ids('yellow'), red: ids('red') } } };
}
function fixture(count = 3, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const e = entered(count, players); return { ...e, entry: e.state, state: beginRoundFlow(e.state, e.definition, e.options) };
}
const envelope = (state: GameState) => ({ gameId: state.gameId, expectedVersion: state.stateVersion });
function send(state: GameState, definition: GameDefinition, command: Record<string, unknown>, actorId = getRoundTurn(state, definition).actorId!) {
  return applyRoundCommand(state, definition, { authenticatedPlayerId: actorId }, { ...envelope(state), ...command });
}
function ready(state: GameState, definition: GameDefinition): GameState {
  while (state.roundFlow!.stage === 'role-removal') state = send(state, definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply[0]! });
  while (state.roundFlow!.stage === 'role-placement') state = send(state, definition, { type: 'place-round-role', roleId: 'ROLE-01' });
  return state;
}
function twoCycles(state: GameState, definition: GameDefinition) {
  while (state.roundFlow!.stage === 'player-actions') {
    state = send(state, definition, { type: 'choose-major-action', action: 'dispatch' });
    // Existing dispatch correctly auto-completes with no board influence to move.
    if (state.influenceAction!.status === 'ready') state = applyInfluenceCommand(state, definition, { authenticatedPlayerId: getRoundTurn(state, definition).actorId! }, { ...envelope(state), type: 'finish-dispatch' });
    state = send(state, definition, { type: 'finish-player-turn' });
  }
  return state;
}
function harvested(state: GameState, definition: GameDefinition) {
  state = openHarvestPhase(state, definition, { expectedVersion: state.stateVersion, roundNumber: state.roundFlow!.roundNumber });
  for (const player of definition.players) state = applyHarvestCommand(state, definition, { authenticatedPlayerId: player.id }, { ...envelope(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
  return state;
}
function errorCode(fn: () => unknown, code: string, roundError = true) {
  try { fn(); throw new Error('Expected round rejection'); }
  catch (error) { if (roundError) expect(error).toBeInstanceOf(RoundFlowError); expect((error as { code: string }).code).toBe(code); }
}
function firstChoice(state: GameState, definition: GameDefinition, actorId: string, cardId: string, nodeId: string) {
  const choiceId = `${cardId}:1`, requirements = getEventChoiceRequirements(getGamePosition(state, definition), definition, { gameId: state.gameId, actorId, cardId, nodeId }, choiceId);
  return { choiceId, ...(requirements.requiresCostDecision ? { costDecision: 'pay' as const } : {}),
    ...(requirements.legalInfluenceSlotIds.length ? { influenceSlotId: requirements.legalInfluenceSlotIds[0]! } : {}) };
}

describe('verified base role identities and new managed round setup', () => {
  it('preserves exactly the five initial base roles without enterprise or Infected additions', () => {
    expect(FOUNDERS_BASE_ROLES).toEqual([{ id: 'ROLE-01', name: '雷蛇' }, { id: 'ROLE-02', name: '极境' }, { id: 'ROLE-03', name: '德克萨斯' }, { id: 'ROLE-04', name: '坎诺特' }, { id: 'ROLE-05', name: '锡人' }]);
    expect(ROUND_RULE_SOURCE.printedPages).toEqual([3, 4, 5, 8, 10, 11, 14, 23]); expect(ROUND_RULE_SOURCE.roleEffectsImplemented).toBe(true);
    expect(Object.isFrozen(FOUNDERS_BASE_ROLES[0])).toBe(true);
  });
  it.each([2, 3, 4])('starts %i players only after real entry and conserves all setup facts', count => {
    const f = fixture(count);
    expect(f.state.schemaVersion).toBe('1.7.0'); expect(f.state.phase).toBe('round-control');
    expect(f.state.stateVersion).toBe(f.entry.stateVersion + 1); expect(f.state.players).toEqual(f.entry.players);
    expect(f.state.board).toEqual(f.entry.board); expect(f.state.markerSupplyByPlayer).toEqual(f.entry.markerSupplyByPlayer);
    expect(f.state.playerOrder).toEqual(f.entry.entry!.playerOrder); expect(f.state.eventDecks!.green).toEqual(f.entry.entry!.remainingGreenEventIds);
    expect(f.state.roundFlow!.stage).toBe(count === 2 ? 'role-removal' : 'role-placement'); expect(f.state.roundFlow!.roundNumber).toBe(1);
    expect(f.state.roundFlow!.rolesByPlayer.every(role => role.hand.length === 5 && role.discarded.length === 0 && role.placed === null)).toBe(true);
    expect(f.state.facilities!.supply.supply).toHaveLength(6); expect(f.state.facilities!.supply.drawPile).toHaveLength(35);
    expect(Object.keys(getMarkerLedger(f.state, f.definition))).toHaveLength(count * 30);
    expect(parseGameState(JSON.parse(JSON.stringify(f.state)), f.definition)).toEqual(f.state);
  });
  it('rejects premature/repeated/legacy in-progress initialization and wrong options atomically', () => {
    const f = fixture(), before = structuredClone(f.state), setup = createPreEntryGame('round-test', seats.slice(0, 3));
    errorCode(() => beginRoundFlow(setup.state, setup.definition, { ...f.options, expectedVersion: 0 }), 'ROUND_START');
    errorCode(() => beginRoundFlow(f.state, f.definition, { ...f.options, expectedVersion: f.state.stateVersion }), 'ROUND_START');
    errorCode(() => beginRoundFlow(f.entry, f.definition, { ...f.options, expectedVersion: 0 }), 'STALE_VERSION');
    errorCode(() => beginRoundFlow(f.entry, f.definition, { ...f.options, facilityDeckOrder: ordinary.map(() => ordinary[0]!) }), 'FACILITY_SETUP');
    errorCode(() => beginRoundFlow(f.entry, f.definition, { ...f.options, facilityDeckOrder: [] }), 'OPTIONS_SCHEMA');
    const legacy = openDeploymentWindow(f.entry, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: f.entry.stateVersion });
    errorCode(() => beginRoundFlow(legacy, f.definition, { ...f.options, expectedVersion: legacy.stateVersion }), 'ROUND_START');
    expect(f.state).toEqual(before); expect(legacy.schemaVersion).toBe('1.4.0');
  });
});

describe('role placement and two-player supply removals', () => {
  it.each([3, 4])('places one facedown role in clockwise order for %i players before any action', count => {
    const f = fixture(count); let state = f.state;
    for (const [index, player] of f.definition.players.entries()) {
      expect(getRoundTurn(state, f.definition).actorId).toBe(player.id);
      errorCode(() => send(state, f.definition, { type: 'choose-major-action', action: 'deploy' }), 'MAJOR_ACTION_USED');
      errorCode(() => send(state, f.definition, { type: 'place-round-role', roleId: 'ROLE-01' }, index === 0 ? 'p2' : 'p1'), 'WRONG_ACTOR');
      state = send(state, f.definition, { type: 'place-round-role', roleId: 'ROLE-01' });
      expect(state.roundFlow!.rolePlacementCount).toBe(index + 1);
    }
    expect(state.roundFlow!.stage).toBe('player-actions'); expect(getRoundTurn(state, f.definition)).toMatchObject({ actorId: 'p1', cycle: 1, majorActionStatus: 'not-started' });
    expect(state.roundFlow!.rolesByPlayer.every(role => role.hand.length === 4 && role.placed === 'ROLE-01')).toBe(true);
    // Identical named roles belong to different players; they are distinct personal copies.
    expect(validateGameState(state, f.definition).success).toBe(true);
  });
  it('removes two chosen market cards and immediately refills each before either role placement', () => {
    const f = fixture(2), before = structuredClone(f.state); let state = f.state;
    errorCode(() => send(state, f.definition, { type: 'place-round-role', roleId: 'ROLE-01' }), 'ROUND_STAGE');
    errorCode(() => send(state, f.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.drawPile[0] }), 'CARD_SOURCE');
    const first = state.facilities!.supply.supply[0]!, nextTop = state.facilities!.supply.drawPile[0]!;
    state = send(state, f.definition, { type: 'remove-round-supply-card', cardId: first });
    expect(state.facilities!.supply.returnedToBox).toEqual([first]); expect(state.facilities!.supply.supply).toHaveLength(6);
    expect(state.facilities!.supply.supply).toContain(nextTop); expect(state.facilities!.supply.revision).toBe(1);
    expect(getRoundTurn(state, f.definition).actorId).toBe('p2'); expect(state.roundFlow!.stage).toBe('role-removal');
    state = send(state, f.definition, { type: 'remove-round-supply-card', cardId: nextTop });
    expect(state.facilities!.supply.returnedToBox).toEqual([first, nextTop]); expect(state.facilities!.supply.drawPile).toHaveLength(33);
    expect(state.facilities!.supply.revision).toBe(2); expect(state.roundFlow!.stage).toBe('role-placement');
    expect(getRoundTurn(state, f.definition).actorId).toBe('p1'); expect(f.state).toEqual(before);
  });
  it.each([3, 4])('forbids two-player removal for %i players', count => {
    const f = fixture(count); errorCode(() => send(f.state, f.definition, { type: 'remove-round-supply-card', cardId: f.state.facilities!.supply.supply[0] }), 'ROUND_STAGE');
  });
  it('does not use a discarded role while the hand still has a card, and recovers only an empty hand', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), roles = state.roundFlow!.rolesByPlayer[0]!;
    roles.discarded.push(roles.hand.pop()!); const before = structuredClone(state);
    errorCode(() => send(state, f.definition, { type: 'place-round-role', roleId: 'ROLE-05' }), 'ROLE_NOT_IN_HAND'); expect(state).toEqual(before);
    roles.discarded.push(...roles.hand.splice(0));
    const next = send(state, f.definition, { type: 'place-round-role', roleId: 'ROLE-05' });
    expect(next.roundFlow!.rolesByPlayer[0]).toMatchObject({ hand: expect.arrayContaining(['ROLE-01', 'ROLE-02', 'ROLE-03', 'ROLE-04']), discarded: [], placed: 'ROLE-05' });
    // Inventory fixture only: role-effect execution that would produce discards is not implemented.
  });
  it.each(['draw-empty', 'revision-overflow'] as const)('rejects %s removal without losing the selected card or advancing', problem => {
    const f = fixture(2), state = gameStateSchema.parse(f.state);
    if (problem === 'draw-empty') state.facilities!.supply.returnedToBox.push(...state.facilities!.supply.drawPile.splice(0));
    else state.facilities!.supply.revision = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(state);
    errorCode(() => send(state, f.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply[0] }), problem === 'draw-empty' ? 'REFILL_UNRESOLVED' : 'VERSION_OVERFLOW');
    expect(state).toEqual(before);
  });
  it('hides opponents hands and facedown selections and the facility draw order', () => {
    const f = fixture(); let state = send(f.state, f.definition, { type: 'place-round-role', roleId: 'ROLE-01' });
    state = send(state, f.definition, { type: 'place-round-role', roleId: 'ROLE-02' });
    const before = JSON.stringify(state), view = getRoundPublicView(state, f.definition, 'p1');
    expect(view.roles[0]).toMatchObject({ hand: ['ROLE-02', 'ROLE-03', 'ROLE-04', 'ROLE-05'], placedRoleId: 'ROLE-01' });
    expect(view.roles[1]).toEqual({ playerId: 'p2', handCount: 4, discarded: [], hasPlacedRole: true });
    expect(view.roles[2]).toEqual({ playerId: 'p3', handCount: 5, discarded: [], hasPlacedRole: false });
    expect(Object.hasOwn(view.facilitySupply, 'drawPile')).toBe(false); expect(Object.hasOwn(view, 'eventDecks')).toBe(false);
    expect(JSON.stringify(state)).toBe(before); expect(Object.isFrozen(view.roles[0])).toBe(true);
    errorCode(() => getRoundPublicView(state, f.definition, 'unknown'), 'VIEWER_REFERENCE');
  });
});

describe('two cycles and no alternate grant bypass', () => {
  it.each([2, 3, 4])('permits exactly two clockwise cycles for %i players', count => {
    const f = fixture(count); let state = ready(f.state, f.definition); const actors: string[] = [], cycles: number[] = [];
    for (let index = 0; index < count * 2; index++) {
      const turn = getRoundTurn(state, f.definition); actors.push(turn.actorId!); cycles.push(turn.cycle!);
      errorCode(() => send(state, f.definition, { type: 'finish-player-turn' }), 'ACTION_PENDING');
      const before = structuredClone(state);
      errorCode(() => send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' }, turn.actorId === 'p1' ? 'p2' : 'p1'), 'WRONG_ACTOR');
      expect(state).toEqual(before);
      state = send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' });
      expect(getRoundTurn(state, f.definition).majorActionStatus).toBe('complete');
      errorCode(() => send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' }), 'MAJOR_ACTION_USED');
      state = send(state, f.definition, { type: 'finish-player-turn' });
      expect(state.roundFlow!.turnIndex).toBe(index + 1);
    }
    expect(actors).toEqual([...f.state.playerOrder!, ...f.state.playerOrder!]); expect(cycles).toEqual([...Array(count).fill(1), ...Array(count).fill(2)]);
    expect(state.roundFlow!.stage).toBe('harvest'); expect(getRoundTurn(state, f.definition).actorId).toBe(null);
    errorCode(() => send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' }, 'p1'), 'WRONG_ACTOR');
  });
  it.each(['deploy', 'dispatch', 'explore', 'city-move', 'construct'] as const)('opens %s as exactly one scheduled grant preserving format and round cursor', action => {
    const f = fixture(), state = ready(f.state, f.definition), next = send(state, f.definition, { type: 'choose-major-action', action });
    expect(next.schemaVersion).toBe('1.7.0'); expect(next.stateVersion).toBe(state.stateVersion + 1);
    expect(next.roundFlow).toEqual({ ...state.roundFlow, majorActionOpened: true }); expect(next.facilities).toEqual(state.facilities);
    expect(getRoundTurn(next, f.definition).majorActionStatus).toBe(action === 'dispatch' ? 'complete' : 'pending');
    if (action !== 'dispatch') errorCode(() => send(next, f.definition, { type: 'finish-player-turn' }), 'ACTION_PENDING');
  });
  it('enforces the schedule through all old trusted window APIs too', () => {
    const f = fixture(), state = ready(f.state, f.definition);
    for (const open of [openDeploymentWindow, openDispatchWindow, openExplorationWindow, openCityMoveWindow, openConstructionWindow]) {
      errorCode(() => open(f.state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: f.state.stateVersion }), 'ROUND_WINDOW', false);
      errorCode(() => open(state, f.definition, { actorId: 'p2', roundNumber: 1, expectedVersion: state.stateVersion }), 'ROUND_WINDOW', false);
      errorCode(() => open(state, f.definition, { actorId: 'p1', roundNumber: 2, expectedVersion: state.stateVersion }), 'ROUND_WINDOW', false);
    }
    const used = openDispatchWindow(state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion });
    for (const open of [openDeploymentWindow, openDispatchWindow, openExplorationWindow, openCityMoveWindow, openConstructionWindow]) {
      errorCode(() => open(used, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: used.stateVersion }), 'ROUND_WINDOW', false);
    }
    errorCode(() => openHarvestPhase(state, f.definition, { roundNumber: 1, expectedVersion: state.stateVersion }), 'ROUND_WINDOW', false);
    errorCode(() => openDispatchWindow(state, f.definition, { actorId: 'p1', roundNumber: 1, expectedVersion: state.stateVersion, deckOrder: { yellow: [], red: [] } }), 'ROUND_WINDOW', false);
  });
  it('does not consume the turn or major slot on failed underlying construction', () => {
    const f = fixture(); let state = send(ready(f.state, f.definition), f.definition, { type: 'choose-major-action', action: 'construct' });
    const before = structuredClone(state), actor = { authenticatedPlayerId: 'p1' };
    const command = { ...envelope(state), type: 'construct-facility', cardId: admin, cellId: 'CP-3-2', paymentMode: 'vouchers' };
    errorCode(() => applyConstructionCommand(state, f.definition, actor, command), 'PLACEMENT_INVALID', false); expect(state).toEqual(before);
    errorCode(() => send(state, f.definition, { type: 'finish-player-turn' }), 'ACTION_PENDING');
    state = applyConstructionCommand(state, f.definition, actor, { ...command, cellId: 'CP-1-1' });
    expect(state.roundFlow!.turnIndex).toBe(0); expect(getRoundTurn(state, f.definition).majorActionStatus).toBe('complete');
    expect(send(state, f.definition, { type: 'finish-player-turn' }).roundFlow!.turnIndex).toBe(1);
  });
  it.each(['deploy', 'explore', 'city-move', 'construct'] as const)('can cancel untouched %s preparation without undoing facts or advancing the turn', action => {
    const f = fixture(), state = ready(f.state, f.definition), pending = send(state, f.definition, { type: 'choose-major-action', action });
    const next = send(pending, f.definition, { type: 'cancel-major-preparation' });
    expect(next.stateVersion).toBe(pending.stateVersion + 1); expect(next.roundFlow).toEqual(state.roundFlow);
    expect(next.players).toEqual(state.players); expect(next.board).toEqual(state.board); expect(next.facilities).toEqual(state.facilities); expect(next.eventDecks).toEqual(state.eventDecks);
    const completed = send(next, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    errorCode(() => send(completed, f.definition, { type: 'cancel-major-preparation' }), 'ACTION_STARTED');
    expect(send(completed, f.definition, { type: 'finish-player-turn' }).roundFlow!.turnIndex).toBe(1);
  });
  it('cannot cancel exploration after paying and revealing an event', () => {
    const f = fixture(); let state = send(ready(f.state, f.definition), f.definition, { type: 'choose-major-action', action: 'explore' });
    state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...envelope(state), type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
    const before = structuredClone(state); errorCode(() => send(state, f.definition, { type: 'cancel-major-preparation' }), 'ACTION_STARTED'); expect(state).toEqual(before);
  });
  it('can cancel zero-step dispatch but cannot cancel after its first actual move', () => {
    const f = fixture(); let state = send(ready(f.state, f.definition), f.definition, { type: 'choose-major-action', action: 'deploy' });
    state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...envelope(state), type: 'deploy-influence', slotId: 'route:F-route-01:slot:1' });
    state = send(state, f.definition, { type: 'finish-player-turn' });
    // Complete the remaining first-cycle turns so p1 gets its second scheduled turn.
    for (let i = 0; i < 2; i++) { state = send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' }); state = send(state, f.definition, { type: 'finish-player-turn' }); }
    state = send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    const canceled = send(state, f.definition, { type: 'cancel-major-preparation' });
    expect(canceled.roundFlow!.turnIndex).toBe(3); expect(canceled.board).toEqual(state.board);
    state = send(canceled, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...envelope(state), type: 'dispatch-influence', sourceSlotId: 'route:F-route-01:slot:1', targetSlotId: 'node:A-01:slot:1' });
    expect(state.influenceAction).toMatchObject({ status: 'ready', operationsCompleted: 1 });
    const before = structuredClone(state); errorCode(() => send(state, f.definition, { type: 'cancel-major-preparation' }), 'ACTION_STARTED'); expect(state).toEqual(before);
  });
  it('supports every implemented major action through a real scheduled six-turn round', () => {
    const f = fixture(); let state = ready(f.state, f.definition);
    state = send(state, f.definition, { type: 'choose-major-action', action: 'construct' });
    state = applyConstructionCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...envelope(state), type: 'construct-facility', cardId: admin, cellId: 'CP-1-1', paymentMode: 'vouchers' });
    const facilities = state.facilities; state = send(state, f.definition, { type: 'finish-player-turn' });
    state = send(state, f.definition, { type: 'choose-major-action', action: 'deploy' });
    state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p2' }, { ...envelope(state), type: 'deploy-influence', slotId: getDeploymentSlotIds(state, f.definition, 'p2')[0] });
    state = send(state, f.definition, { type: 'finish-player-turn' });
    state = send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' }); state = send(state, f.definition, { type: 'finish-player-turn' });
    state = send(state, f.definition, { type: 'choose-major-action', action: 'explore' });
    state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...envelope(state), type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
    state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...envelope(state), type: 'choose-exploration-event',
      choice: firstChoice(state, f.definition, 'p1', state.exploration!.cardId!, 'D-01') });
    if (state.exploration!.status === 'final-influence') state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { ...envelope(state), type: 'place-exploration-influence', slotId: getExplorationFinalSlotIds(state, f.definition, 'p1')[0] });
    state = send(state, f.definition, { type: 'finish-player-turn' });
    state = send(state, f.definition, { type: 'choose-major-action', action: 'city-move' }); const move = getCityMoveOptions(state, f.definition, 'p2')[0]!;
    state = applyCityMoveCommand(state, f.definition, { authenticatedPlayerId: 'p2' }, { ...envelope(state), type: 'move-city', ...move });
    if (state.cityMove!.status === 'event-choice') state = applyCityMoveCommand(state, f.definition, { authenticatedPlayerId: 'p2' }, { ...envelope(state), type: 'choose-city-move-event', choice: firstChoice(state, f.definition, 'p2', state.cityMove!.cardId!, state.cityMove!.targetNodeId!) });
    if (state.cityMove!.status === 'final-influence') state = applyCityMoveCommand(state, f.definition, { authenticatedPlayerId: 'p2' }, { ...envelope(state), type: 'place-city-move-influence', slotId: getCityMoveFinalSlotIds(state, f.definition, 'p2')[0] });
    state = send(state, f.definition, { type: 'finish-player-turn' }); state = send(state, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    state = send(state, f.definition, { type: 'finish-player-turn' }); state = harvested(state, f.definition);
    expect(state.harvest!.status).toBe('complete'); expect(state.facilities).toEqual(facilities); expect(state.players.p1!.score).toBe(f.entry.players.p1!.score + 3);
    state = finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion });
    expect(state.playerOrder).toEqual(['p2', 'p3', 'p1']); expect(state.roundFlow!.roundNumber).toBe(2); expect(state.facilities).toEqual(facilities);
  });
});

describe('harvest, cleanup, role return, starting-player rotation and eight-round stop', () => {
  it.each([2, 3, 4])('runs all eight rounds for %i players without skipping roles, turns, collection or cleanup', count => {
    const f = fixture(count); let state = f.state;
    const balances = state.players;
    for (let round = 1; round <= 8; round++) {
      expect(state.roundFlow!.roundNumber).toBe(round); expect(state.playerOrder![0]).toBe(seats[(round - 1) % count]!.id);
      state = ready(state, f.definition); state = twoCycles(state, f.definition);
      errorCode(() => finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), 'HARVEST_PENDING');
      state = openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: round });
      for (const [index, player] of f.definition.players.entries()) {
        if (index < count) errorCode(() => finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), 'HARVEST_PENDING');
        state = applyHarvestCommand(state, f.definition, { authenticatedPlayerId: player.id }, { ...envelope(state), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
      }
      const before = structuredClone(state); state = finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion });
      expect(state.stateVersion).toBe(before.stateVersion + 1); expect(before.harvest!.status).toBe('complete');
      expect(state.roundFlow!.rolesByPlayer.every(role => role.hand.length === 5 && role.placed === null && role.discarded.length === 0)).toBe(true);
      expect(state.players).toEqual(balances); expect(state.schemaVersion).toBe('1.7.0');
      state = parseGameState(JSON.parse(JSON.stringify(state)), f.definition);
    }
    expect(state.roundFlow!.stage).toBe('finished'); expect(state.roundFlow!.roundNumber).toBe(8); expect(getRoundTurn(state, f.definition).actorId).toBe(null);
    expect(state.facilities!.supply.returnedToBox).toHaveLength(count === 2 ? 16 : 0);
    expect(state.facilities!.supply.drawPile).toHaveLength(count === 2 ? 19 : 35);
    errorCode(() => finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), 'HARVEST_PENDING');
    errorCode(() => openDispatchWindow(state, f.definition, { actorId: 'p1', roundNumber: 8, expectedVersion: state.stateVersion }), 'ROUND_WINDOW', false);
    expect(Object.keys(getMarkerLedger(state, f.definition))).toHaveLength(count * 30);
  });
  it('does not mutate or clean up with stale versions or before all harvest plans', () => {
    const f = fixture(); let state = twoCycles(ready(f.state, f.definition), f.definition);
    state = openHarvestPhase(state, f.definition, { expectedVersion: state.stateVersion, roundNumber: 1 }); const before = structuredClone(state);
    errorCode(() => finishManagedRound(state, f.definition, { expectedVersion: 0 }), 'STALE_VERSION');
    errorCode(() => finishManagedRound(state, f.definition, { expectedVersion: state.stateVersion }), 'HARVEST_PENDING'); expect(state).toEqual(before);
  });
});

describe('untrusted commands, unsupported effects and snapshot tampering', () => {
  it.each(['actorId', 'roundNumber', 'cycle', 'turnIndex', 'majorActionOpened', 'startingPlayerId', 'free', 'roleEffectResolved'])('rejects client override %s', key => {
    const f = fixture(), before = structuredClone(f.state); errorCode(() => send(f.state, f.definition, { type: 'place-round-role', roleId: 'ROLE-01', [key]: 1 }), 'COMMAND_SCHEMA'); expect(f.state).toEqual(before);
  });
  it.each([null, [], {}, { type: 'use-round-role' }, { type: 'choose-major-action', action: 'special' }, { type: 'place-round-role', roleId: '山' }])('rejects malformed/unsupported %j without discarding a role', payload => {
    const f = fixture(); const before = structuredClone(f.state);
    errorCode(() => applyRoundCommand(f.state, f.definition, { authenticatedPlayerId: 'p1' }, { ...envelope(f.state), ...(payload as object) }), 'COMMAND_SCHEMA'); expect(f.state).toEqual(before);
  });
  it.each(['wrong-game', 'stale', 'wrong-actor', 'overflow'] as const)('rejects %s and retains the role/turn', problem => {
    const f = fixture(), state = gameStateSchema.parse(f.state), payload: Record<string, unknown> = { ...envelope(state), type: 'place-round-role', roleId: 'ROLE-01' };
    if (problem === 'wrong-game') payload.gameId = 'other';
    if (problem === 'stale') payload.expectedVersion = 0;
    if (problem === 'overflow') payload.expectedVersion = state.stateVersion = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(state);
    errorCode(() => applyRoundCommand(state, f.definition, { authenticatedPlayerId: problem === 'wrong-actor' ? 'p2' : 'p1' }, payload),
      problem === 'wrong-game' ? 'GAME_REFERENCE' : problem === 'stale' ? 'STALE_VERSION' : problem === 'wrong-actor' ? 'WRONG_ACTOR' : 'VERSION_OVERFLOW'); expect(state).toEqual(before);
  });
  it.each(['flow-missing', 'old-format', 'duplicate-role', 'missing-role', 'unknown-role', 'wrong-player', 'duplicate-player', 'wrong-placed-prefix', 'premature-actions', 'premature-harvest', 'third-cycle', 'false-open', 'wrong-action-actor', 'wrong-action-round', 'wrong-phase', 'premature-finish', 'bad-removal-count'] as const)('rejects corrupt %s schedule', problem => {
    const f = fixture(), state = gameStateSchema.parse(problem === 'wrong-action-actor' || problem === 'wrong-action-round' ? send(ready(f.state, f.definition), f.definition, { type: 'choose-major-action', action: 'dispatch' }) : f.state);
    const flow = state.roundFlow!;
    if (problem === 'flow-missing') delete state.roundFlow;
    if (problem === 'old-format') state.schemaVersion = '1.6.0';
    if (problem === 'duplicate-role') flow.rolesByPlayer[0]!.hand[0] = 'ROLE-02';
    if (problem === 'missing-role') flow.rolesByPlayer[0]!.hand.pop();
    if (problem === 'unknown-role') Object.assign(flow.rolesByPlayer[0]!.hand, { 0: 'enterprise' });
    if (problem === 'wrong-player') flow.rolesByPlayer[0]!.playerId = 'unknown';
    if (problem === 'duplicate-player') flow.rolesByPlayer[1]!.playerId = 'p1';
    if (problem === 'wrong-placed-prefix') { flow.rolePlacementCount = 1; const role = flow.rolesByPlayer[1]!; role.placed = role.hand.pop()!; }
    if (problem === 'premature-actions') flow.stage = 'player-actions';
    if (problem === 'premature-harvest') { flow.stage = 'harvest'; flow.turnIndex = 6; }
    if (problem === 'third-cycle') { flow.stage = 'player-actions'; flow.turnIndex = 6; }
    if (problem === 'false-open') flow.majorActionOpened = true;
    if (problem === 'wrong-action-actor') state.influenceAction!.actorId = 'p2';
    if (problem === 'wrong-action-round') state.influenceAction!.roundNumber = 2;
    if (problem === 'wrong-phase') state.phase = 'harvest';
    if (problem === 'premature-finish') flow.stage = 'finished';
    if (problem === 'bad-removal-count') flow.supplyRemovalCount = 2;
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('rejects unsupported built facilities rather than skipping their future cleanup effects', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state), facilities = state.facilities!;
    const cardId = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-015')!.id;
    for (const zone of [facilities.supply.drawPile, facilities.supply.supply]) { const at = zone.indexOf(cardId); if (at >= 0) zone.splice(at, 1); }
    while (facilities.supply.supply.length < 6) facilities.supply.supply.push(facilities.supply.drawPile.shift()!);
    facilities.supply.playerHoldings[0]!.cardIds.push(cardId); facilities.panels[0]!.placements.push({ cardId, cellId: 'CP-1-1' });
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('uses player identity rather than array index even with prototype-like IDs', () => {
    const players: readonly PlayerSetup[] = [{ id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' }, { id: 'p3', color: 'green' }];
    const f = fixture(3, players), state = gameStateSchema.parse(f.state); state.roundFlow!.rolesByPlayer.reverse();
    const next = send(state, f.definition, { type: 'place-round-role', roleId: 'ROLE-02' }, 'constructor');
    expect(next.roundFlow!.rolesByPlayer.find(row => row.playerId === 'constructor')!.placed).toBe('ROLE-02');
    expect(getRoundTurn(next, f.definition).actorId).toBe('toString');
  });
});
