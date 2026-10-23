import { describe, expect, it } from 'vitest';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { loadFoundersBoard } from '../board/index.js';
import {
  FOUNDERS_FACILITY_STOCK, FacilityConstructionError, getFacilityConstructionSupport,
  getFoundersFacilityFace, getFoundersPhysicalFacilityCard,
} from '../facilities/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, gameStateSchema, parseGameState, validateGameState,
  openConstructionWindow, applyConstructionCommand, getConstructionQuote,
  openDeploymentWindow, openDispatchWindow, applyInfluenceCommand, getDeploymentSlotIds,
  openExplorationWindow, applyExplorationCommand, getExplorationFinalSlotIds,
  openCityMoveWindow, getCityMoveOptions, applyCityMoveCommand, getCityMoveFinalSlotIds,
  openHarvestPhase, applyHarvestCommand, getMarkerLedger,
  getEventChoiceRequirements, getGamePosition,
} from './index.js';
import type { GameDefinition, GameState, PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
function entered(count = 3) {
  const game = createPreEntryGame('construction-action-test', seats.slice(0, count));
  const greens = FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === 'green' && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  let state = beginEntry(game.state, game.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(player => player.id), expectedVersion: 0,
    greenDeckOrder: ['G03', ...greens.filter(id => id !== 'G03')] });
  for (const [index, player] of seats.slice(0, count).entries()) {
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: player.id }, { type: 'select-initial-node', gameId: state.gameId,
      expectedVersion: state.stateVersion, nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
    state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: player.id }, { type: 'choose-green-event', gameId: state.gameId,
      expectedVersion: state.stateVersion, choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: 'p2' }, {
    type: 'choose-entry-influence', gameId: state.gameId, expectedVersion: state.stateVersion, slotId: null,
  });
  // Resource fixture only: funding is not claimed to have been earned by these entry choices.
  const funded = gameStateSchema.parse(state);
  for (const player of Object.values(funded.players)) for (const asset of ['orirock', 'originium', 'iron', 'columbia-voucher', 'pure-originium'] as const) player.balances[asset] = 50;
  return { definition: game.definition, state: parseGameState(funded, game.definition) };
}
function fixture(facilityId = 'FAC-013', count = 3, actorId = 'p1', color = getFoundersFacilityFace(facilityId).observedColor) {
  const e = entered(count);
  const cardId = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === facilityId && card.color === color)!.id;
  const second = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-005' && card.id !== cardId)!.id;
  const order = [cardId, second, ...ordinary.filter(id => id !== cardId && id !== second)];
  const eventIds = (color: 'yellow' | 'red') => FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
  const state = openConstructionWindow(e.state, e.definition, { actorId, roundNumber: 1, expectedVersion: e.state.stateVersion, facilityDeckOrder: order,
    deckOrder: { yellow: eventIds('yellow'), red: eventIds('red') } });
  return { ...e, state, beforeWindow: e.state, cardId, order, actorId,
    command: { type: 'construct-facility' as const, gameId: state.gameId, expectedVersion: state.stateVersion, cardId, cellId: 'CP-1-1', paymentMode: 'vouchers' as const,
      ...(facilityId === 'FAC-008' ? { entryChoice: { kind: 'resource-allocation' as const, gains: { orirock: 2, originium: 2, iron: 1 } } } : {}) },
  };
}
type Fixture = ReturnType<typeof fixture>;
const run = (f: Fixture, payload: unknown = f.command, state = f.state, actorId = f.actorId) => applyConstructionCommand(state, f.definition, { authenticatedPlayerId: actorId }, payload);
const commandFor = (state: GameState, f: Fixture) => ({ ...f.command, expectedVersion: state.stateVersion });
function errorCode(fn: () => unknown, code: string) {
  try { fn(); throw new Error('Expected construction rejection'); }
  catch (error) { expect(error).toBeInstanceOf(FacilityConstructionError); expect((error as FacilityConstructionError).code).toBe(code); }
}
const options = (state: GameState, actorId = 'p1', roundNumber = 1) => ({ actorId, roundNumber, expectedVersion: state.stateVersion });
const phaseOptions = (state: GameState) => ({ roundNumber: 1, expectedVersion: state.stateVersion });
function pendingDispatch(state: GameState, definition: GameDefinition) {
  let next = openDeploymentWindow(state, definition, options(state));
  next = applyInfluenceCommand(next, definition, { authenticatedPlayerId: 'p1' }, { type: 'deploy-influence', gameId: next.gameId,
    expectedVersion: next.stateVersion, slotId: getDeploymentSlotIds(next, definition, 'p1')[0] });
  return openDispatchWindow(next, definition, options(next));
}
function preserved(state: GameState, expected: GameState, definition: GameDefinition) {
  expect(state.schemaVersion).toBe('1.6.0'); expect(state.facilities).toEqual(expected.facilities);
  expect(validateGameState(state, definition).success).toBe(true);
}
function firstEventChoice(state: GameState, definition: GameDefinition, cardId: string, nodeId: string) {
  const choiceId = `${cardId}:1`;
  const requirements = getEventChoiceRequirements(getGamePosition(state, definition), definition, { gameId: state.gameId, actorId: 'p1', cardId, nodeId }, choiceId);
  return { choiceId, ...(requirements.requiresCostDecision ? { costDecision: 'pay' as const } : {}),
    ...(requirements.legalInfluenceSlotIds.length ? { influenceSlotId: requirements.legalInfluenceSlotIds[0]! } : {}) };
}

describe('single trusted construction window and authoritative snapshot', () => {
  it.each([2, 3, 4])('initializes once from real completed %i-player entry', count => {
    const f = fixture('FAC-013', count);
    expect(f.state.stateVersion).toBe(f.beforeWindow.stateVersion + 1);
    expect(f.state.schemaVersion).toBe('1.6.0'); expect(f.state.phase).toBe('construction');
    expect(f.state.entry).toBeUndefined(); expect(f.state.playerOrder).toEqual(f.beforeWindow.entry!.playerOrder);
    expect(f.state.construction).toEqual({ actorId: 'p1', roundNumber: 1, status: 'ready', constructionsCompleted: 0, builtCardId: null });
    expect(f.state.facilities!.supply.drawPile).toHaveLength(35); expect(f.state.facilities!.supply.supply).toHaveLength(6);
    expect(f.state.facilities!.panels).toHaveLength(count); expect(f.state.players).toEqual(f.beforeWindow.players);
    expect(f.state.eventDecks!.green).toEqual(f.beforeWindow.entry!.remainingGreenEventIds);
    expect(Object.keys(getMarkerLedger(f.state, f.definition))).toHaveLength(count * 30);
  });
  it.each(['FAC-005', 'FAC-008', 'FAC-009', 'FAC-010', 'FAC-011', 'FAC-012', 'FAC-013'])('settles %s in one persisted version', facilityId => {
    const f = fixture(facilityId), before = structuredClone(f.state), next = run(f), face = getFoundersFacilityFace(facilityId);
    expect(next.stateVersion).toBe(f.state.stateVersion + 1); expect(next.construction).toMatchObject({ status: 'complete', constructionsCompleted: 1, builtCardId: f.cardId });
    expect(next.players.p1!.score).toBe(f.state.players.p1!.score + face.printedScore);
    expect(next.players.p1!.balances['columbia-voucher']).toBe(50 - (face.constructionCost.kind === 'printed-alternatives' ? face.constructionCost.voucherPayment : NaN));
    expect(next.facilities!.supply.playerHoldings.find(row => row.playerId === 'p1')!.cardIds).toContain(f.cardId);
    expect(next.facilities!.panels[0]!.placements).toContainEqual({ cardId: f.cardId, cellId: 'CP-1-1' });
    expect(next.facilities!.supply.revision).toBe(1); expect(next.facilities!.panels[0]!.revision).toBe(1);
    expect(next.facilities!.supply.supply).toHaveLength(6); expect(next.facilities!.supply.drawPile).toHaveLength(34);
    expect(next.board).toEqual(before.board); expect(next.markerSupplyByPlayer).toEqual(before.markerSupplyByPlayer);
    expect(next.players.p2).toEqual(before.players.p2); expect(next.eventDecks).toEqual(before.eventDecks);
    expect(f.state).toEqual(before); expect(Object.isFrozen(next.facilities!.panels[0]!.placements)).toBe(true);
    expect(parseGameState(JSON.parse(JSON.stringify(next)), f.definition)).toEqual(next);
  });
  it('binds a nonfirst actor after ownership/panel arrays are reordered', () => {
    const f = fixture('FAC-011', 3, 'p2'), reordered = gameStateSchema.parse(f.state);
    reordered.facilities!.panels.reverse(); reordered.facilities!.supply.playerHoldings.reverse();
    const next = run(f, f.command, reordered);
    expect(next.facilities!.panels.find(row => row.playerId === 'p2')!.placements).toContainEqual({ cardId: f.cardId, cellId: 'CP-1-1' });
    expect(next.players.p2!.balances.originium).toBe(56); expect(next.players.p1).toEqual(f.state.players.p1);
    errorCode(() => run(f, f.command, f.state, 'p1'), 'WRONG_ACTOR');
  });
  it('quotes without consuming versions or the grant; execution recomputes from the current snapshot', () => {
    const f = fixture(), before = JSON.stringify(f.state);
    const quote = getConstructionQuote(f.state, f.definition, { authenticatedPlayerId: 'p1' }, f.command);
    expect(quote.costs).toEqual([{ asset: 'columbia-voucher', amount: 30 }]); expect(quote.canPay).toBe(true);
    expect(JSON.stringify(f.state)).toBe(before);
    const changed = gameStateSchema.parse(f.state); changed.players.p1!.balances['columbia-voucher'] = 0;
    expect(getConstructionQuote(changed, f.definition, { authenticatedPlayerId: 'p1' }, f.command).canPay).toBe(false);
    errorCode(() => run(f, f.command, changed), 'CANNOT_PAY');
  });
  it('consumes one grant, rejects exact replay and a second command even with an updated version', () => {
    const f = fixture(), next = run(f);
    errorCode(() => run(f, f.command, next), 'STALE_VERSION');
    errorCode(() => run(f, commandFor(next, f), next), 'ACTION_STAGE');
  });
  it('reuses the existing stock only after an explicit second trusted grant', () => {
    const f = fixture('FAC-011'), first = run(f);
    const next = openConstructionWindow(first, f.definition, options(first));
    expect(next.facilities).toEqual(first.facilities); expect(next.construction!.constructionsCompleted).toBe(0);
    const cardId = next.facilities!.supply.supply.find(id => getFoundersPhysicalFacilityCard(id).facilityId === 'FAC-005')!;
    // In this explicit order the next supported card is the blue urban facility, requiring no extra choice.
    const result = run(f, { ...commandFor(next, f), cardId, cellId: 'CP-1-2' }, next);
    expect(result.facilities!.panels[0]!.placements).toHaveLength(3); expect(result.facilities!.supply.revision).toBe(2);
    errorCode(() => openConstructionWindow(first, f.definition, { ...options(first), facilityDeckOrder: f.order }), 'FACILITY_RESET');
  });
  it('accepts resource payment and resolves the chosen mining gains in the same snapshot', () => {
    const f = fixture('FAC-008'), next = run(f, { ...f.command, paymentMode: 'resources' });
    expect(next.players.p1!.balances).toEqual({ orirock: 52, originium: 50, iron: 50, 'columbia-voucher': 50, 'pure-originium': 50 });
    expect(next.construction!.constructionsCompleted).toBe(1);
  });
  it('initializes facilities from a completed legacy action without replacing event decks or positions', () => {
    const f = fixture(); let legacy = openDeploymentWindow(f.beforeWindow, f.definition, options(f.beforeWindow));
    legacy = applyInfluenceCommand(legacy, f.definition, { authenticatedPlayerId: 'p1' }, { type: 'deploy-influence', gameId: legacy.gameId,
      expectedVersion: legacy.stateVersion, slotId: getDeploymentSlotIds(legacy, f.definition, 'p1')[0] });
    expect(legacy.schemaVersion).toBe('1.4.0'); expect(legacy.facilities).toBeUndefined();
    const next = openConstructionWindow(legacy, f.definition, { ...options(legacy), facilityDeckOrder: f.order });
    expect(next.board).toEqual(legacy.board); expect(next.players).toEqual(legacy.players); expect(next.eventDecks).toEqual(legacy.eventDecks);
    expect(next.influenceAction).toBeUndefined(); expect(next.facilities!.supply.drawPile).toHaveLength(35);
    expect(parseGameState(JSON.parse(JSON.stringify(legacy)), f.definition)).toEqual(legacy);
  });
});

describe('command boundary, failure atomicity and window guards', () => {
  it.each(['wrong-game', 'stale', 'other-player', 'unknown-player', 'card-source', 'occupied', 'unconfirmed-color', 'unsupported', 'cannot-pay', 'choice', 'state-overflow', 'panel-overflow', 'supply-overflow', 'gain-overflow', 'score-overflow'] as const)('rejects %s without consuming a grant or changing any ledger', problem => {
    const f = problem === 'unconfirmed-color' ? fixture('FAC-010', 3, 'p1', 'blue') : problem === 'unsupported' ? fixture('FAC-004') : problem === 'gain-overflow' ? fixture('FAC-011') : fixture();
    const state = gameStateSchema.parse(f.state), payload: Record<string, unknown> = { ...f.command }; let actor = 'p1', expected = '';
    if (problem === 'wrong-game') { payload.gameId = 'other'; expected = 'GAME_REFERENCE'; }
    if (problem === 'stale') { payload.expectedVersion = state.stateVersion - 1; expected = 'STALE_VERSION'; }
    if (problem === 'other-player' || problem === 'unknown-player') { actor = problem === 'other-player' ? 'p2' : 'nobody'; expected = 'WRONG_ACTOR'; }
    if (problem === 'card-source') { payload.cardId = state.facilities!.supply.drawPile[0]; expected = 'PLACEMENT_INVALID'; }
    if (problem === 'occupied') { payload.cellId = 'CP-3-2'; expected = 'PLACEMENT_INVALID'; }
    if (problem === 'unconfirmed-color') expected = 'UNCONFIRMED_COLOR_VARIANT';
    if (problem === 'unsupported') expected = 'FACILITY_FORMAT';
    if (problem === 'cannot-pay') { state.players.p1!.balances['columbia-voucher'] = 0; expected = 'CANNOT_PAY'; }
    if (problem === 'choice') { payload.entryChoice = { kind: 'resource-allocation', gains: { orirock: 5, originium: 0, iron: 0 } }; expected = 'ENTRY_CHOICE'; }
    if (problem === 'state-overflow') { payload.expectedVersion = state.stateVersion = Number.MAX_SAFE_INTEGER; expected = 'VERSION_OVERFLOW'; }
    if (problem === 'panel-overflow') { state.facilities!.panels[0]!.revision = Number.MAX_SAFE_INTEGER; expected = 'VERSION_OVERFLOW'; }
    if (problem === 'supply-overflow') { state.facilities!.supply.revision = Number.MAX_SAFE_INTEGER; expected = 'VERSION_OVERFLOW'; }
    if (problem === 'gain-overflow') { state.players.p1!.balances.originium = Number.MAX_SAFE_INTEGER; expected = 'BALANCE_OVERFLOW'; }
    if (problem === 'score-overflow') { state.players.p1!.score = Number.MAX_SAFE_INTEGER; expected = 'SCORE_OVERFLOW'; }
    const before = structuredClone(state); errorCode(() => run(f, payload, state, actor), expected);
    expect(state).toEqual(before); expect(state.construction!.status).toBe('ready');
  });
  it.each(['actorId', 'authenticatedPlayerId', 'free', 'discount', 'costs', 'points', 'remainingActions', 'facilityDeckOrder', 'expectedSupplyRevision', 'receipt'])('rejects client override %s', key => {
    const f = fixture(); errorCode(() => run(f, { ...f.command, [key]: 0 }), 'COMMAND_SCHEMA');
  });
  it.each([null, [], {}, { type: 'finish-construction' }])('rejects malformed command %j', input => {
    const f = fixture(); errorCode(() => run(f, input), 'COMMAND_SCHEMA');
  });
  it('allows a valid retry after a rejected choice without reopening or reinitializing', () => {
    const f = fixture('FAC-008'), payload = { ...f.command, entryChoice: undefined };
    errorCode(() => run(f, payload), 'ENTRY_CHOICE');
    expect(run(f).players.p1!.balances.orirock).toBe(52);
  });
  it('rejects a second unique building after a fresh grant and preserves the first building', () => {
    const f = fixture(), second = FOUNDERS_FACILITY_STOCK.cards.find(card => card.facilityId === 'FAC-013' && card.id !== f.cardId)!.id;
    const state = openConstructionWindow(f.beforeWindow, f.definition, { ...options(f.beforeWindow), facilityDeckOrder: [f.cardId, second, ...ordinary.filter(id => id !== f.cardId && id !== second)] });
    const first = run(f, commandFor(state, f), state), window = openConstructionWindow(first, f.definition, options(first));
    const before = structuredClone(window);
    errorCode(() => run(f, { ...commandFor(window, f), cardId: second, cellId: 'CP-1-2' }, window), 'UNIQUE_FACILITY');
    expect(window).toEqual(before); expect(window.facilities!.panels[0]!.placements).toHaveLength(2);
  });
  it('blocks unresolved exhausted-deck refill without charging or consuming the grant', () => {
    const f = fixture(), state = gameStateSchema.parse(f.state);
    state.facilities!.supply.returnedToBox.push(...state.facilities!.supply.drawPile.splice(0));
    expect(validateGameState(state, f.definition).success).toBe(true); const before = structuredClone(state);
    errorCode(() => run(f, f.command, state), 'REFILL_RULE_UNRESOLVED'); expect(state).toEqual(before);
  });
  it('applies actor and version checks to advisory quotes too', () => {
    const f = fixture();
    errorCode(() => getConstructionQuote(f.state, f.definition, { authenticatedPlayerId: 'p2' }, f.command), 'WRONG_ACTOR');
    errorCode(() => getConstructionQuote(f.state, f.definition, { authenticatedPlayerId: 'p1' }, { ...f.command, expectedVersion: 0 }), 'STALE_VERSION');
  });
  it('refuses construction before or outside its grant', () => {
    const f = fixture(), e = createPreEntryGame('construction-action-test', seats.slice(0, 3));
    for (const state of [e.state, f.beforeWindow, openDeploymentWindow(run(f), f.definition, options(run(f)))]) {
      errorCode(() => run(f, commandFor(state, f), state), 'ACTION_STAGE');
    }
    errorCode(() => openConstructionWindow(e.state, e.definition, { ...options(e.state), facilityDeckOrder: f.order }), 'ACTION_PENDING');
  });
  it('requires explicit valid first initialization and protects pending action and options', () => {
    const f = fixture();
    errorCode(() => openConstructionWindow(f.beforeWindow, f.definition, options(f.beforeWindow)), 'FACILITY_SETUP_REQUIRED');
    errorCode(() => openConstructionWindow(f.beforeWindow, f.definition, { ...options(f.beforeWindow), facilityDeckOrder: ordinary.map(() => ordinary[0]!) }), 'FACILITY_SETUP_INVALID');
    errorCode(() => openConstructionWindow(f.state, f.definition, options(f.state)), 'ACTION_PENDING');
    errorCode(() => openConstructionWindow(f.beforeWindow, f.definition, { ...options(f.beforeWindow), actorId: 'unknown', facilityDeckOrder: ordinary }), 'ACTOR_REFERENCE');
    errorCode(() => openConstructionWindow(f.beforeWindow, f.definition, { ...options(f.beforeWindow), roundNumber: 0 }), 'WINDOW_SCHEMA');
    errorCode(() => openConstructionWindow(f.beforeWindow, f.definition, { ...options(f.beforeWindow), expectedVersion: 0 }), 'STALE_VERSION');
  });
  it('does not let any other window bypass pending construction', () => {
    const f = fixture();
    for (const open of [openDeploymentWindow, openDispatchWindow, openExplorationWindow, openCityMoveWindow]) {
      expect(() => open(f.state, f.definition, options(f.state))).toThrow('Finish entry or the existing action');
    }
    expect(() => openHarvestPhase(f.state, f.definition, phaseOptions(f.state))).toThrow('Finish entry or the existing action');
  });
  it('does not let construction bypass other pending action/harvest windows', () => {
    const f = fixture(), done = run(f);
    const pending = [openDeploymentWindow(done, f.definition, options(done)), pendingDispatch(done, f.definition),
      openExplorationWindow(done, f.definition, options(done)), openCityMoveWindow(done, f.definition, options(done)), openHarvestPhase(done, f.definition, phaseOptions(done))];
    for (const state of pending) {
      expect(state.phase === 'influence-action' ? state.influenceAction!.status : state.phase === 'harvest' ? state.harvest!.status : state.phase === 'city-move' ? state.cityMove!.status : state.exploration!.status).not.toBe('complete');
      errorCode(() => openConstructionWindow(state, f.definition, options(state)), 'ACTION_PENDING');
    }
  });
});

describe('facility persistence across existing actions and snapshot validation', () => {
  it('preserves facilities through real deployment, dispatch and harvest and prohibits round/deck reset', () => {
    const f = fixture(), built = run(f); let state = openDeploymentWindow(built, f.definition, options(built)); preserved(state, built, f.definition);
    state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { type: 'deploy-influence', gameId: state.gameId, expectedVersion: state.stateVersion,
      slotId: getDeploymentSlotIds(state, f.definition, 'p1')[0] }); preserved(state, built, f.definition);
    state = openDispatchWindow(state, f.definition, options(state)); preserved(state, built, f.definition);
    state = applyInfluenceCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { type: 'finish-dispatch', gameId: state.gameId, expectedVersion: state.stateVersion }); preserved(state, built, f.definition);
    state = openHarvestPhase(state, f.definition, phaseOptions(state)); preserved(state, built, f.definition);
    for (const player of f.definition.players) state = applyHarvestCommand(state, f.definition, { authenticatedPlayerId: player.id }, {
      type: 'set-harvest-plan', gameId: state.gameId, expectedVersion: state.stateVersion, plan: { nodeIds: [], routeIds: [] },
    });
    preserved(state, built, f.definition);
    errorCode(() => openConstructionWindow(state, f.definition, options(state)), 'WINDOW_RESET');
    const next = openConstructionWindow(state, f.definition, options(state, 'p2', 2)); preserved(next, built, f.definition);
    errorCode(() => openConstructionWindow(state, f.definition, { ...options(state, 'p2', 2), deckOrder: { yellow: [], red: [] } }), 'WINDOW_RESET');
  });
  it('preserves facilities through a real exploration, event choice, final influence and subsequent construction grant', () => {
    const f = fixture(), built = run(f); let state = openExplorationWindow(built, f.definition, options(built));
    const board = loadFoundersBoard('three-player');
    const route = Object.values(board.routes).find(route => route.incidentNodeIds.includes('A-01') && route.incidentNodeIds.some(id => state.board.resourceMarkerByNode[id] === null && !board.resourceNodes[id]!.redRestricted))!;
    const nodeId = route.incidentNodeIds.find(id => id !== 'A-01' && state.board.resourceMarkerByNode[id] === null && !board.resourceNodes[id]!.redRestricted)!;
    state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { type: 'explore', gameId: state.gameId, expectedVersion: state.stateVersion,
      nodeId, path: [{ routeId: route.id, toNodeId: nodeId }] }); preserved(state, built, f.definition);
    state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { type: 'choose-exploration-event', gameId: state.gameId,
      expectedVersion: state.stateVersion, choice: firstEventChoice(state, f.definition, state.exploration!.cardId!, state.exploration!.targetNodeId!) }); preserved(state, built, f.definition);
    if (state.exploration!.status === 'final-influence') state = applyExplorationCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, {
      type: 'place-exploration-influence', gameId: state.gameId, expectedVersion: state.stateVersion, slotId: getExplorationFinalSlotIds(state, f.definition, 'p1')[0],
    });
    expect(state.exploration!.status).toBe('complete'); preserved(state, built, f.definition);
    preserved(openConstructionWindow(state, f.definition, options(state)), built, f.definition);
  });
  it('preserves facilities through city movement and event resolution', () => {
    const f = fixture(), built = run(f); let state = openCityMoveWindow(built, f.definition, options(built)); preserved(state, built, f.definition);
    const move = getCityMoveOptions(state, f.definition, 'p1')[0]!;
    state = applyCityMoveCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, { type: 'move-city', gameId: state.gameId, expectedVersion: state.stateVersion, ...move }); preserved(state, built, f.definition);
    if (state.cityMove!.status === 'event-choice') state = applyCityMoveCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, {
      type: 'choose-city-move-event', gameId: state.gameId, expectedVersion: state.stateVersion, choice: firstEventChoice(state, f.definition, state.cityMove!.cardId!, state.cityMove!.targetNodeId!),
    });
    if (state.cityMove!.status === 'final-influence') state = applyCityMoveCommand(state, f.definition, { authenticatedPlayerId: 'p1' }, {
      type: 'place-city-move-influence', gameId: state.gameId, expectedVersion: state.stateVersion, slotId: getCityMoveFinalSlotIds(state, f.definition, 'p1')[0],
    });
    expect(state.cityMove!.status).toBe('complete'); preserved(state, built, f.definition);
    preserved(openConstructionWindow(state, f.definition, options(state)), built, f.definition);
  });
  it.each(['missing-facilities', 'old-format', 'extra-position', 'missing-progress', 'extra-progress', 'actor', 'ready-count', 'ready-card', 'complete-count', 'complete-card', 'foreign-complete-card', 'core-complete-card', 'stock-ref', 'panel-ref', 'wrong-game', 'wrong-owner', 'missing-card'] as const)('rejects corrupt %s snapshot', problem => {
    const f = fixture(), state = gameStateSchema.parse(problem.startsWith('complete') || problem.includes('complete-card') ? run(f) : f.state);
    if (problem === 'missing-facilities') delete state.facilities;
    if (problem === 'old-format') state.schemaVersion = '1.5.0';
    if (problem === 'extra-position') Object.assign(state.facilities!, { position: { players: state.players } });
    if (problem === 'missing-progress') delete state.construction;
    if (problem === 'extra-progress') state.influenceAction = { actorId: 'p1', roundNumber: 1, kind: 'deploy', status: 'complete', operationsCompleted: 1 };
    if (problem === 'actor') state.construction!.actorId = 'unknown';
    if (problem === 'ready-count') state.construction!.constructionsCompleted = 1;
    if (problem === 'ready-card') state.construction!.builtCardId = f.cardId;
    if (problem === 'complete-count') state.construction!.constructionsCompleted = 0;
    if (problem === 'complete-card') state.construction!.builtCardId = null;
    if (problem === 'foreign-complete-card') state.construction!.actorId = 'p2';
    if (problem === 'core-complete-card') state.construction!.builtCardId = state.facilities!.panels[0]!.placements[0]!.cardId;
    if (problem === 'stock-ref') state.facilities!.supply.stockRef.contentHash = `sha256:${'0'.repeat(64)}`;
    if (problem === 'panel-ref') state.facilities!.panels[0]!.panelRef.contentHash = `sha256:${'0'.repeat(64)}`;
    if (problem === 'wrong-game') state.facilities!.supply.gameId = 'other';
    if (problem === 'wrong-owner') state.facilities!.panels[0]!.playerId = 'p2';
    if (problem === 'missing-card') state.facilities!.supply.drawPile.pop();
    expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('validates facility ownership even while another action is active', () => {
    const f = fixture(), done = run(f), state = gameStateSchema.parse(openExplorationWindow(done, f.definition, options(done)));
    state.facilities!.panels[0]!.placements.pop(); expect(validateGameState(state, f.definition).success).toBe(false);
  });
  it('rejects granting construction on a full panel without losing existing facilities', () => {
    const f = fixture(), state = gameStateSchema.parse(run(f)), facilities = state.facilities!, panel = facilities.panels[0]!;
    const ids = getFacilityConstructionSupport().supportedPhysicalCardIds.filter(id => !['FAC-001', 'FAC-004', 'FAC-007', 'FAC-013', 'FAC-014', 'FAC-015', 'FAC-016'].includes(getFoundersPhysicalFacilityCard(id).facilityId)).slice(0, 10);
    const cells = ['CP-1-2', 'CP-1-3', 'CP-2-1', 'CP-2-2', 'CP-2-3', 'CP-3-1', 'CP-3-3', 'CP-4-1', 'CP-4-2', 'CP-4-3'];
    // Physical full-panel fixture; not a claim of prior legal payment/action history.
    for (const [index, id] of ids.entries()) {
      for (const zone of [facilities.supply.drawPile, facilities.supply.supply]) { const at = zone.indexOf(id); if (at >= 0) zone.splice(at, 1); }
      facilities.supply.playerHoldings[0]!.cardIds.push(id); panel.placements.push({ cardId: id, cellId: cells[index]! });
    }
    while (facilities.supply.supply.length < 6) facilities.supply.supply.push(facilities.supply.drawPile.shift()!);
    expect(validateGameState(state, f.definition).success).toBe(true); const before = structuredClone(state);
    errorCode(() => openConstructionWindow(state, f.definition, options(state)), 'NO_EMPTY_CELL'); expect(state).toEqual(before);
  });
});
