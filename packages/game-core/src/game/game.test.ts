import { describe, expect, it } from 'vitest';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import { loadFoundersBoard, boardStateSchema } from '../board/index.js';
import {
  createPreEntryGame, validateGameDefinition, parseGameDefinition,
  validateGameState, parseGameState, getMarkerLedger, getFoundersMapSide,
  gameStateSchema, gameDefinitionSchema, resourceBalancesSchema, canAffordResources,
} from './index.js';
import type { PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
const make = (count = 3) => createPreEntryGame('test-game', seats.slice(0, count));
const stateCopy = () => gameStateSchema.parse(make().state);
const definitionCopy = () => gameDefinitionSchema.parse(make().definition);
type MutableState = ReturnType<typeof stateCopy>;
const codes = (state: unknown, definition = make().definition) => {
  const result = validateGameState(state, definition);
  if (result.success) throw new Error('Expected failure');
  return result.issues.map(issue => issue.code);
};
const firstRouteSlot = (state: MutableState) => Object.keys(state.board.influenceBySlot).find(id => id.startsWith('route:'))!;

describe.each([2, 3, 4])('pre-entry foundation with %i players', count => {
  it('selects the independent ruleset/map and pins both definitions', () => {
    const { definition, state } = make(count);
    expect(definition.rulesetId).toBe(`founders-base-${count}p`);
    expect(definition.boardDefinitionRef.definitionId).toBe(count === 4 ? 'founders-map-4' : 'founders-map-3');
    expect(definition.eventCatalogRef.contentHash).toBe(FOUNDERS_EVENT_CATALOG.contentHash);
    expect(validateGameDefinition(definition).success).toBe(true);
    expect(validateGameState(state, definition).success).toBe(true);
    expect(state.stateVersion).toBe(0);
    expect(state.phase).toBe('entry');
    expect(Object.values(state.board.cityNodeByPlayer)).toEqual(Array(count).fill(null));
  });
  it('owns exactly 30 markers: 1 at score zero and 29 in supply, not 30 free', () => {
    const { definition, state } = make(count);
    const ledger = getMarkerLedger(state, definition);
    expect(Object.keys(ledger)).toHaveLength(count * 30);
    for (const { id } of definition.players) {
      const markers = Object.values(ledger).filter(marker => marker.ownerPlayerId === id);
      expect(markers).toHaveLength(30);
      expect(markers.filter(marker => marker.location.kind === 'supply')).toHaveLength(29);
      expect(markers.filter(marker => marker.location.kind === 'score')).toHaveLength(1);
      expect(state.players[id]!.score).toBe(0);
      expect(ledger[state.players[id]!.scoreMarkerId]!.location).toEqual({ kind: 'score', playerId: id });
    }
  });
  it('starts resource balances at zero before event and initial-money setup steps', () => {
    const { state } = make(count);
    for (const player of Object.values(state.players)) {
      expect(player.balances).toEqual({ orirock: 0, originium: 0, iron: 0, 'columbia-voucher': 0, 'pure-originium': 0 });
    }
  });
});

describe('registered setup invariants', () => {
  it.each([0, 1, 5, 2.5, NaN, Infinity])('rejects unsupported count %s', count => {
    expect(() => getFoundersMapSide(count)).toThrow(RangeError);
  });
  it('rejects duplicate player IDs, duplicate colors and unregistered colors', () => {
    expect(() => createPreEntryGame('test', [seats[0]!, seats[0]!])).toThrow();
    expect(() => createPreEntryGame('test', [seats[0]!, { id: 'other', color: 'red' }])).toThrow();
    expect(gameDefinitionSchema.safeParse({ ...make().definition, players: [{ id: 'p1', color: 'black' }, seats[1]] }).success).toBe(false);
  });
  it.each([
    ['wrong ruleset', (d: ReturnType<typeof definitionCopy>) => { d.rulesetId = 'founders-base-4p'; }],
    ['wrong map', (d: ReturnType<typeof definitionCopy>) => { d.boardDefinitionRef.definitionId = 'founders-map-4'; }],
    ['wrong map hash', (d: ReturnType<typeof definitionCopy>) => { d.boardDefinitionRef.contentHash = `sha256:${'0'.repeat(64)}`; }],
    ['wrong event hash', (d: ReturnType<typeof definitionCopy>) => { d.eventCatalogRef.contentHash = `sha256:${'0'.repeat(64)}`; }],
    ['duplicate marker', (d: ReturnType<typeof definitionCopy>) => { d.markerDefinitions[1]!.id = d.markerDefinitions[0]!.id; }],
    ['unregistered owner', (d: ReturnType<typeof definitionCopy>) => { d.markerDefinitions[0]!.ownerPlayerId = 'ghost'; }],
    ['unequal pools despite same total', (d: ReturnType<typeof definitionCopy>) => { d.markerDefinitions[0]!.ownerPlayerId = 'p2'; }],
    ['missing inventory item', (d: ReturnType<typeof definitionCopy>) => { d.markerDefinitions.pop(); }],
  ] as const)('rejects %s', (_name, change) => {
    const definition = definitionCopy(); change(definition);
    expect(validateGameDefinition(definition).success).toBe(false);
    expect(() => parseGameDefinition(definition)).toThrow();
  });
  it('handles prototype-like registered IDs with own-key lookups', () => {
    const game = createPreEntryGame('safe-id', [
      { id: 'constructor', color: 'blue' }, { id: 'toString', color: 'yellow' },
    ]);
    expect(validateGameState(game.state, game.definition).success).toBe(true);
    expect(Object.hasOwn(game.state.players, 'constructor')).toBe(true);
    expect(Object.keys(getMarkerLedger(game.state, game.definition))).toHaveLength(60);
  });
});

describe('global marker conservation and snapshot references', () => {
  const invalid: [string, string, (state: MutableState) => void][] = [
    ['missing marker', 'MARKER_MISSING', s => { s.markerSupplyByPlayer.p1!.pop(); }],
    ['duplicate supply marker', 'MARKER_REUSED', s => { s.markerSupplyByPlayer.p1!.push(s.markerSupplyByPlayer.p1![0]!); }],
    ['score also in supply', 'MARKER_REUSED', s => { s.markerSupplyByPlayer.p1!.push(s.players.p1!.scoreMarkerId); }],
    ['unregistered marker', 'MARKER_REFERENCE', s => { s.markerSupplyByPlayer.p1![0] = 'marker:unknown'; }],
    ['wrong score owner', 'MARKER_OWNER', s => { s.players.p1!.scoreMarkerId = s.players.p2!.scoreMarkerId; }],
    ['wrong supply owner with no duplicates', 'MARKER_OWNER', s => {
      const first = s.markerSupplyByPlayer.p1![0]!;
      s.markerSupplyByPlayer.p1![0] = s.markerSupplyByPlayer.p2![0]!;
      s.markerSupplyByPlayer.p2![0] = first;
    }],
    ['board marker still in supply', 'MARKER_REUSED', s => {
      s.board.influenceBySlot[firstRouteSlot(s)] = { markerId: s.markerSupplyByPlayer.p1![0]!, ownerPlayerId: 'p1' };
    }],
    ['wrong board owner', 'MARKER_OWNER', s => {
      s.board.influenceBySlot[firstRouteSlot(s)] = { markerId: s.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p2' };
    }],
    ['unregistered game', 'GAME_REFERENCE', s => { s.gameId = 'another-game'; }],
    ['missing player', 'PLAYER_KEYS', s => { delete s.players.p2; }],
    ['missing supply record', 'PLAYER_KEYS', s => { delete s.markerSupplyByPlayer.p2; }],
    ['missing city record', 'PLAYER_KEYS', s => { delete s.board.cityNodeByPlayer.p2; }],
    ['extra city record', 'PLAYER_KEYS', s => { s.board.cityNodeByPlayer.ghost = null; }],
    ['negative balance', 'SCHEMA', s => { s.players.p1!.balances.iron = -1; }],
    ['unsafe balance', 'SCHEMA', s => { s.players.p1!.balances.iron = Number.MAX_SAFE_INTEGER + 1; }],
    ['fractional score', 'SCHEMA', s => { s.players.p1!.score = 0.5; }],
    ['negative version', 'SCHEMA', s => { s.stateVersion = -1; }],
    ['unsupported phase', 'SCHEMA', s => { Object.assign(s, { phase: 'round' }); }],
  ];
  it.each(invalid)('rejects %s', (_name, expected, mutate) => {
    const state = stateCopy(); mutate(state);
    expect(codes(state)).toContain(expected);
    expect(() => parseGameState(state, make().definition)).toThrow();
  });
  it('validates a supply-to-board transfer and derives its single location', () => {
    const { definition } = make(); const state = stateCopy();
    const markerId = state.markerSupplyByPlayer.p1!.shift()!;
    const slotId = firstRouteSlot(state);
    state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: 'p1' };
    const parsed = parseGameState(state, definition);
    expect(parsed.markerSupplyByPlayer.p1).toHaveLength(28);
    expect(getMarkerLedger(parsed, definition)[markerId]).toEqual({ markerId, ownerPlayerId: 'p1', location: { kind: 'board-slot', slotId } });
    expect(Object.keys(getMarkerLedger(parsed, definition))).toHaveLength(90);
    expect(Object.hasOwn(parsed, 'markerLedger')).toBe(false);
  });
  it('does not accept an additional persisted ledger or extra expansion fields', () => {
    expect(validateGameState({ ...stateCopy(), markerLedger: {} }, make().definition).success).toBe(false);
    const state = stateCopy(); Object.assign(state.players.p1!, { enterpriseLevel: 4 });
    expect(validateGameState(state, make().definition).success).toBe(false);
  });
  it('can represent signed score positions separately from nonnegative resources', () => {
    const state = stateCopy(); state.players.p1!.score = -1;
    expect(validateGameState(state, make().definition).success).toBe(true);
  });
  it('validates and freezes a copy while leaving caller input unchanged', () => {
    const state = stateCopy(); const original = structuredClone(state);
    const parsed = parseGameState(state, make().definition);
    expect(state).toEqual(original);
    expect(Object.isFrozen(state)).toBe(false);
    const visit = (value: unknown): void => {
      if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(visit); }
    };
    visit(parsed); visit(make().definition); visit(getMarkerLedger(parsed, make().definition));
  });
});

describe('bridge from board resource markers to the approved event catalog', () => {
  it.each(FOUNDERS_EVENT_CATALOG.cards)('$id has exact resource kind and amount supported by BoardState', card => {
    const { definition, state } = make(4);
    const candidate = gameStateSchema.parse(state);
    const board = loadFoundersBoard('four-player');
    const nodeId = Object.values(board.resourceNodes).find(node => node.eventDeckColor === card.color)!.id;
    candidate.board.resourceMarkerByNode[nodeId] = {
      markerDefinitionId: card.id, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount,
    };
    expect(boardStateSchema.safeParse(candidate.board).success).toBe(true);
    expect(validateGameState(candidate, definition).success).toBe(true);
  });
  const marker = { markerDefinitionId: 'G02', resourceKind: 'iron', harvestAmount: 1 } as const;
  it.each([
    ['unknown resource marker', 'RESOURCE_MARKER_REFERENCE', { ...marker, markerDefinitionId: 'constructor' }],
    ['wrong kind', 'RESOURCE_MARKER_DATA', { ...marker, resourceKind: 'originium' }],
    ['wrong quantity', 'RESOURCE_MARKER_DATA', { ...marker, harvestAmount: 2 }],
    ['four-player exclusion', 'RESOURCE_MARKER_PLAYERS', { markerDefinitionId: 'G01', resourceKind: 'originium', harvestAmount: 1 }],
  ] as const)('rejects %s', (_label, code, resourceMarker) => {
    const state = stateCopy(); state.board.resourceMarkerByNode['A-01'] = resourceMarker;
    expect(codes(state)).toContain(code);
  });
  it('rejects the same event marker assigned twice', () => {
    const state = stateCopy();
    state.board.resourceMarkerByNode['A-01'] = marker;
    state.board.resourceMarkerByNode['A-02'] = marker;
    expect(codes(state)).toContain('RESOURCE_MARKER_REUSED');
  });
  it('rejects a yellow event marker placed on a green node', () => {
    const state = stateCopy();
    state.board.resourceMarkerByNode['A-01'] = { markerDefinitionId: 'Y01', resourceKind: 'originium', harvestAmount: 1 };
    expect(codes(state)).toContain('RESOURCE_MARKER_COLOR');
  });
});

describe('resource balances and affordability arithmetic only', () => {
  const balances = { orirock: 3, originium: 5, iron: 1, 'columbia-voucher': 4, 'pure-originium': 0 } as const;
  it('supports all five holdings without treating points as a resource', () => {
    expect(resourceBalancesSchema.safeParse(balances).success).toBe(true);
    expect(resourceBalancesSchema.safeParse({ ...balances, point: 2 }).success).toBe(false);
  });
  it('allows exact cost, rejects shortage and leaves input unchanged', () => {
    const original = structuredClone(balances);
    expect(canAffordResources(balances, [{ asset: 'columbia-voucher', amount: 4 }])).toBe(true);
    expect(canAffordResources(balances, [{ asset: 'columbia-voucher', amount: 5 }])).toBe(false);
    expect(canAffordResources(balances, [{ asset: 'pure-originium', amount: 1 }])).toBe(false);
    expect(balances).toEqual(original);
  });
  it('combines duplicate-asset costs instead of checking each against the original balance', () => {
    expect(canAffordResources(balances, [{ asset: 'originium', amount: 3 }, { asset: 'originium', amount: 3 }])).toBe(false);
    expect(canAffordResources(balances, [{ asset: 'originium', amount: 2 }, { asset: 'originium', amount: 3 }])).toBe(true);
  });
  it('handles safe-integer limits without overflowing an accumulated cost', () => {
    expect(canAffordResources({ ...balances, iron: Number.MAX_SAFE_INTEGER }, [
      { asset: 'iron', amount: Number.MAX_SAFE_INTEGER }, { asset: 'iron', amount: 1 },
    ])).toBe(false);
  });
  it.each([0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects malformed cost %s', amount => {
    expect(() => canAffordResources(balances, [{ asset: 'iron', amount }])).toThrow();
  });
  it('accepts an empty cost list without granting action permission', () => {
    expect(canAffordResources(balances, [])).toBe(true);
  });
});
