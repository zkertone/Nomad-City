import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import verifiedCatalog from './verification/verified-catalog.json' with { type: 'json' };
import {
  founders3, founders4, boardDefinitionSchema, boardStateSchema,
  validateBoardDefinition, parseBoardDefinition, validateDefinitionRef,
  computeBoardContentHash, canonicalBoardContent,
  getRoutesForNode, getNodesForRoute, areNodesDirectlyConnected, isBoardConnected,
  createEmptyBoardState, validateBoardState, loadFoundersBoard,
} from './index.js';
import type { BoardDefinition, ValidationResult } from './types.js';

function mutable(board: BoardDefinition = founders3) { return boardDefinitionSchema.parse(board); }
function rehash(board: ReturnType<typeof mutable>): void { board.contentHash = computeBoardContentHash(board); }
function codes(result: ValidationResult<unknown>): string[] {
  if (result.success) throw new Error('Expected validation failure');
  return result.issues.map((issue) => issue.code);
}
const source = readFileSync(new URL('../../../../docs/Map-Analysis-v0.1.0.md', import.meta.url), 'utf8');
const maps = [founders3, founders4] as const;

describe.each(maps)('$definitionId integrity', (board) => {
  const expected = verifiedCatalog[board.mapSide];
  it('loads, validates all relationships and matches every required total', () => {
    const loaded = loadFoundersBoard(board.mapSide);
    expect(validateBoardDefinition(loaded).success).toBe(true);
    expect(Object.keys(loaded.resourceNodes)).toHaveLength(expected.totals.nodes);
    expect(Object.keys(loaded.routes)).toHaveLength(expected.totals.routes);
    expect(Object.keys(loaded.regions)).toHaveLength(expected.totals.regions);
    expect(Object.keys(loaded.influenceSlots)).toHaveLength(expected.totals.totalSlots);
    expect(Object.values(loaded.resourceNodes).reduce((sum, n) => sum + n.influenceSlotIds.length, 0)).toBe(expected.totals.nodeSlots);
    expect(Object.values(loaded.routes).reduce((sum, r) => sum + r.influenceSlotIds.length, 0)).toBe(expected.totals.routeSlots);
    expect(Object.values(loaded.regions).reduce((sum, r) => sum + r.controlRewardPoints, 0)).toBe(expected.totals.controlPoints);
    expect(isBoardConnected(loaded)).toBe(true);
  });

  it('independently compares ALL route rows directly to the approved Markdown table', () => {
    const section = board.mapSide === 'three-player'
      ? source.split('## 5A.')[1]?.split('## 6.')[0]
      : source.split('## 5.')[1]?.split('## 5A.')[0];
    expect(section).toBeDefined();
    const rows = section!.split('\n').filter((line) => line.startsWith('| ') && line.includes('-route-'));
    expect(rows).toHaveLength(expected.totals.routes);
    const ids = new Set<string>();
    for (const row of rows) {
      const [id, region, nodes, slots] = row.slice(1, -1).split('|').map((value) => value.trim());
      expect(id && region && nodes && slots).toBeTruthy();
      ids.add(id!);
      const route = board.routes[id!];
      expect(route).toBeDefined();
      expect(route!.regionId).toBe(region);
      expect([...route!.incidentNodeIds].sort()).toEqual(nodes!.split('、').sort());
      expect(route!.influenceSlotIds).toHaveLength(Number(slots));
    }
    expect([...ids].sort()).toEqual(Object.keys(board.routes).sort());
  });

  it('independently compares ALL node colors, regions, flags and slots to the source inventory', () => {
    const section = source.split('## 4.')[1]?.split('## 5.')[0];
    const colors = { '绿': 'green', '黄': 'yellow', '红': 'red' } as const;
    const matches = [...section!.matchAll(/([A-G]-\d{2}) ([绿黄红])/g)]
      .filter((m) => board.mapSide === 'four-player' || !m[1]!.startsWith('G-'));
    expect(matches).toHaveLength(expected.totals.nodes);
    for (const [, id, color] of matches) {
      const node = board.resourceNodes[id!];
      expect(node).toBeDefined();
      expect(node!.regionId).toBe(id!.charAt(0));
      expect(node!.eventDeckColor).toBe(colors[color as keyof typeof colors]);
      expect(node!.redRestricted).toBe(color === '红');
      expect(node!.initialCityEligible).toBe(color === '绿');
      expect(node!.influenceSlotIds).toEqual([`node:${id}:slot:1`, `node:${id}:slot:2`]);
    }
  });

  it('preserves exactly the verified initial and restricted nodes, E/F scores', () => {
    const green = ['A-01', 'A-02', 'B-01', 'B-02', 'C-01'];
    const red = ['E-02', 'E-03', 'F-01', 'F-02', 'F-03'];
    if (board.mapSide === 'four-player') { green.push('G-01'); red.push('G-04'); }
    expect(Object.values(board.resourceNodes).filter((n) => n.initialCityEligible).map((n) => n.id).sort()).toEqual(green.sort());
    expect(Object.values(board.resourceNodes).filter((n) => n.redRestricted).map((n) => n.id).sort()).toEqual(red.sort());
    for (const region of Object.values(board.regions)) expect(region.controlRewardPoints).toBe(['E', 'F'].includes(region.id) ? 4 : 3);
  });

  it.each(Object.entries(board.routes))('queries independent route %s and every pair of its endpoints', (id, route) => {
    expect(getNodesForRoute(board, id).map((n) => n.id)).toEqual([...route.incidentNodeIds].sort());
    for (const from of route.incidentNodeIds) {
      expect(getRoutesForNode(board, from).map((r) => r.id)).toContain(id);
      for (const to of route.incidentNodeIds) expect(areNodesDirectlyConnected(board, from, to, id)).toBe(from !== to);
    }
  });
});

describe('map differences and pure topology', () => {
  it('rejects prototype property names as unknown query IDs', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(() => getNodesForRoute(founders3, id)).toThrow(RangeError);
      expect(() => getRoutesForNode(founders3, id)).toThrow(RangeError);
    }
  });
  it('returns false for prototype property names in boolean topology queries', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(areNodesDirectlyConnected(founders3, 'A-01', 'A-02', id)).toBe(false);
      expect(areNodesDirectlyConnected(founders3, id, 'A-02', 'A-route-01')).toBe(false);
    }
  });
  it('retains the three-player gray merge, two extra routes and changed capacities', () => {
    expect(founders3.routes['R-route-04']!.incidentNodeIds).toEqual(['F-03', 'E-03', 'F-02']);
    expect(founders4.routes['R-route-04']!.incidentNodeIds).toEqual(['F-03', 'E-03']);
    expect(founders3.routes['R-route-04']!.influenceSlotIds).toHaveLength(2);
    expect(founders4.routes['R-route-04']!.influenceSlotIds).toHaveLength(1);
    expect(founders3.routes['R-route-08']!.incidentNodeIds).toEqual(['C-03', 'E-01']);
    expect(founders3.routes['R-route-09']!.incidentNodeIds).toEqual(['C-02', 'E-01']);
    for (const id of ['R-route-08', 'R-route-09']) expect(founders4.routes[id]).toBeUndefined();
    for (const id of ['R-route-03', 'R-route-05', 'G-route-01', 'G-route-02']) expect(founders3.routes[id]).toBeUndefined();
    expect(founders3.routes['R-route-07']!.influenceSlotIds).toHaveLength(2);
    expect(founders4.routes['R-route-07']!.influenceSlotIds).toHaveLength(1);
  });
  it('supports three-end and four-end shared routes as a single identity', () => {
    expect(getNodesForRoute(founders3, 'R-route-04')).toHaveLength(3);
    expect(getNodesForRoute(founders4, 'D-route-01')).toHaveLength(4);
    expect(areNodesDirectlyConnected(founders4, 'D-02', 'A-03', 'D-route-01')).toBe(true);
    expect(areNodesDirectlyConnected(founders4, 'D-02', 'A-03', 'D-route-02')).toBe(false);
    expect(areNodesDirectlyConnected(founders4, 'F-01', 'G-04', 'F-route-01')).toBe(true);
    expect(areNodesDirectlyConnected(founders3, 'F-01', 'G-04', 'F-route-01')).toBe(false);
  });
  it('defines two map sides without fixing a player count or economy', () => {
    expect(createEmptyBoardState(founders3, ['p1', 'p2']).cityNodeByPlayer).toEqual({ p1: null, p2: null });
    for (const board of maps) {
      expect('playerCount' in board).toBe(false);
      expect('redUnlockRound' in board).toBe(false);
      expect('routeCost' in board).toBe(false);
    }
  });
  it('throws for unknown query IDs; boolean relation returns false for unknown/self IDs', () => {
    expect(() => getRoutesForNode(founders3, 'A-99')).toThrow(RangeError);
    expect(() => getNodesForRoute(founders3, 'R-route-99')).toThrow(RangeError);
    expect(areNodesDirectlyConnected(founders3, 'A-99', 'A-01', 'A-route-01')).toBe(false);
    expect(areNodesDirectlyConnected(founders3, 'A-01', 'A-02', 'R-route-99')).toBe(false);
    expect(areNodesDirectlyConnected(founders3, 'A-01', 'A-01', 'A-route-01')).toBe(false);
  });
  it('never mutates a definition or lets callers change exported definitions', () => {
    const before = JSON.stringify(founders4);
    getNodesForRoute(founders4, 'D-route-01'); getRoutesForNode(founders4, 'A-01'); isBoardConnected(founders4);
    expect(JSON.stringify(founders4)).toBe(before);
    expect(Object.isFrozen(founders4.routes['D-route-01']!.incidentNodeIds)).toBe(true);
    expect(() => Reflect.set(founders4, 'mapSide', 'three-player')).not.toThrow();
    expect(Reflect.set(founders4.resourceNodes['A-01']!, 'redRestricted', true)).toBe(false);
  });
});

describe('invalid definition data', () => {
  it('rejects malformed structural input and unknown fields', () => {
    expect(codes(validateBoardDefinition(null))).toContain('SCHEMA');
    expect(codes(validateBoardDefinition({ ...founders3, routeCost: 2 }))).toContain('SCHEMA');
  });
  it('rejects a missing resource-node reference', () => {
    const board = mutable(); board.routes['F-route-01']!.incidentNodeIds[0] = 'A-99'; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('NODE_REFERENCE');
  });
  it('rejects a reference to an object of the wrong type', () => {
    const board = mutable();
    const input: unknown = { ...board, routes: { ...board.routes, 'F-route-01': {
      ...board.routes['F-route-01'], incidentNodeIds: ['A-route-01', 'F-01'],
    } } };
    expect(codes(validateBoardDefinition(input))).toContain('SCHEMA');
  });
  it('rejects duplicate object IDs even when record keys remain unique', () => {
    const board = mutable(); board.resourceNodes['A-02']!.id = 'A-01'; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('DUPLICATE_ID');
    expect(codes(validateBoardDefinition(board))).toContain('ID_KEY');
  });
  it('rejects duplicate route IDs and region IDs', () => {
    const board = mutable(); board.routes['F-route-02']!.id = 'F-route-01'; board.regions['B']!.id = 'A'; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('DUPLICATE_ID');
  });
  it('rejects duplicate slot ownership', () => {
    const board = mutable(); board.resourceNodes['A-02']!.influenceSlotIds[0] = 'node:A-01:slot:1'; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('SLOT_OWNERSHIP');
  });
  it('rejects repeated slot IDs inside the same owner', () => {
    const board = mutable(); board.resourceNodes['A-01']!.influenceSlotIds[1] = 'node:A-01:slot:1'; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('DUPLICATE_ID');
  });
  it('rejects incorrect slot owner types and orphan slots', () => {
    const board = mutable();
    board.influenceSlots['node:A-01:slot:1'] = { kind: 'route', routeId: 'F-route-01' };
    board.influenceSlots['node:A-01:slot:3'] = { kind: 'resource-node', nodeId: 'A-01' }; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('SLOT_LOCATION');
    expect(codes(validateBoardDefinition(board))).toContain('ORPHAN_SLOT');
  });
  it('rejects a missing slot and a nonexistent slot owner', () => {
    const board = mutable(); delete board.influenceSlots['node:A-01:slot:1'];
    board.influenceSlots['node:A-99:slot:1'] = { kind: 'resource-node', nodeId: 'A-99' }; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('MISSING_SLOT');
    expect(codes(validateBoardDefinition(board))).toContain('SLOT_REFERENCE');
  });
  it('rejects a single endpoint and repeated endpoints', () => {
    const single = mutable(); single.routes['F-route-01']!.incidentNodeIds = ['F-01']; rehash(single);
    expect(codes(validateBoardDefinition(single))).toContain('SCHEMA');
    const repeat = mutable(); repeat.routes['F-route-01']!.incidentNodeIds = ['F-01', 'F-01']; rehash(repeat);
    expect(codes(validateBoardDefinition(repeat))).toContain('ROUTE_ENDPOINTS');
    expect(codes(validateBoardDefinition(repeat))).toContain('DUPLICATE_ID');
  });
  it('rejects disconnected graphs with unchanged node, route and slot counts', () => {
    const board = mutable();
    for (const route of Object.values(board.routes)) {
      route.incidentNodeIds = route.incidentNodeIds.filter((id) => id !== 'A-01');
      if (route.incidentNodeIds.length === 1) route.incidentNodeIds.push('A-03');
    }
    rehash(board);
    expect(isBoardConnected(board)).toBe(false);
    expect(codes(validateBoardDefinition(board))).toContain('DISCONNECTED');
  });
  it('rejects an incorrect but connected route even after recomputing its hash', () => {
    const board = mutable(); board.routes['F-route-01']!.incidentNodeIds = ['F-03', 'F-02']; rehash(board);
    expect(isBoardConnected(board)).toBe(true);
    expect(codes(validateBoardDefinition(board))).toContain('ROUTE_FACT');
  });
  it('rejects missing inventory entries and incorrect capacity counts', () => {
    const board = mutable(); delete board.routes['R-route-09']; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('COUNT');
    expect(codes(validateBoardDefinition(board))).toContain('CATALOG_IDS');
    const slots = mutable(); slots.routes['F-route-01']!.influenceSlotIds.push('route:F-route-01:slot:2');
    slots.influenceSlots['route:F-route-01:slot:2'] = { kind: 'route', routeId: 'F-route-01' }; rehash(slots);
    expect(codes(validateBoardDefinition(slots))).toContain('ROUTE_SLOTS');
  });
  it('rejects incorrect node facts and region score despite valid totals', () => {
    const board = mutable(); board.resourceNodes['A-01']!.initialCityEligible = false;
    board.resourceNodes['E-02']!.redRestricted = false;
    board.resourceNodes['C-03']!.eventDeckColor = 'green';
    board.regions['E']!.controlRewardPoints = 3; board.regions['A']!.controlRewardPoints = 4; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('NODE_FACT');
    expect(codes(validateBoardDefinition(board))).toContain('REGION_SCORE');
  });
  it('rejects unknown region references and incorrect metadata IDs', () => {
    const board = mutable(); board.resourceNodes['A-01']!.regionId = 'G';
    board.routes['F-route-01']!.regionId = 'G'; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('REGION_REFERENCE');
  });
  it('rejects using the four-player topology as the three-player map', () => {
    const board = mutable(founders4); board.mapSide = 'three-player'; board.definitionId = 'founders-map-3'; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('CATALOG_IDS');
    expect(codes(validateBoardDefinition(board))).toContain('ROUTE_FACT');
  });
  it('rejects changed definition/schema versions even with a fresh content hash', () => {
    const board = mutable(); board.definitionVersion = '9.0.0'; board.schemaVersion = '2.0.0'; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('VERSION');
  });
  it('rejects a stale or malformed content digest', () => {
    const board = mutable(); board.regions['A']!.label = 'changed';
    expect(codes(validateBoardDefinition(board))).toContain('HASH');
    board.contentHash = 'not-a-hash';
    expect(codes(validateBoardDefinition(board))).toContain('SCHEMA');
  });
  it('rejects missing, duplicate or changed evidence references', () => {
    const board = mutable(); board.sourceRefs.push('photo-IMG_8183');
    board.routes['F-route-01']!.sourceRefs = ['unknown-source']; rehash(board);
    expect(codes(validateBoardDefinition(board))).toContain('SOURCE');
    expect(codes(validateBoardDefinition(board))).toContain('DUPLICATE_ID');
  });
  it('parse throws on invalid definitions and does not freeze a rejected caller object', () => {
    const board = mutable(); board.routes['F-route-01']!.incidentNodeIds = ['F-01', 'F-01'];
    expect(() => parseBoardDefinition(board)).toThrow('Invalid board definition');
    expect(Object.isFrozen(board)).toBe(false);
  });
});

describe('reproducible content hashes', () => {
  it.each([
    [founders3, 'sha256:dbe7945c709d50f435c320ad2d09ca98660400762aaedc93a65f73260b1aab92'],
    [founders4, 'sha256:f6e4455cf20f20efbd2bf56768051ac9d86ee459e3325687fb69598b057a41bc'],
  ] as const)('matches the frozen release digest for $definitionId', (board, hash) => {
    expect(computeBoardContentHash(board)).toBe(hash);
    expect(board.contentHash).toBe(hash);
  });
  it.each(maps)('matches Node SHA-256 over the documented canonical UTF-8 content for $definitionId', (board) => {
    const content = canonicalBoardContent(board);
    expect(JSON.parse(content).hashProtocol).toBe('nco-board-c14n-v1');
    expect(JSON.parse(content).definition.contentHash).toBeUndefined();
    expect(board.contentHash).toBe(`sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`);
  });
  it('ignores object insertion order and unordered ID array order', () => {
    const board = mutable(); board.resourceNodes = Object.fromEntries(Object.entries(board.resourceNodes).reverse());
    board.sourceRefs.reverse();
    for (const route of Object.values(board.routes)) { route.incidentNodeIds.reverse(); route.influenceSlotIds.reverse(); route.sourceRefs.reverse(); }
    expect(computeBoardContentHash(board)).toBe(founders3.contentHash);
    expect(validateBoardDefinition(board).success).toBe(true);
  });
  it('excludes only contentHash and changes for every other top-level field', () => {
    const board = mutable(); board.contentHash = `sha256:${'0'.repeat(64)}`;
    expect(computeBoardContentHash(board)).toBe(founders3.contentHash);
    const variants = [
      { ...board, definitionId: 'other-id' }, { ...board, definitionVersion: '1.0.1' },
      { ...board, schemaVersion: '1.0.1' }, { ...board, mapSide: 'four-player' as const },
      { ...board, sourceRefs: [...board.sourceRefs, 'extra-source'] },
      { ...board, regions: { ...board.regions, A: { ...board.regions['A']!, label: 'other' } } },
      { ...board, resourceNodes: { ...board.resourceNodes, 'A-01': { ...board.resourceNodes['A-01']!, redRestricted: true } } },
      { ...board, routes: { ...board.routes, 'F-route-01': { ...board.routes['F-route-01']!, incidentNodeIds: ['F-01', 'F-02'] } } },
      { ...board, influenceSlots: { ...board.influenceSlots, 'node:A-01:slot:1': { kind: 'resource-node' as const, nodeId: 'A-02' } } },
    ];
    for (const variant of variants) expect(computeBoardContentHash(variant)).not.toBe(founders3.contentHash);
  });
});

describe('definition references and state structure', () => {
  it('creates frozen empty states with exactly the map keys and a complete reference', () => {
    const state = createEmptyBoardState(founders3, ['p1', 'p2']);
    expect(validateBoardState(state, founders3).success).toBe(true);
    expect(Object.keys(state.resourceMarkerByNode)).toHaveLength(18);
    expect(Object.keys(state.influenceBySlot)).toHaveLength(66);
    expect(Object.values(state.influenceBySlot).every((slot) => slot === null)).toBe(true);
    expect(Object.isFrozen(state.influenceBySlot)).toBe(true);
  });
  it('accepts an exact reference and rejects wrong ID, version or digest', () => {
    const ref = createEmptyBoardState(founders3, ['p1']).definitionRef;
    expect(validateDefinitionRef(ref, founders3).success).toBe(true);
    for (const invalid of [
      { ...ref, definitionId: 'founders-map-4' }, { ...ref, definitionVersion: '1.0.1' },
      { ...ref, contentHash: founders4.contentHash },
    ]) expect(codes(validateDefinitionRef(invalid, founders3))).toContain('DEFINITION_REF');
  });
  it('rejects duplicate player IDs when creating a state', () => {
    expect(() => createEmptyBoardState(founders3, ['p1', 'p1'])).toThrow('unique');
  });
  it('rejects wrong state definition references and missing map keys', () => {
    const state = boardStateSchema.parse(createEmptyBoardState(founders3, ['p1']));
    delete state.influenceBySlot['node:A-01:slot:1']; state.definitionRef.definitionVersion = '1.0.1';
    expect(codes(validateBoardState(state, founders3))).toContain('STATE_KEYS');
    expect(codes(validateBoardState(state, founders3))).toContain('DEFINITION_REF');
  });
  it('rejects nonexistent/duplicate city positions, marker duplication and unknown owners', () => {
    const state = boardStateSchema.parse(createEmptyBoardState(founders3, ['p1', 'p2', 'p3']));
    state.cityNodeByPlayer['p1'] = 'A-01'; state.cityNodeByPlayer['p2'] = 'A-01'; state.cityNodeByPlayer['p3'] = 'A-99';
    state.influenceBySlot['node:A-01:slot:1'] = { ownerPlayerId: 'p4', markerId: 'm1' };
    state.influenceBySlot['node:A-01:slot:2'] = { ownerPlayerId: 'p1', markerId: 'm1' };
    const issues = codes(validateBoardState(state, founders3));
    for (const code of ['CITY_DUPLICATE', 'CITY_REFERENCE', 'PLAYER_REFERENCE', 'MARKER_DUPLICATE']) expect(issues).toContain(code);
  });
});
