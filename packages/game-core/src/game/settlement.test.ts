import { describe, expect, it } from 'vitest';
import { loadFoundersBoard } from '../board/index.js';
import { getFoundersEventCard } from '../events/index.js';
import {
  createPreEntryGame, getGamePosition, gamePositionSchema, validateGamePosition, parseGamePosition,
  settleEventChoice, getEventChoiceRequirements, EventSettlementError, beginEntry,
} from './index.js';
import type { PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
function fixture(cardId = 'Y05', count = 4, players = seats.slice(0, count)) {
  const game = createPreEntryGame('settlement-test', players);
  const position = gamePositionSchema.parse(getGamePosition(game.state, game.definition));
  const board = loadFoundersBoard(count === 4 ? 'four-player' : 'three-player');
  const card = getFoundersEventCard(cardId);
  const nodeId = Object.values(board.resourceNodes).find(node => node.eventDeckColor === card.color)!.id;
  position.board.resourceMarkerByNode[nodeId] = { markerDefinitionId: card.id,
    resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
  const actorId = players[0]!.id;
  position.players[actorId]!.balances['columbia-voucher'] = 20;
  return { ...game, position, board, context: { gameId: game.definition.gameId, actorId, nodeId, cardId } };
}
type Fixture = ReturnType<typeof fixture>;
type MutablePosition = Fixture['position'];
const requirements = (f: Fixture, choiceId: string) => getEventChoiceRequirements(f.position, f.definition, f.context, choiceId);
function place(f: Fixture, slotId: string, playerId = 'p2') {
  const markerId = f.position.markerSupplyByPlayer[playerId]!.shift()!;
  if (!markerId) throw new Error('Fixture exhausted');
  f.position.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: playerId };
}
function emptyActorSupply(f: Fixture) {
  const routeSlots = Object.entries(f.board.influenceSlots).filter(([, slot]) => slot.kind === 'route').map(([id]) => id);
  for (const slotId of routeSlots.slice(0, f.position.markerSupplyByPlayer[f.context.actorId]!.length)) place(f, slotId, f.context.actorId);
  expect(f.position.markerSupplyByPlayer[f.context.actorId]).toHaveLength(0);
}
function blockAvailable(f: Fixture, choiceId: string) {
  const slots = [...requirements(f, choiceId).legalInfluenceSlotIds];
  for (const slotId of slots) {
    const donor = f.definition.players.find(player => player.id !== f.context.actorId && f.position.markerSupplyByPlayer[player.id]!.length)!;
    place(f, slotId, donor.id);
  }
  expect(requirements(f, choiceId).legalInfluenceSlotIds).toEqual([]);
}
const errorCode = (fn: () => unknown, code: string) => {
  try { fn(); throw new Error('Expected settlement rejection'); }
  catch (error) { expect(error).toBeInstanceOf(EventSettlementError); expect((error as EventSettlementError).code).toBe(code); }
};

// Independent literal expectations transcribed from the confirmed review, not computed from effects.
type Delta = Partial<Record<'orirock' | 'originium' | 'iron' | 'columbia-voucher' | 'pure-originium' | 'point', number>>;
const outcomes: readonly [string, Delta, Delta?, boolean?][] = [
  ['G01:1', { iron: 2, 'columbia-voucher': 2 }], ['G01:2', { orirock: 4 }],
  ['G02:1', { 'columbia-voucher': 7 }], ['G02:2', { originium: 3 }],
  ['G03:1', { originium: 3 }], ['G03:2', { 'columbia-voucher': 7 }],
  ['G04:1', { originium: 3 }], ['G04:2', { iron: 2, 'columbia-voucher': 2 }],
  ['G05:1', { orirock: 4 }], ['G05:2', { originium: 3 }],
  ['G06:1', { orirock: 4 }], ['G06:2', { originium: 3 }],
  ['Y01:1', { iron: 3 }], ['Y01:2', { originium: 4 }],
  ['Y02:1', { orirock: 3, iron: 1 }], ['Y02:2', { originium: 4 }],
  ['Y03:1', { orirock: 5 }], ['Y03:2', { 'columbia-voucher': 4, point: 1 }],
  ['Y04:1', { iron: 3 }], ['Y04:2', { originium: 4 }],
  ['Y05:1', { 'columbia-voucher': -4 }, {}, true],
  ['Y05:2', { 'columbia-voucher': 10 }], ['Y05:3', { originium: 4 }],
  ['Y06:1', { orirock: 3, iron: 1 }], ['Y06:2', { 'columbia-voucher': 13 }, { iron: 1 }],
  ['Y07:1', { orirock: 5 }], ['Y07:2', { 'columbia-voucher': 10 }],
  ['Y08:1', {}, {}, true], ['Y08:2', { orirock: 1, originium: 3 }], ['Y08:3', { iron: 3 }],
  ['Y09:1', { iron: 3 }], ['Y09:2', { originium: 2, 'columbia-voucher': 5 }],
  ['Y10:1', { iron: 3 }], ['Y10:2', { orirock: 2, point: 1 }],
  ['R01:1', { orirock: 1, 'pure-originium': 1 }], ['R01:2', { originium: 3, iron: 2 }],
  ['R01:3', { 'columbia-voucher': 18 }, { 'columbia-voucher': 3 }],
  ['R02:1', { orirock: 4, originium: 3 }], ['R02:2', { iron: 4, 'columbia-voucher': 5 }],
  ['R03:1', { originium: 1, 'pure-originium': 1 }], ['R03:2', { orirock: 3, iron: 3 }],
  ['R04:1', { iron: 1, 'pure-originium': 1 }], ['R04:2', { orirock: 3, originium: 3 }],
  ['R05:1', { orirock: 2, originium: 2, iron: 2 }], ['R05:2', { 'columbia-voucher': 18 }],
  ['R05:3', { 'pure-originium': 1, 'columbia-voucher': 4 }],
  ['R06:1', { orirock: 7 }], ['R06:2', { originium: 6 }], ['R06:3', { 'columbia-voucher': 6 }, {}, true],
];
function expectDelta(before: MutablePosition, after: ReturnType<typeof settleEventChoice>['position'], playerId: string, delta: Delta) {
  for (const asset of ['orirock', 'originium', 'iron', 'columbia-voucher', 'pure-originium', 'point'] as const) {
    const old = asset === 'point' ? before.players[playerId]!.score : before.players[playerId]!.balances[asset];
    const actual = asset === 'point' ? after.players[playerId]!.score : after.players[playerId]!.balances[asset];
    expect(actual - old, `${playerId}/${asset}`).toBe(delta[asset] ?? 0);
  }
}
describe('all 49 confirmed base event options execute', () => {
  it.each(outcomes)('%s applies only its printed rewards/cost', (choiceId, actorDelta, opponentDelta = {}, hasPlacement = false) => {
    const f = fixture(choiceId.split(':')[0]!);
    const before = structuredClone(f.position);
    const slotId = hasPlacement ? requirements(f, choiceId).legalInfluenceSlotIds[0]! : undefined;
    const result = settleEventChoice(f.position, f.definition, f.context, {
      choiceId, ...(hasPlacement ? { influenceSlotId: slotId } : {}), ...(choiceId === 'Y05:1' ? { costDecision: 'pay' } : {}),
    });
    expectDelta(before, result.position, 'p1', actorDelta);
    for (const id of ['p2', 'p3', 'p4']) expectDelta(before, result.position, id, opponentDelta);
    expect(result.position.markerSupplyByPlayer.p1).toHaveLength(hasPlacement ? 28 : 29);
    expect(result.position.board.resourceMarkerByNode).toEqual(before.board.resourceMarkerByNode);
    expect(result.position.board.cityNodeByPlayer).toEqual(before.board.cityNodeByPlayer);
    if (hasPlacement) expect(result.position.board.influenceBySlot[slotId!]).toEqual({ markerId: before.markerSupplyByPlayer.p1![0], ownerPlayerId: 'p1' });
    expect(validateGamePosition(result.position, f.definition).success).toBe(true);
    expect(f.position).toEqual(before);
  });
});

describe('conditional costs and best-effort execution', () => {
  it.each([0, 3, 4, 20])('allows explicit decline with %i vouchers without cost or influence', money => {
    const f = fixture(); f.position.players.p1!.balances['columbia-voucher'] = money;
    const r = settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y05:1', costDecision: 'decline' });
    expect(r.position).toEqual(f.position); expect(r.receipt.cost).toEqual({ status: 'declined' }); expect(r.receipt.effects).toEqual([]);
  });
  it('requires the whole 4 vouchers, even if placement is impossible', () => {
    const f = fixture(); f.position.players.p1!.balances['columbia-voucher'] = 3; emptyActorSupply(f);
    expect(requirements(f, 'Y05:1')).toMatchObject({ requiresCostDecision: true, canPay: false, legalInfluenceSlotIds: [] });
    const original = structuredClone(f.position);
    errorCode(() => settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y05:1', costDecision: 'pay' }), 'CANNOT_PAY');
    expect(f.position).toEqual(original);
  });
  it('can pay exactly 4 and uses exactly one real marker', () => {
    const f = fixture(); f.position.players.p1!.balances['columbia-voucher'] = 4;
    const r = settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: requirements(f, 'Y05:1').legalInfluenceSlotIds[0] });
    expect(r.position.players.p1!.balances['columbia-voucher']).toBe(0);
    expect(r.receipt.cost).toEqual({ status: 'paid', asset: 'columbia-voucher', amount: 4 });
  });
  it.each(['supply', 'slot'])('retains paid cost when no %s remains', blocker => {
    const f = fixture(); if (blocker === 'supply') emptyActorSupply(f); else blockAvailable(f, 'Y05:1');
    const r = settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: null });
    expect(r.position.players.p1!.balances['columbia-voucher']).toBe(16);
    expect(r.receipt.effects).toEqual([{ kind: 'place-influence', effectIndex: 0, status: 'skipped', reason: blocker === 'supply' ? 'no-supply' : 'no-legal-slot' }]);
  });
  it.each(['supply', 'slot'])('R06:3 retains the preceding 6 vouchers when no %s remains', blocker => {
    const f = fixture('R06'); if (blocker === 'supply') emptyActorSupply(f); else blockAvailable(f, 'R06:3');
    const r = settleEventChoice(f.position, f.definition, f.context, { choiceId: 'R06:3' });
    expect(r.position.players.p1!.balances['columbia-voucher']).toBe(26);
    expect(r.receipt.effects).toEqual([
      { kind: 'gain', effectIndex: 0, playerId: 'p1', asset: 'columbia-voucher', amount: 6 },
      { kind: 'place-influence', effectIndex: 1, status: 'skipped', reason: blocker === 'supply' ? 'no-supply' : 'no-legal-slot' },
    ]);
  });
  it('Y08:1 resolves without inventing a marker when supply is empty', () => {
    const f = fixture('Y08'); emptyActorSupply(f);
    const r = settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y08:1' });
    expect(r.position).toEqual(f.position); expect(r.receipt.effects[0]).toMatchObject({ status: 'skipped', reason: 'no-supply' });
  });
});

describe('placement ranges use route identity, not display coordinates', () => {
  it.each(['Y08', 'R06'])('%s rejects a real empty route outside the printed range', cardId => {
    const f = fixture(cardId);
    const route = Object.values(f.board.routes).find(route => !route.incidentNodeIds.includes(f.context.nodeId))!;
    errorCode(() => settleEventChoice(f.position, f.definition, f.context, {
      choiceId: cardId === 'Y08' ? 'Y08:1' : 'R06:3', influenceSlotId: route.influenceSlotIds[0],
    }), 'PLACEMENT_REQUIRED');
  });
  it('Y08 rejects even the explored event node as its placement target', () => {
    const f = fixture('Y08');
    errorCode(() => settleEventChoice(f.position, f.definition, f.context, {
      choiceId: 'Y08:1', influenceSlotId: f.board.resourceNodes[f.context.nodeId]!.influenceSlotIds[0],
    }), 'PLACEMENT_REQUIRED');
  });
  it('standard Y05 placement allows distant routes and own explored city, not unexplored/opponent city/occupied slots', () => {
    const f = fixture(); const nodeId = f.context.nodeId;
    f.position.board.cityNodeByPlayer.p1 = nodeId;
    const ownSlots = f.board.resourceNodes[nodeId]!.influenceSlotIds;
    const farRoute = Object.values(f.board.routes).find(route => !route.incidentNodeIds.includes(nodeId))!;
    let slots = requirements(f, 'Y05:1').legalInfluenceSlotIds;
    expect(slots).toEqual(expect.arrayContaining([...ownSlots, ...farRoute.influenceSlotIds]));
    const unexplored = Object.values(f.board.resourceNodes).find(node => node.id !== nodeId)!;
    expect(slots).not.toEqual(expect.arrayContaining([...unexplored.influenceSlotIds]));
    place(f, farRoute.influenceSlotIds[0]!);
    f.position.board.cityNodeByPlayer.p1 = null; f.position.board.cityNodeByPlayer.p2 = nodeId;
    slots = requirements(f, 'Y05:1').legalInfluenceSlotIds;
    expect(slots).not.toContain(farRoute.influenceSlotIds[0]);
    for (const id of ownSlots) expect(slots).not.toContain(id);
  });
  it('Y08 permits only its incident route slots, including all slots of a fork', () => {
    const f = fixture('Y08');
    const fork = Object.values(f.board.routes).find(route => route.incidentNodeIds.length === 4 && route.incidentNodeIds.some(id => f.board.resourceNodes[id]!.eventDeckColor === 'yellow'))!;
    const node = fork.incidentNodeIds.find(id => f.board.resourceNodes[id]!.eventDeckColor === 'yellow')!;
    f.position.board.resourceMarkerByNode[node] = f.position.board.resourceMarkerByNode[f.context.nodeId]!;
    if (node !== f.context.nodeId) f.position.board.resourceMarkerByNode[f.context.nodeId] = null;
    f.context.nodeId = node;
    const expected = Object.values(f.board.routes).filter(route => route.incidentNodeIds.includes(node)).flatMap(route => [...route.influenceSlotIds]);
    expect([...requirements(f, 'Y08:1').legalInfluenceSlotIds].sort()).toEqual(expected.sort());
    expect(expected).toEqual(expect.arrayContaining([...fork.influenceSlotIds]));
  });
  it('R06 includes event node and incident routes, excludes a different explored node on the same route', () => {
    const f = fixture('R06');
    const incident = Object.values(f.board.routes).find(route => route.incidentNodeIds.includes(f.context.nodeId))!;
    const other = incident.incidentNodeIds.find(id => id !== f.context.nodeId)!;
    const otherCard = getFoundersEventCard(f.board.resourceNodes[other]!.eventDeckColor === 'green' ? 'G02' : f.board.resourceNodes[other]!.eventDeckColor === 'yellow' ? 'Y01' : 'R02');
    f.position.board.resourceMarkerByNode[other] = { markerDefinitionId: otherCard.id, resourceKind: otherCard.resourceMarker.resource, harvestAmount: otherCard.resourceMarker.harvestAmount };
    const slots = requirements(f, 'R06:3').legalInfluenceSlotIds;
    expect(slots).toEqual(expect.arrayContaining([...f.board.resourceNodes[f.context.nodeId]!.influenceSlotIds, ...incident.influenceSlotIds]));
    for (const id of f.board.resourceNodes[other]!.influenceSlotIds) expect(slots).not.toContain(id);
  });
  it('rejects an occupied slot and cannot abandon a possible placement', () => {
    const f = fixture('R06'); const slot = requirements(f, 'R06:3').legalInfluenceSlotIds[0]!; place(f, slot);
    for (const influenceSlotId of [undefined, null, slot, 'route:missing:1']) {
      errorCode(() => settleEventChoice(f.position, f.definition, f.context, { choiceId: 'R06:3', influenceSlotId }), influenceSlotId === 'route:missing:1' ? 'CHOICE_SCHEMA' : 'PLACEMENT_REQUIRED');
    }
  });
});

describe('opponent rewards and integer safety', () => {
  it('the red resource marker x2 does not double event rewards', () => {
    const f = fixture('R05');
    expect(f.position.board.resourceMarkerByNode[f.context.nodeId]!.harvestAmount).toBe(2);
    const r = settleEventChoice(f.position, f.definition, f.context, { choiceId: 'R05:2' });
    expect(r.position.players.p1!.balances['columbia-voucher']).toBe(38);
    expect(r.position.board.resourceMarkerByNode[f.context.nodeId]!.harvestAmount).toBe(2);
  });
  it.each([2, 3, 4])('Y06:2 rewards every opponent individually in a %ip game', count => {
    const f = fixture('Y06', count); const r = settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y06:2' });
    expect(r.position.players.p1!.balances.iron).toBe(0);
    expect(r.position.players.p1!.balances['columbia-voucher']).toBe(33);
    for (const player of f.definition.players.slice(1)) expect(r.position.players[player.id]!.balances.iron).toBe(1);
    expect(r.receipt.effects.map(effect => 'playerId' in effect ? effect.playerId : null)).toEqual(f.definition.players.map(player => player.id));
  });
  it.each(['actor', 'opponent'])('rejects %s overflow without leaking partial gains', target => {
    const f = fixture('Y06');
    if (target === 'actor') f.position.players.p1!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER;
    else f.position.players.p3!.balances.iron = Number.MAX_SAFE_INTEGER;
    const original = structuredClone(f.position);
    errorCode(() => settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y06:2' }), 'BALANCE_OVERFLOW');
    expect(f.position).toEqual(original);
  });
  it('checks score overflow separately and allows signed scores to gain', () => {
    const f = fixture('Y03'); f.position.players.p1!.score = -1;
    expect(settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y03:2' }).position.players.p1!.score).toBe(0);
    f.position.players.p1!.score = Number.MAX_SAFE_INTEGER;
    errorCode(() => settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y03:2' }), 'BALANCE_OVERFLOW');
  });
});

describe('trusted context, strict payload and shared facts', () => {
  it.each([
    [{ choiceId: 'Y05:1' }, 'COST_DECISION'],
    [{ choiceId: 'Y05:2', costDecision: 'pay' }, 'COST_DECISION'],
    [{ choiceId: 'Y05:2', influenceSlotId: null }, 'UNEXPECTED_PLACEMENT'],
    [{ choiceId: 'Y04:1' }, 'EVENT_CHOICE'],
    [{ choiceId: 'Y05:2', actorId: 'p2' }, 'CHOICE_SCHEMA'],
    [{ choiceId: 'Y05:2', cardId: 'R05' }, 'CHOICE_SCHEMA'],
    [{ choiceId: 'Y05:2', amount: 999 }, 'CHOICE_SCHEMA'],
    [{ choiceId: 'Y05:2', costDecision: 'refund' }, 'CHOICE_SCHEMA'],
  ])('rejects invalid player choice %j', (payload, code) => {
    const f = fixture(); errorCode(() => settleEventChoice(f.position, f.definition, f.context, payload), code as string);
  });
  it.each([
    [{ gameId: 'other-game' }, 'GAME_REFERENCE'], [{ actorId: 'ghost' }, 'ACTOR_REFERENCE'],
    [{ cardId: 'Y06' }, 'EVENT_REFERENCE'], [{ nodeId: 'A-01' }, 'EVENT_REFERENCE'],
    [{ nodeId: 'constructor' }, 'CONTEXT_SCHEMA'],
  ])('rejects inconsistent event context %j', (patch, code) => {
    const f = fixture(); errorCode(() => settleEventChoice(f.position, f.definition, { ...f.context, ...patch }, { choiceId: 'Y05:2' }), code as string);
  });
  it('does not silently ignore a target when the paid condition is declined or placement impossible', () => {
    const f = fixture(); const slot = requirements(f, 'Y05:1').legalInfluenceSlotIds[0]!;
    errorCode(() => settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y05:1', costDecision: 'decline', influenceSlotId: slot }), 'UNEXPECTED_PLACEMENT');
    emptyActorSupply(f);
    errorCode(() => settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y05:1', costDecision: 'pay', influenceSlotId: slot }), 'INFLUENCE_SLOT');
  });
  it.each([2, 3])('rejects a four-player marked card in %ip via shared facts', count => {
    const f = fixture('Y08', count);
    const validation = validateGamePosition(f.position, f.definition);
    expect(validation.success).toBe(false);
    if (!validation.success) expect(validation.issues.map(issue => issue.code)).toContain('RESOURCE_MARKER_PLAYERS');
    expect(() => settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y08:2' })).toThrow();
  });
  it('preserves the existing marker conservation checks for the settlement working view', () => {
    const f = fixture(); f.position.markerSupplyByPlayer.p1!.pop();
    const r = validateGamePosition(f.position, f.definition);
    expect(r.success).toBe(false); if (!r.success) expect(r.issues.map(issue => issue.code)).toContain('MARKER_MISSING');
    expect(() => parseGamePosition(f.position, f.definition)).toThrow();
  });
  it('extracts valid entry facts without weakening entry progress validation or changing formats', () => {
    const game = createPreEntryGame('entry-view', seats.slice(0, 3));
    const state = beginEntry(game.state, game.definition, { startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2', 'p3'], expectedVersion: 0 });
    const view = getGamePosition(state, game.definition);
    expect(Object.keys(view).sort()).toEqual(['board', 'gameId', 'markerSupplyByPlayer', 'players']);
    expect(state.schemaVersion).toBe('1.1.0'); expect(state.stateVersion).toBe(1);
    expect(validateGamePosition(state, game.definition).success).toBe(false);
  });
  it('supports prototype-like registered IDs through actual settlement and opponent payouts', () => {
    const f = fixture('Y06', 2, [{ id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' }]);
    const r = settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y06:2' });
    const first: string = 'constructor', second: string = 'toString';
    expect(r.position.players[first]!.balances['columbia-voucher']).toBe(33);
    expect(r.position.players[second]!.balances.iron).toBe(1);
  });
  it('roundtrips JSON and freezes the full result without freezing the input', () => {
    const f = fixture('R06'); const slotId = requirements(f, 'R06:3').legalInfluenceSlotIds[0]!;
    const r = settleEventChoice(JSON.parse(JSON.stringify(f.position)), f.definition, f.context, { choiceId: 'R06:3', influenceSlotId: slotId });
    expect(parseGamePosition(JSON.parse(JSON.stringify(r.position)), f.definition)).toEqual(r.position);
    const visit = (value: unknown): void => { if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(visit); } };
    visit(r); visit(requirements(f, 'R06:3')); expect(Object.isFrozen(f.position)).toBe(false);
  });
});
