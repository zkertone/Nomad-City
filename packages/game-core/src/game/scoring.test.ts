import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { getFoundersEventCard } from '../events/index.js';
import {
  createPreEntryGame, gamePositionSchema, gameDefinitionSchema, getGamePosition,
  getRegionControl, getResourceScoreBreakdown, getBaseScoringPreview, ScoringError,
} from './index.js';
import type { PlayerSetup, ResourceBalances } from './types.js';

const seats: readonly PlayerSetup[] = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
const zero: ResourceBalances = { orirock: 0, originium: 0, iron: 0, 'columbia-voucher': 0, 'pure-originium': 0 };
function fixture(count = 3, players: readonly PlayerSetup[] = seats.slice(0, count)) {
  const { definition, state } = createPreEntryGame('scoring-test', players);
  return { definition, position: gamePositionSchema.parse(getGamePosition(state, definition)), board: loadFoundersBoard(count === 4 ? 'four-player' : 'three-player') };
}
type Position = ReturnType<typeof gamePositionSchema.parse>;
function put(position: Position, slotId: string, owner = 'p1') {
  const markerId = position.markerSupplyByPlayer[owner]!.shift()!;
  if (!markerId || position.board.influenceBySlot[slotId] !== null) throw new Error('Invalid fixture transfer');
  position.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: owner };
}
function reveal(position: Position, nodeId: string, cardId: string) {
  const card = getFoundersEventCard(cardId);
  position.board.resourceMarkerByNode[nodeId] = { markerDefinitionId: cardId, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
}
function city(position: Position, nodeId = 'A-01', playerId = 'p1', cardId = 'G03') {
  reveal(position, nodeId, cardId); position.board.cityNodeByPlayer[playerId] = nodeId;
}
function scoringError(fn: () => unknown) {
  try { fn(); throw new Error('Expected overflow'); }
  catch (error) { expect(error).toBeInstanceOf(ScoringError); expect((error as ScoringError).code).toBe('SCORE_OVERFLOW'); }
}

describe('derived region control on the independent maps', () => {
  it.each([2, 3, 4])('returns exactly the %i-player map regions, with no award for empty regions', count => {
    const f = fixture(count), regions = getRegionControl(f.position, f.definition);
    expect(Object.keys(regions)).toEqual(Object.keys(f.board.regions));
    expect(Object.keys(regions)).toHaveLength(count === 4 ? 8 : 7);
    expect(Object.values(regions).reduce((sum, region) => sum + region.rewardPoints, 0)).toBe(count === 4 ? 26 : 23);
    for (const region of Object.values(regions)) {
      expect(region.controllerPlayerId).toBeNull(); expect(region.leadingPlayerIds).toEqual([]);
      expect(Object.keys(region.influenceByPlayer)).toEqual(seats.slice(0, count).map(player => player.id));
      expect(Object.values(region.influenceByPlayer).every(value => value.total === 0)).toBe(true);
    }
  });
  it('adds city +2 without consuming influence slots or supply', () => {
    const f = fixture(); city(f.position);
    const before = structuredClone(f.position); const a = getRegionControl(f.position, f.definition).A!;
    expect(a.influenceByPlayer.p1).toEqual({ nodeMarkers: 0, routeMarkers: 0, cityInfluence: 2, total: 2 });
    expect(a.controllerPlayerId).toBe('p1'); expect(f.position).toEqual(before);
    expect(f.position.board.influenceBySlot['node:A-01:slot:1']).toBeNull(); expect(f.position.markerSupplyByPlayer.p1).toHaveLength(29);
  });
  it('adds real influence markers and city influence independently', () => {
    const f = fixture(); city(f.position); put(f.position, 'node:A-01:slot:1'); put(f.position, 'node:A-01:slot:2'); put(f.position, 'route:A-route-01:slot:1');
    expect(getRegionControl(f.position, f.definition).A!.influenceByPlayer.p1).toEqual({ nodeMarkers: 2, routeMarkers: 1, cityInfluence: 2, total: 5 });
  });
  it('awards neither player when cities alone tie', () => {
    const f = fixture(); city(f.position); city(f.position, 'A-02', 'p2', 'G02');
    const a = getRegionControl(f.position, f.definition).A!;
    expect(a.leadingPlayerIds).toEqual(['p1', 'p2']); expect(a.controllerPlayerId).toBeNull();
    expect(getBaseScoringPreview(f.position, f.definition).players.p1!.regionPoints).toBe(0);
  });
  it('lets city +2 overtake a marker majority, and includes its own point markers', () => {
    const f = fixture(); city(f.position, 'D-01', 'p1', 'Y01');
    put(f.position, 'route:D-route-01:slot:1', 'p2'); put(f.position, 'route:D-route-02:slot:1', 'p2');
    expect(getRegionControl(f.position, f.definition).D!.controllerPlayerId).toBeNull();
    put(f.position, 'node:D-01:slot:1');
    expect(getRegionControl(f.position, f.definition).D!.controllerPlayerId).toBe('p1');
  });
  it('does not award the third player below a positive tie', () => {
    const f = fixture(); reveal(f.position, 'A-01', 'G03'); reveal(f.position, 'A-02', 'G02');
    put(f.position, 'node:A-01:slot:1'); put(f.position, 'node:A-01:slot:2');
    put(f.position, 'node:A-02:slot:1', 'p2'); put(f.position, 'node:A-02:slot:2', 'p2'); put(f.position, 'route:A-route-01:slot:1', 'p3');
    const a = getRegionControl(f.position, f.definition).A!;
    expect(a.leadingPlayerIds).toEqual(['p1', 'p2']); expect(a.controllerPlayerId).toBeNull();
    expect(getBaseScoringPreview(f.position, f.definition).players.p3!.regionPoints).toBe(0);
  });
  it.each([3, 4])('counts a four-end route slot once on the %i-player map', count => {
    const f = fixture(count); put(f.position, 'route:D-route-01:slot:1');
    const regions = getRegionControl(f.position, f.definition);
    expect(regions.D!.influenceByPlayer.p1!.total).toBe(1); expect(regions.A!.influenceByPlayer.p1!.total).toBe(0);
    expect(regions.D!.controllerPlayerId).toBe('p1');
  });
  it.each([3, 4])('does not copy a three-end route marker into endpoint regions for %i players', count => {
    const f = fixture(count); put(f.position, 'route:A-route-02:slot:1');
    const regions = getRegionControl(f.position, f.definition);
    expect(regions.A!.influenceByPlayer.p1!.routeMarkers).toBe(1); expect(regions.B!.influenceByPlayer.p1!.total).toBe(0);
  });
  it('uses the node region for a city even when another region route meets that node', () => {
    const f = fixture(); city(f.position, 'A-03', 'p1', 'Y01'); put(f.position, 'route:D-route-01:slot:1', 'p2');
    const regions = getRegionControl(f.position, f.definition);
    expect(regions.A!.influenceByPlayer.p1!.cityInfluence).toBe(2); expect(regions.D!.influenceByPlayer.p1!.cityInfluence).toBe(0);
    expect(regions.D!.controllerPlayerId).toBe('p2');
  });
  it('counts the three-player gray route in R and awards its 3 points', () => {
    const f = fixture(); put(f.position, 'route:R-route-09:slot:1');
    const preview = getBaseScoringPreview(f.position, f.definition);
    expect(preview.regions.R!.controllerPlayerId).toBe('p1'); expect(preview.regions.C!.controllerPlayerId).toBeNull();
    expect(preview.regions.E!.controllerPlayerId).toBeNull(); expect(preview.players.p1!.regionPoints).toBe(3);
  });
  it.each([2, 3, 4])('awards E/F 4 each and every other present region 3 for %i players', count => {
    const f = fixture(count);
    for (const region of Object.values(f.board.regions)) {
      const route = Object.values(f.board.routes).find(route => route.regionId === region.id)!;
      put(f.position, route.influenceSlotIds[0]!);
    }
    const result = getBaseScoringPreview(f.position, f.definition);
    expect(result.regions.E!.rewardPoints).toBe(4); expect(result.regions.F!.rewardPoints).toBe(4);
    expect(result.players.p1!.regionPoints).toBe(count === 4 ? 26 : 23);
  });
  it('does not count supply, score marker, balances or earlier earned score as influence', () => {
    const f = fixture(); f.position.players.p1!.score = 100; f.position.players.p1!.balances.iron = 99;
    expect(Object.values(getRegionControl(f.position, f.definition)).every(region => region.controllerPlayerId === null)).toBe(true);
  });
});

describe('printed resource groups and exact integer arithmetic', () => {
  it.each([
    ['orirock', 9], ['originium', 8], ['iron', 6], ['pure-originium', 1],
  ] as const)('scores %s by its own group of %i', (asset, divisor) => {
    for (const amount of [...new Set([0, divisor - 1, divisor, divisor + 1, divisor * 2 - 1, divisor * 2])]) {
      const result = getResourceScoreBreakdown({ ...zero, [asset]: amount });
      expect(result.totalPoints).toBe(Math.floor(amount / divisor));
      expect(result.pointsByAsset[asset]).toBe(Math.floor(amount / divisor));
      expect(result.unscoredRemainders[asset]).toBe(amount % divisor);
    }
  });
  it('does not pool fractional resource groups or round them up', () => {
    const result = getResourceScoreBreakdown({ orirock: 8, originium: 7, iron: 5, 'pure-originium': 0, 'columbia-voucher': 999 });
    expect(result.totalPoints).toBe(0); expect(result.unscoredRemainders).toEqual({ orirock: 8, originium: 7, iron: 5, 'pure-originium': 0 });
  });
  it('scores all resource kinds together and keeps vouchers out of points', () => {
    const balances = { orirock: 19, originium: 17, iron: 13, 'pure-originium': 3, 'columbia-voucher': 100 };
    const before = structuredClone(balances), result = getResourceScoreBreakdown(balances);
    expect(result.pointsByAsset).toEqual({ orirock: 2, originium: 2, iron: 2, 'pure-originium': 3 });
    expect(result.totalPoints).toBe(9); expect(balances).toEqual(before);
  });
  it.each(['orirock', 'originium', 'iron', 'pure-originium'] as const)('handles maximum safe %s exactly', asset => {
    const divisor = { orirock: 9n, originium: 8n, iron: 6n, 'pure-originium': 1n }[asset];
    const result = getResourceScoreBreakdown({ ...zero, [asset]: Number.MAX_SAFE_INTEGER });
    expect(result.totalPoints).toBe(Number(BigInt(Number.MAX_SAFE_INTEGER) / divisor));
    expect(result.unscoredRemainders[asset]).toBe(Number(BigInt(Number.MAX_SAFE_INTEGER) % divisor));
  });
  it('rejects combined resource score overflow instead of rounding', () => {
    scoringError(() => getResourceScoreBreakdown({ ...zero, iron: 6, 'pure-originium': Number.MAX_SAFE_INTEGER }));
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid amount %s', amount => {
    expect(() => getResourceScoreBreakdown({ ...zero, iron: amount })).toThrow();
  });
  it('rejects unknown assets and missing balances at runtime', () => {
    expect(() => getResourceScoreBreakdown({ ...zero, steel: 5 } as ResourceBalances)).toThrow();
    const { iron: _ignored, ...incomplete } = zero; expect(() => getResourceScoreBreakdown(incomplete as ResourceBalances)).toThrow();
  });
});

describe('base score preview and printed sequential tiebreakers', () => {
  it('adds existing points, unique region award and remaining resource points without mutating scores', () => {
    const f = fixture(); city(f.position); f.position.players.p1!.score = 5;
    f.position.players.p1!.balances = { orirock: 9, originium: 8, iron: 6, 'pure-originium': 2, 'columbia-voucher': 7 };
    const before = structuredClone(f.position); const result = getBaseScoringPreview(f.position, f.definition);
    expect(result.scope).toBe('base-components-only'); expect(result.players.p1).toMatchObject({ existingPoints: 5, regionPoints: 3, resources: { totalPoints: 5 }, totalPoints: 13, remainingVouchers: 7, remainingPureOriginium: 2 });
    expect(result.leadingPlayerIds).toEqual(['p1']); expect(result.resolvedBy).toBe('score'); expect(f.position).toEqual(before);
    expect(getBaseScoringPreview(f.position, f.definition)).toEqual(result); expect(f.position.players.p1!.score).toBe(5);
  });
  it('compares points before vouchers or pure originium', () => {
    const f = fixture(); f.position.players.p1!.score = 5;
    f.position.players.p2!.balances['columbia-voucher'] = 100; f.position.players.p2!.balances['pure-originium'] = 4;
    const result = getBaseScoringPreview(f.position, f.definition); expect(result.leadingPlayerIds).toEqual(['p1']); expect(result.resolvedBy).toBe('score');
  });
  it('uses vouchers as first tiebreak, even against greater remaining pure originium', () => {
    const f = fixture(); f.position.players.p1!.score = 5; f.position.players.p1!.balances['columbia-voucher'] = 2;
    f.position.players.p2!.score = 1; f.position.players.p2!.balances['pure-originium'] = 4; f.position.players.p2!.balances['columbia-voucher'] = 1;
    const result = getBaseScoringPreview(f.position, f.definition); expect(result.leadingPlayerIds).toEqual(['p1']); expect(result.resolvedBy).toBe('columbia-voucher');
  });
  it('uses pure originium only after equal total points and vouchers', () => {
    const f = fixture(); f.position.players.p1!.score = 5; f.position.players.p2!.score = 3; f.position.players.p2!.balances['pure-originium'] = 2;
    const result = getBaseScoringPreview(f.position, f.definition); expect(result.players.p1!.totalPoints).toBe(result.players.p2!.totalPoints);
    expect(result.leadingPlayerIds).toEqual(['p2']); expect(result.resolvedBy).toBe('pure-originium');
    expect(f.position.players.p2!.balances['pure-originium']).toBe(2);
  });
  it('preserves shared victory candidates with equal points, vouchers and pure originium', () => {
    const f = fixture(4); f.position.players.p1!.score = 5; f.position.players.p2!.score = 5; f.position.players.p4!.score = 5;
    const result = getBaseScoringPreview(f.position, f.definition); expect(result.leadingPlayerIds).toEqual(['p1', 'p2', 'p4']); expect(result.resolvedBy).toBe('shared');
  });
  it('does not bring a lower scorer back into contention through vouchers', () => {
    const f = fixture(); f.position.players.p1!.score = 5; f.position.players.p2!.score = 5; f.position.players.p3!.score = 4;
    f.position.players.p2!.balances['columbia-voucher'] = 2; f.position.players.p3!.balances['columbia-voucher'] = 999;
    expect(getBaseScoringPreview(f.position, f.definition).leadingPlayerIds).toEqual(['p2']);
  });
  it('does not use ordinary leftovers, supply count, player order or color as extra tiebreakers', () => {
    const f = fixture(); f.position.players.p1!.balances.iron = 5; put(f.position, 'route:D-route-01:slot:1', 'p1'); put(f.position, 'route:D-route-01:slot:2', 'p2');
    const result = getBaseScoringPreview(f.position, f.definition); expect(result.leadingPlayerIds).toEqual(['p1', 'p2', 'p3']); expect(result.resolvedBy).toBe('shared');
  });
  it('handles negative existing scores and compares the actual maximum', () => {
    const f = fixture(); f.position.players.p1!.score = -3; f.position.players.p2!.score = -1; f.position.players.p3!.score = -2;
    expect(getBaseScoringPreview(f.position, f.definition).leadingPlayerIds).toEqual(['p2']);
  });
  it('accepts the maximum exact total and rejects overflow without a partial score write', () => {
    const f = fixture(); f.position.players.p1!.score = Number.MAX_SAFE_INTEGER - 1; f.position.players.p1!.balances.iron = 6;
    expect(getBaseScoringPreview(f.position, f.definition).players.p1!.totalPoints).toBe(Number.MAX_SAFE_INTEGER);
    f.position.players.p1!.balances.iron = 12; const before = structuredClone(f.position);
    scoringError(() => getBaseScoringPreview(f.position, f.definition)); expect(f.position).toEqual(before);
  });
  it('rejects overflow caused by region awards as well as resources', () => {
    const f = fixture(); city(f.position); f.position.players.p1!.score = Number.MAX_SAFE_INTEGER - 2;
    scoringError(() => getBaseScoringPreview(f.position, f.definition));
  });
  it('computes negative-plus-positive totals exactly without unsafe intermediate number addition', () => {
    const f = fixture(); city(f.position); f.position.players.p1!.score = -Number.MAX_SAFE_INTEGER; f.position.players.p1!.balances['pure-originium'] = Number.MAX_SAFE_INTEGER;
    expect(getBaseScoringPreview(f.position, f.definition).players.p1!.totalPoints).toBe(3);
  });
});

describe('read-only scope, validation and storage invariants', () => {
  it('validates snapshots and definition references instead of trusting a cached controller', () => {
    const f = fixture(); const forged = { ...f.position, regionControllerById: { A: 'p1' } };
    expect(() => getRegionControl(forged, f.definition)).toThrow();
    f.position.board.definitionRef.contentHash = `sha256:${'0'.repeat(64)}`;
    expect(() => getBaseScoringPreview(f.position, f.definition)).toThrow();
  });
  it.each(['owner', 'reused', 'unknown-slot', 'unknown-city'])('rejects invalid %s facts before counting', kind => {
    const f = fixture(); put(f.position, 'route:A-route-01:slot:1');
    if (kind === 'owner') f.position.board.influenceBySlot['route:A-route-01:slot:1']!.ownerPlayerId = 'p2';
    if (kind === 'reused') f.position.board.influenceBySlot['route:A-route-02:slot:1'] = f.position.board.influenceBySlot['route:A-route-01:slot:1']!;
    if (kind === 'unknown-slot') f.position.board.influenceBySlot['route:A-route-99:slot:1'] = null;
    if (kind === 'unknown-city') f.position.board.cityNodeByPlayer.p1 = 'A-99';
    expect(() => getRegionControl(f.position, f.definition)).toThrow(); expect(() => getBaseScoringPreview(f.position, f.definition)).toThrow();
  });
  it('rejects mismatched ruleset and changed map content hash', () => {
    const f = fixture(), definition = gameDefinitionSchema.parse(f.definition); definition.rulesetId = 'founders-base-4p';
    expect(() => getBaseScoringPreview(f.position, definition)).toThrow();
  });
  it('returns deeply frozen copies and leaves inputs editable and unchanged', () => {
    const f = fixture(), before = structuredClone(f.position);
    const visit = (value: unknown): void => { if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(visit); } };
    visit(getRegionControl(f.position, f.definition)); visit(getBaseScoringPreview(f.position, f.definition)); visit(getResourceScoreBreakdown(zero));
    expect(Object.isFrozen(f.position)).toBe(false); expect(f.position).toEqual(before);
  });
  it('preserves results across JSON position save/reload without a score cache', () => {
    const f = fixture(); city(f.position); put(f.position, 'route:E-route-01:slot:1', 'p2');
    expect(getBaseScoringPreview(JSON.parse(JSON.stringify(f.position)), f.definition)).toEqual(getBaseScoringPreview(f.position, f.definition));
  });
  it('handles registered constructor and toString player IDs without inherited entries', () => {
    const players: readonly PlayerSetup[] = [{ id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' }];
    const f = fixture(2, players); city(f.position, 'A-01', 'constructor'); put(f.position, 'route:E-route-01:slot:1', 'toString');
    const result = getBaseScoringPreview(f.position, f.definition);
    expect(Object.keys(result.players)).toEqual(['constructor', 'toString']); expect(result.leadingPlayerIds).toEqual(['toString']);
    expect(result.regions.A!.controllerPlayerId).toBe('constructor');
  });
  it('works on a minimal position without granting an action or inventing a completed game', () => {
    const { state, definition } = createPreEntryGame('preview-only', seats.slice(0, 2));
    const before = JSON.stringify(state); const result = getBaseScoringPreview(getGamePosition(state, definition), definition);
    expect(result.scope).toBe('base-components-only'); expect(result.leadingPlayerIds).toEqual(['p1', 'p2']);
    expect(JSON.stringify(state)).toBe(before); expect(state.phase).toBe('entry'); expect(state.stateVersion).toBe(0);
  });
});
