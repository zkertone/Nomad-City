import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import {
  createPreEntryGame, beginEntry, applyEntryCommand, EntryCommandError,
  getLegalInitialNodeIds, getLegalEntryInfluenceSlotIds, getMarkerLedger,
  gameStateSchema, validateGameState, parseGameState,
} from './index.js';
import type { GameDefinition, GameState, PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
const greenIds = ['G01', 'G02', 'G03', 'G04', 'G05', 'G06'];
function setup(count = 3, first = 'p1', firstCard?: string) {
  const game = createPreEntryGame('entry-game', seats.slice(0, count));
  const eligible = greenIds.filter(id => count === 4 || id !== 'G01');
  const deck = firstCard ? [firstCard, ...eligible.filter(id => id !== firstCard)] : eligible;
  const state = beginEntry(game.state, game.definition, {
    startingPlayerId: first, clockwisePlayerIds: game.definition.players.map(player => player.id),
    expectedVersion: 0, greenDeckOrder: deck,
  });
  return { ...game, state };
}
function send(state: GameState, definition: GameDefinition, actor: string, command: Record<string, unknown>): GameState {
  return applyEntryCommand(state, definition, { authenticatedPlayerId: actor }, {
    gameId: state.gameId, expectedVersion: state.stateVersion, ...command,
  });
}
function select(state: GameState, definition: GameDefinition, actor: string, nodeId = 'A-01', bonus?: 'claim' | 'decline') {
  return send(state, definition, actor, { type: 'select-initial-node', nodeId, ...(bonus ? { b01Bonus: bonus } : {}) });
}
function choose(state: GameState, definition: GameDefinition, actor: string, choiceId?: string) {
  return send(state, definition, actor, { type: 'choose-green-event', choiceId: choiceId ?? `${state.entry!.pendingEvent!.cardId}:1` });
}
function finishCities(count: number, first = 'p1') {
  const game = setup(count, first); let state = game.state;
  for (const actor of game.state.entry!.playerOrder) {
    const nodeId = getLegalInitialNodeIds(state, game.definition, actor)[0]!;
    state = select(state, game.definition, actor, nodeId, nodeId === 'B-01' ? 'decline' : undefined);
    state = choose(state, game.definition, actor);
  }
  return { definition: game.definition, state };
}
function expectCode(operation: () => unknown, code: string) {
  try { operation(); throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(EntryCommandError); expect((error as EntryCommandError).code).toBe(code); }
}

describe('trusted entry setup', () => {
  it('rotates confirmed clockwise seats around the explicitly selected starting player', () => {
    const { state } = setup(4, 'p3');
    expect(state.entry!.playerOrder).toEqual(['p3', 'p4', 'p1', 'p2']);
    expect(state.entry!.status).toBe('selecting-node');
    expect(state.schemaVersion).toBe('1.1.0');
    expect(state.stateVersion).toBe(1);
  });
  it('upgrades a pristine 1.0.0 snapshot without changing its definition or the input', () => {
    const game = createPreEntryGame('entry-game', seats.slice(0, 3));
    const original = structuredClone(game.state);
    const started = beginEntry(game.state, game.definition, {
      startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2', 'p3'], expectedVersion: 0,
    });
    expect(started.schemaVersion).toBe('1.1.0');
    expect(game.state).toEqual(original);
    expect(game.state.schemaVersion).toBe('1.0.0');
    expect(game.definition.schemaVersion).toBe('1.0.0');
    expect([...started.entry!.remainingGreenEventIds].sort()).toEqual(greenIds.slice(1));
  });
  it.each([2, 3, 4])('shuffles only the eligible green permutation for %i players', count => {
    const game = createPreEntryGame('shuffle', seats.slice(0, count));
    const started = beginEntry(game.state, game.definition, {
      startingPlayerId: 'p1', clockwisePlayerIds: game.definition.players.map(player => player.id), expectedVersion: 0,
    });
    expect([...started.entry!.remainingGreenEventIds].sort()).toEqual(count === 4 ? greenIds : greenIds.slice(1));
  });
  it.each([
    ['foreign start', { startingPlayerId: 'ghost' }, 'STARTING_PLAYER'],
    ['duplicate seat', { clockwisePlayerIds: ['p1', 'p1', 'p3'] }, 'PLAYER_ORDER'],
    ['missing seat', { clockwisePlayerIds: ['p1', 'p2'] }, 'PLAYER_ORDER'],
    ['stale version', { expectedVersion: 1 }, 'STALE_VERSION'],
    ['incomplete deck', { greenDeckOrder: ['G02'] }, 'GREEN_DECK'],
    ['four-player card', { greenDeckOrder: ['G01', 'G03', 'G04', 'G05', 'G06'] }, 'GREEN_DECK'],
    ['duplicate deck card', { greenDeckOrder: ['G02', 'G02', 'G04', 'G05', 'G06'] }, 'GREEN_DECK'],
  ] as const)('rejects %s', (_label, override, code) => {
    const game = createPreEntryGame('entry-game', seats.slice(0, 3));
    expectCode(() => beginEntry(game.state, game.definition, {
      startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2', 'p3'], expectedVersion: 0,
      greenDeckOrder: greenIds.slice(1), ...override,
    }), code);
  });
  it('cannot restart progress or reset a nonzero pre-entry balance', () => {
    const { state, definition } = setup();
    expectCode(() => beginEntry(state, definition, { startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2', 'p3'], expectedVersion: state.stateVersion }), 'ENTRY_ALREADY_STARTED');
    const game = createPreEntryGame('entry-game', seats.slice(0, 3)); const candidate = gameStateSchema.parse(game.state);
    candidate.players.p1!.balances.iron = 1;
    expectCode(() => beginEntry(candidate, game.definition, { startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2', 'p3'], expectedVersion: 0 }), 'ENTRY_ALREADY_STARTED');
  });
});

describe('initial city and the actual revealed green choice', () => {
  it('places the city and reveals the next server card without paying a route fee or placing influence', () => {
    const game = setup(); const selected = select(game.state, game.definition, 'p1');
    expect(selected.board.cityNodeByPlayer.p1).toBe('A-01');
    expect(selected.board.resourceMarkerByNode['A-01']).toEqual({ markerDefinitionId: 'G02', resourceKind: 'iron', harvestAmount: 1 });
    expect(selected.entry!.pendingEvent).toEqual({ playerId: 'p1', nodeId: 'A-01', cardId: 'G02' });
    expect(selected.entry!.remainingGreenEventIds).toEqual(['G03', 'G04', 'G05', 'G06']);
    expect(selected.players.p1!.balances['columbia-voucher']).toBe(0);
    expect(selected.markerSupplyByPlayer.p1).toHaveLength(29);
    expect(Object.values(selected.board.influenceBySlot).every(marker => marker === null)).toBe(true);
  });
  const rewards = [
    ['G01:1', { iron: 2, 'columbia-voucher': 2 }], ['G01:2', { orirock: 4 }],
    ['G02:1', { 'columbia-voucher': 7 }], ['G02:2', { originium: 3 }],
    ['G03:1', { originium: 3 }], ['G03:2', { 'columbia-voucher': 7 }],
    ['G04:1', { originium: 3 }], ['G04:2', { iron: 2, 'columbia-voucher': 2 }],
    ['G05:1', { orirock: 4 }], ['G05:2', { originium: 3 }],
    ['G06:1', { orirock: 4 }], ['G06:2', { originium: 3 }],
  ] as const;
  it.each(rewards)('executes %s exactly once with its confirmed reward', (choiceId, reward) => {
    const game = setup(4, 'p1', choiceId.split(':')[0]!);
    const pending = select(game.state, game.definition, 'p1');
    const result = choose(pending, game.definition, 'p1', choiceId);
    expect(result.players.p1!.balances).toEqual({ orirock: 0, originium: 0, iron: 0, 'columbia-voucher': 0, 'pure-originium': 0, ...reward });
    expect(result.entry!.completedPlayerCount).toBe(1);
    expect(result.entry!.pendingEvent).toBeNull();
    expect(result.stateVersion).toBe(pending.stateVersion + 1);
    expectCode(() => send(result, game.definition, 'p1', { type: 'choose-green-event', choiceId, expectedVersion: pending.stateVersion }), 'STALE_VERSION');
  });
  it.each(['claim', 'decline'] as const)('requires the player to %s the optional B-01 reward explicitly', decision => {
    const game = setup(); const selected = select(game.state, game.definition, 'p1', 'B-01', decision);
    const amount = decision === 'claim' ? 2 : 0;
    expect(selected.players.p1!.balances).toEqual({ orirock: amount, originium: amount, iron: amount, 'columbia-voucher': 0, 'pure-originium': 0 });
    expect(selected.entry!.status).toBe('resolving-event');
  });
  it('rejects an omitted B-01 decision or attaching its bonus to another node', () => {
    const game = setup();
    expectCode(() => select(game.state, game.definition, 'p1', 'B-01'), 'B01_DECISION');
    expectCode(() => select(game.state, game.definition, 'p1', 'A-01', 'claim'), 'B01_DECISION');
  });
  it.each(['A-03', 'A-99'])('rejects unavailable starting node %s', nodeId => {
    const game = setup(); expectCode(() => select(game.state, game.definition, 'p1', nodeId), 'INITIAL_NODE');
  });
  it('prevents another player choosing an already occupied starting point', () => {
    const game = setup(); const next = choose(select(game.state, game.definition, 'p1'), game.definition, 'p1');
    expectCode(() => select(next, game.definition, 'p2', 'A-01'), 'INITIAL_NODE');
    expect(getLegalInitialNodeIds(next, game.definition, 'p2')).not.toContain('A-01');
  });
});

describe('entry completion and two-player changes', () => {
  it.each([3, 4])('completes %i-player entry and adds the correct seat-dependent initial funds', count => {
    const { state, definition } = finishCities(count);
    expect(state.entry!.status).toBe('complete');
    // Green events are G02/G03/G04 for three players, G01/G02/G03/G04 for four.
    const initialFunds = count === 3 ? [10, 12, 18] : [10, 12, 14, 18];
    const greenMoney = count === 3 ? [7, 0, 0] : [2, 7, 0, 0];
    for (let i = 0; i < count; i++) expect(state.players[`p${i + 1}`]!.balances['columbia-voucher']).toBe(initialFunds[i]! + greenMoney[i]!);
    expect(Object.values(state.board.influenceBySlot).filter(Boolean)).toHaveLength(0);
    expect(Object.keys(getMarkerLedger(state, definition))).toHaveLength(count * 30);
    expectCode(() => send(state, definition, 'p1', { type: 'choose-green-event', choiceId: 'G02:1' }), 'ENTRY_STAGE');
  });
  it('assigns funds by actual starting order rather than inventory seat number', () => {
    const { state } = finishCities(3, 'p2');
    expect(state.entry!.playerOrder).toEqual(['p2', 'p3', 'p1']);
    expect(state.players.p2!.balances['columbia-voucher']).toBe(17);
    expect(state.players.p3!.balances['columbia-voucher']).toBe(12);
    expect(state.players.p1!.balances['columbia-voucher']).toBe(18);
  });
  it('excludes B-01 from two-player starting choices and rejects a direct request', () => {
    const game = setup(2);
    expect(getLegalInitialNodeIds(game.state, game.definition, 'p1')).not.toContain('B-01');
    expectCode(() => select(game.state, game.definition, 'p1', 'B-01', 'claim'), 'INITIAL_NODE');
  });
  it.each([true, false])('lets the non-starting player place or decline the optional bonus: %s', place => {
    const game = finishCities(2); const before = game.state;
    expect(before.entry!.status).toBe('bonus-influence');
    expect(before.players.p1!.balances['columbia-voucher']).toBe(7);
    expect(before.players.p2!.balances['columbia-voucher']).toBe(0);
    const target = place ? getLegalEntryInfluenceSlotIds(before, game.definition, 'p2')[0]! : null;
    const state = send(before, game.definition, 'p2', { type: 'choose-entry-influence', slotId: target });
    expect(state.entry!.status).toBe('complete');
    expect(state.players.p1!.balances['columbia-voucher']).toBe(17);
    expect(state.players.p2!.balances['columbia-voucher']).toBe(18);
    expect(state.players.p2!.score).toBe(3);
    expect(state.markerSupplyByPlayer.p2).toHaveLength(place ? 28 : 29);
    expect(Object.keys(getMarkerLedger(state, game.definition))).toHaveLength(60);
    expectCode(() => send(state, game.definition, 'p2', { type: 'choose-entry-influence', slotId: null }), 'ENTRY_STAGE');
  });
  it('allows distant empty route slots, but not unexplored nodes or the opponent city', () => {
    const { state, definition } = finishCities(2);
    const board = loadFoundersBoard('three-player');
    const actorNode = state.board.cityNodeByPlayer.p2!;
    const distant = Object.values(board.routes).find(route => !route.incidentNodeIds.includes(actorNode))!.influenceSlotIds[0]!;
    const legal = getLegalEntryInfluenceSlotIds(state, definition, 'p2');
    expect(legal).toContain(distant);
    expect(getLegalEntryInfluenceSlotIds(state, definition, 'p1')).toEqual([]);
    expectCode(() => send(state, definition, 'p1', { type: 'choose-entry-influence', slotId: distant }), 'WRONG_ACTOR');
    const opponentSlot = board.resourceNodes[state.board.cityNodeByPlayer.p1!]!.influenceSlotIds[0]!;
    const unexplored = Object.values(board.resourceNodes).find(node => state.board.resourceMarkerByNode[node.id] === null)!.influenceSlotIds[0]!;
    expect(legal).not.toContain(opponentSlot); expect(legal).not.toContain(unexplored);
    expectCode(() => send(state, definition, 'p2', { type: 'choose-entry-influence', slotId: opponentSlot }), 'INFLUENCE_SLOT');
    expectCode(() => send(state, definition, 'p2', { type: 'choose-entry-influence', slotId: unexplored }), 'INFLUENCE_SLOT');
    const result = send(state, definition, 'p2', { type: 'choose-entry-influence', slotId: distant });
    expect(result.board.influenceBySlot[distant]!.ownerPlayerId).toBe('p2');
  });
});

describe('authoritative command envelope and atomicity', () => {
  const base = { type: 'select-initial-node', nodeId: 'A-01' };
  it.each([
    ['wrong actor', 'p2', base, 'WRONG_ACTOR'],
    ['unknown actor', 'ghost', base, 'WRONG_ACTOR'],
    ['wrong game', 'p1', { ...base, gameId: 'other' }, 'GAME_REFERENCE'],
    ['stale version', 'p1', { ...base, expectedVersion: 0 }, 'STALE_VERSION'],
    ['unsafe version', 'p1', { ...base, expectedVersion: Number.MAX_SAFE_INTEGER + 1 }, 'COMMAND_SCHEMA'],
    ['spoofed actor in payload', 'p1', { ...base, actorId: 'p2' }, 'COMMAND_SCHEMA'],
    ['client chosen card', 'p1', { ...base, cardId: 'G06' }, 'COMMAND_SCHEMA'],
    ['client chosen reward', 'p1', { ...base, balances: { iron: 999 } }, 'COMMAND_SCHEMA'],
    ['early event choice', 'p1', { type: 'choose-green-event', choiceId: 'G02:1' }, 'ENTRY_STAGE'],
    ['early bonus', 'p1', { type: 'choose-entry-influence', slotId: null }, 'ENTRY_STAGE'],
  ] as const)('rejects %s', (_label, actor, payload, code) => {
    const game = setup(); const original = structuredClone(game.state);
    expectCode(() => send(game.state, game.definition, actor, payload), code);
    expect(game.state).toEqual(original);
  });
  it('rejects a foreign event choice and a second node request while an event is pending', () => {
    const game = setup(); const pending = select(game.state, game.definition, 'p1');
    expectCode(() => choose(pending, game.definition, 'p1', 'G03:1'), 'EVENT_CHOICE');
    expectCode(() => select(pending, game.definition, 'p1', 'A-02'), 'ENTRY_STAGE');
  });
  it('does not execute a choice before entry starts', () => {
    const game = createPreEntryGame('entry-game', seats.slice(0, 3));
    expectCode(() => select(game.state, game.definition, 'p1'), 'ENTRY_STAGE');
    expect(getLegalInitialNodeIds(game.state, game.definition, 'p1')).toEqual([]);
  });
  it('rolls back no prior command and leaves this input unchanged on numeric overflow', () => {
    const game = setup(4, 'p1', 'G01');
    const pending = gameStateSchema.parse(select(game.state, game.definition, 'p1'));
    pending.players.p1!.balances.iron = Number.MAX_SAFE_INTEGER;
    const original = structuredClone(pending);
    expectCode(() => choose(pending, game.definition, 'p1', 'G01:1'), 'BALANCE_OVERFLOW');
    expect(pending).toEqual(original);
  });
  it('rejects version overflow without modifying the input', () => {
    const game = setup(); const state = gameStateSchema.parse(game.state); state.stateVersion = Number.MAX_SAFE_INTEGER;
    const original = structuredClone(state);
    expectCode(() => select(state, game.definition, 'p1'), 'VERSION_OVERFLOW');
    expect(state).toEqual(original);
  });
  it('returns deeply frozen states and frozen choice lists without freezing a mutable caller snapshot', () => {
    const game = setup(); const mutable = gameStateSchema.parse(game.state);
    const selected = select(mutable, game.definition, 'p1');
    expect(Object.isFrozen(mutable)).toBe(false);
    expect(Object.isFrozen(selected.entry!.pendingEvent)).toBe(true);
    expect(Object.isFrozen(selected.entry!.remainingGreenEventIds)).toBe(true);
    expect(Object.isFrozen(getLegalInitialNodeIds(game.state, game.definition, 'p1'))).toBe(true);
  });
  it('resumes a serialized pending event without drawing or rewarding twice', () => {
    const game = setup(); const pending = select(game.state, game.definition, 'p1');
    const resumed = parseGameState(JSON.parse(JSON.stringify(pending)), game.definition);
    const result = choose(resumed, game.definition, 'p1', 'G02:1');
    expect(result.players.p1!.balances['columbia-voucher']).toBe(7);
    expect(result.entry!.remainingGreenEventIds).toEqual(pending.entry!.remainingGreenEventIds);
    expect(result.stateVersion).toBe(pending.stateVersion + 1);
    expect(pending.players.p1!.balances['columbia-voucher']).toBe(0);
  });
  it('binds prototype-like registered actor IDs safely through command execution', () => {
    const game = createPreEntryGame('safe-actors', [
      { id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' },
    ]);
    const started = beginEntry(game.state, game.definition, {
      startingPlayerId: 'constructor', clockwisePlayerIds: ['constructor', 'toString'],
      expectedVersion: 0, greenDeckOrder: greenIds.slice(1),
    });
    const result = choose(select(started, game.definition, 'constructor'), game.definition, 'constructor');
    const actorId: string = 'constructor';
    expect(result.players[actorId]!.balances['columbia-voucher']).toBe(7);
    expect(result.entry!.playerOrder[result.entry!.completedPlayerCount]).toBe('toString');
  });
});

describe('persisted entry-progress integrity', () => {
  const invalid: [string, (state: ReturnType<typeof gameStateSchema.parse>) => void][] = [
    ['duplicate seat', state => { state.entry!.playerOrder[0] = 'p2'; }],
    ['wrong completed count', state => { state.entry!.completedPlayerCount = 4; }],
    ['premature complete', state => { state.entry!.status = 'complete'; }],
    ['missing remaining card', state => { state.entry!.remainingGreenEventIds.pop(); }],
    ['duplicate remaining card', state => { state.entry!.remainingGreenEventIds[0] = 'G03'; }],
    ['pending event without phase', state => { state.entry!.pendingEvent = { playerId: 'p1', nodeId: 'A-01', cardId: 'G02' }; }],
    ['ineligible pending phase', state => { state.entry!.status = 'bonus-influence'; }],
    ['influence before entry bonus', state => {
      const slot = Object.keys(state.board.influenceBySlot).find(id => id.startsWith('route:'))!;
      state.board.influenceBySlot[slot] = { markerId: state.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p1' };
    }],
  ];
  it.each(invalid)('rejects %s', (_label, mutate) => {
    const game = setup(); const state = gameStateSchema.parse(game.state); mutate(state);
    expect(validateGameState(state, game.definition).success).toBe(false);
  });
  it.each(['playerId', 'nodeId', 'cardId'] as const)('binds pending %s to current actor/city/marker', field => {
    const game = setup(); const state = gameStateSchema.parse(select(game.state, game.definition, 'p1'));
    state.entry!.pendingEvent![field] = { playerId: 'p2', nodeId: 'A-02', cardId: 'G03' }[field];
    expect(validateGameState(state, game.definition).success).toBe(false);
  });
  it('does not allow a progress field to be silently added to legacy 1.0.0 or removed from 1.1.0', () => {
    const game = setup();
    expect(validateGameState({ ...game.state, schemaVersion: '1.0.0' }, game.definition).success).toBe(false);
    const candidate = gameStateSchema.parse(game.state); delete candidate.entry;
    expect(validateGameState(candidate, game.definition).success).toBe(false);
  });
});
