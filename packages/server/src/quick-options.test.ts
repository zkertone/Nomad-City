import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@nomad-city-online/game-core';
import { createAutomaticBaseRoomSnapshot } from './base-room-factory.js';
import { baseSetupIds } from './automatic-base-plan.js';
import { parseRoomSnapshot } from './room-state.js';
import type { RoomSnapshot, RoomStore } from './room-state.js';
import { RoomService } from './room-service.js';
import { getRoomQuickPreview, quickPreviewRequestSchema } from './quick-options.js';
import type { QuickDraft } from './quick-options.js';
import { getRoomActionOptions } from './action-options.js';
import { getRoomConstructionPreview, constructionPreviewRequestSchema } from './construction-options.js';
const snapshots = new Map<number, RoomSnapshot>(),
  entries = new Map<number, RoomSnapshot>();
beforeAll(async () => {
  const seats = [
    { id: "p1", color: "red" },
    { id: "p2", color: "blue" },
    { id: "p3", color: "green" },
    { id: "p4", color: "yellow" },
  ];
  for (const count of [2, 3, 4]) {
    const green = core.FOUNDERS_EVENT_CATALOG.cards
      .filter(
        (c) => c.color === "green" && (count === 4 || !c.hasFourPlayerMark),
      )
      .map((c) => c.id);
    const initial = createAutomaticBaseRoomSnapshot({
      roomId: `quick-options-${count}`,
      gameId: `quick-game-${count}`,
      players: seats.slice(0, count),
      members: seats
        .slice(0, count)
        .map((p) => ({ playerId: p.id, userId: `user-${p.id}` })),
      startingPlayerId: "p1",
      clockwisePlayerIds: seats.slice(0, count).map((p) => p.id),
      setupOrders: {
        ...baseSetupIds(count),
        greenDeckOrder: ["G03", ...green.filter((id) => id !== "G03")],
      },
    });
    let state = initial.state;
    for (const [i, playerId] of state.entry!.playerOrder.entries()) {
      state = core.applyEntryCommand(
        state,
        initial.definition,
        { authenticatedPlayerId: playerId },
        {
          gameId: state.gameId,
          expectedVersion: state.stateVersion,
          type: "select-initial-node",
          nodeId: ["A-01", "A-02", "B-02", "C-01"][i],
        },
      );
      state = core.applyEntryCommand(
        state,
        initial.definition,
        { authenticatedPlayerId: playerId },
        {
          gameId: state.gameId,
          expectedVersion: state.stateVersion,
          type: "choose-green-event",
          choiceId: `${state.entry!.pendingEvent!.cardId}:1`,
        },
      );
    }
    if (count === 2)
      state = core.applyEntryCommand(
        state,
        initial.definition,
        { authenticatedPlayerId: "p2" },
        {
          gameId: state.gameId,
          expectedVersion: state.stateVersion,
          type: "choose-entry-influence",
          slotId: null,
        },
      );
    let saved = parseRoomSnapshot({ ...initial, state });
    entries.set(count, saved);
    const store: RoomStore = {
      create: async () => false,
      read: async () => saved,
      compareAndSwap: async (_id, version, next) => {
        if (version !== saved.state.stateVersion) return false;
        saved = parseRoomSnapshot({ ...saved, state: next });
        return true;
      },
    };
    await new RoomService(store).readView(saved.roomId, {
      authenticatedUserId: "user-p1",
    });
    while (["role-removal", "role-placement"].includes(saved.state.roundFlow!.stage)) {
      const command = saved.state.roundFlow!.stage === "role-removal"
        ? { type: "remove-round-supply-card", cardId: saved.state.facilities!.supply.supply[0] }
        : { type: "place-round-role", roleId: "ROLE-03" };
      saved = send(saved, "round", command);
    }
    snapshots.set(count, saved);
  }
});

function send(room: RoomSnapshot, channel: string, command: Record<string, unknown>, actor = core.getRoundTurn(room.state, room.definition).actorId!) {
  const result = core.executeGamePlayerRequest(room.state, room.definition, { authenticatedPlayerId: actor }, {
    apiVersion: '1.0.0', requestId: 'quick-test', channel,
    command: { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...command },
  });
  if (result.status !== 'accepted') throw Error(JSON.stringify(result.reply));
  return parseRoomSnapshot({ ...room, state: result.state });
}
function options(room: RoomSnapshot, actor = 'p1') {
  const result = getRoomActionOptions(room, actor); if (result.status !== 'ready') throw Error('Expected ready'); return result;
}
function preview(room: RoomSnapshot, draft: QuickDraft, actor = 'p1') {
  const result = getRoomQuickPreview(room, actor, quickPreviewRequestSchema.parse({ roomId: room.roomId, channel: draft.channel,
    command: { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...draft.command } }));
  if (result.status !== 'ready') throw Error('Expected preview'); return result;
}
function roleFixture(roleId: core.BaseRolePlayerCommand['roleId'], count = 3) {
  const original = snapshots.get(count)!, state = core.gameStateSchema.parse(original.state), own = state.roundFlow!.rolesByPlayer[0]!;
  own.hand.push(own.placed!); own.placed = own.hand.splice(own.hand.indexOf(roleId), 1)[0]!;
  return parseRoomSnapshot({ ...original, state });
}
function roleDraft(room: RoomSnapshot, mode: 'strategy' | 'scheme' | 'both'): Extract<QuickDraft, { channel: 'role' }> {
  const id = room.state.roundFlow!.rolesByPlayer[0]!.placed!;
  const strategy = id === 'ROLE-01' ? { kind: 'liskarm-place' as const, slotIds: ['route:R-route-01:slot:1', 'route:F-route-01:slot:1'] }
    : id === 'ROLE-02' ? { kind: 'minimum-resource' as const, asset: 'orirock' as const }
    : id === 'ROLE-03' ? { kind: 'cycle-facility' as const, cardId: room.state.facilities!.supply.supply[0]! }
    : id === 'ROLE-04' ? { kind: 'sell-resources' as const, amounts: { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 } }
    : { kind: 'tin-point' as const };
  const scheme = id === 'ROLE-01' ? { kind: 'liskarm-replace' as const, costDecision: 'decline' as const }
    : id === 'ROLE-02' ? { kind: 'elysium-city-move' as const, costDecision: 'decline' as const }
    : id === 'ROLE-03' ? { kind: 'texas-influence' as const, costDecision: 'decline' as const }
    : id === 'ROLE-04' ? { kind: 'forced-sale' as const, asset: 'originium' as const }
    : { kind: 'recover-roles' as const, rewards: [] };
  return { channel: 'role', command: { type: 'use-base-role', roleId: id, mode,
    ...(mode !== 'scheme' ? { strategyChoice: strategy } : {}), ...(mode !== 'strategy' ? { schemeChoice: scheme } : {}) } };
}
function dispatch(room: RoomSnapshot, finish = true) {
  room = send(room, 'round', { type: 'choose-major-action', action: 'dispatch' });
  if (room.state.influenceAction!.status === 'ready') room = send(room, 'influence', { type: 'finish-dispatch' });
  return finish ? send(room, 'round', { type: 'finish-player-turn' }) : room;
}
function mark(room: RoomSnapshot, slotId: string, owner = 'p1') {
  const state = core.gameStateSchema.parse(room.state), markerId = state.markerSupplyByPlayer[owner]!.shift()!;
  state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: owner }; return parseRoomSnapshot({ ...room, state });
}
function layout(patternId: string, count = 3, actor = 'p1') {
  const original = snapshots.get(count)!, state = core.gameStateSchema.parse(original.state);
  const eligible = core.getEligibleCityPatterns('base', count).map(p => p.id);
  state.cityPatterns!.publicPatternIds = [...core.selectCityPatterns('base', count, [patternId, ...eligible.filter(id => id !== patternId)])];
  for (const player of Object.values(state.players)) for (const key of Object.keys(player.balances) as (keyof typeof player.balances)[]) player.balances[key] = 200;
  const panel = state.facilities!.panels.find(p => p.playerId === actor)!;
  const cardIds = core.getCityPattern(patternId).cells.map(cell => {
    const cellId = `CP-${cell.row + 1}-${cell.column + 1}`, existing = panel.placements.find(p => p.cellId === cellId);
    if (existing) return existing.cardId;
    const stock = core.PROJECT_BASE_FACILITY_STOCK.cards.find(c => c.group === 'ordinary' && c.color === cell.colors[0] && !core.getFacilityExecutionFace(c.facilityId).effect.uniqueMarker && !state.facilities!.supply.playerHoldings.some(h => h.cardIds.includes(c.id)))!;
    for (const zone of [state.facilities!.supply.supply, state.facilities!.supply.drawPile, state.facilities!.supply.returnedToBox]) { const i = zone.indexOf(stock.id); if (i >= 0) zone.splice(i, 1); }
    while (state.facilities!.supply.supply.length < 6) state.facilities!.supply.supply.push(state.facilities!.supply.drawPile.shift()!);
    state.facilities!.supply.playerHoldings.find(h => h.playerId === actor)!.cardIds.push(stock.id); panel.placements.push({ cardId: stock.id, cellId }); return stock.id;
  });
  return { room: parseRoomSnapshot({ ...original, state }), cardIds };
}
function declaration(room: RoomSnapshot, patternId: string): Extract<QuickDraft, { channel: 'city-pattern' }> {
  const match = options(room).options!.quick.patterns.find(p => p.id === patternId)!.matches[0]!;
  return { channel: 'city-pattern', command: { type: 'declare-city-pattern', patternId, facilityCardIds: [...match.facilityCardIds],
    ...(patternId === 'PAT-014' ? { returnMarkerId: room.state.markerSupplyByPlayer.p1![0]! } : {}) } };
}
function declared(patternId: string, count = 3) {
  const { room } = layout(patternId, count), draft = declaration(room, patternId); return send(room, draft.channel, draft.command);
}
function special(room: RoomSnapshot, patternId: string): Extract<QuickDraft, { channel: 'city-pattern' }> {
  const effect = patternId === 'PAT-001' ? { kind: 'replace' as const }
    : patternId === 'PAT-005' ? { kind: 'military' as const, slotIds: ['route:F-route-01:slot:1'] }
    : patternId === 'PAT-009' ? { kind: 'security' as const, choices: [{ kind: 'remove' as const }, { kind: 'remove' as const }] }
    : patternId === 'PAT-011' ? { kind: 'outpost' as const, slotIds: ['node:A-01:slot:1', 'node:A-01:slot:2'], moves: [{ sourceSlotId: 'node:A-01:slot:1', targetSlotId: 'route:F-route-01:slot:1' }] }
    : patternId === 'PAT-004' ? { kind: 'composite-move' as const, orirock: 3, iron: 0 }
    : patternId === 'PAT-006' ? { kind: 'double-move' as const }
    : patternId === 'PAT-012' ? { kind: 'deck-construction' as const }
    : patternId === 'PAT-003' ? { kind: 'industry-actions' as const }
    : patternId === 'PAT-008' ? { kind: 'commercial-action' as const, reward: 'columbia-voucher' as const }
    : { kind: 'command-action' as const };
  return { channel: 'city-pattern', command: { type: 'use-pattern-special', patternId,
    markerId: room.state.patternMarkers!.find(m => m.ownerPlayerId === 'p1' && m.patternId === patternId)!.markerId, effect } };
}
describe('authoritative role and pattern presentation', () => {
  it.each([2, 3, 4])('limits %i-player quick choices to the scheduled actor and does not disclose opponents or future cards', count => {
    const room = snapshots.get(count)!, before = JSON.stringify(room), result = options(room);
    expect(result.options!.quick.role?.roleId).toBe('ROLE-03'); expect(result.options!.quick.patterns).toHaveLength(6);
    expect(options(room, 'p2').options).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/drawPile|DeckOrder|roleHand|placedRoleId|members/);
    expect(Object.isFrozen(result.options!.quick.patterns)).toBe(true); expect(JSON.stringify(room)).toBe(before);
  });
  it.each(core.FOUNDERS_BASE_ROLES.flatMap(r => (['strategy', 'scheme', 'both'] as const).map(mode => [r.id, mode] as const)))('previews and commits %s %s with the original role and discard rules', (id, mode) => {
    const room = roleFixture(id), draft = roleDraft(room, mode), before = JSON.stringify(room);
    expect(preview(room, draft).options?.execution.legal).toBe(true); expect(JSON.stringify(room)).toBe(before);
    const next = send(room, draft.channel, draft.command);
    expect(next.state.roundFlow!.rolesByPlayer[0]!.used).toMatchObject({ roleId: id, mode, turnIndex: 0 });
    expect(next.state.roundFlow!.rolesByPlayer[0]!.placed).toBeNull(); expect(options(next).options!.quick.role).toBeNull();
    expect(core.getRoundTurn(next.state, next.definition).majorActionStatus).toBe('not-started');
    expect(preview(next, draft).options?.execution.legal).toBe(false);
  });
  it('does not interrupt pending actions, and lets an ordinary completed action retain its completion after a role', () => {
    let room = send(roleFixture('ROLE-02'), 'round', { type: 'choose-major-action', action: 'deploy' });
    expect(options(room).options!.quick.window).toBe(false);
    const draft = roleDraft(room, 'strategy'); expect(preview(room, draft).options?.execution.blockedBy).toBe('ACTION_PENDING');
    room = send(room, 'influence', { type: 'deploy-influence', slotId: options(room).options!.influence!.deploymentSlotIds[0] });
    expect(options(room).options!.quick.role?.roleId).toBe('ROLE-02');
    room = send(room, draft.channel, draft.command);
    expect(options(room).options!.finishTurn.legal).toBe(true); expect(room.state.phase).toBe('round-control');
  });
  it('uses Texas strategy income before its paid scheme and recalculates replacement/movement/removal atomically', () => {
    let room = mark(roleFixture('ROLE-03'), 'route:R-route-01:slot:1', 'p2');
    const state = core.gameStateSchema.parse(room.state); state.players.p1!.balances['columbia-voucher'] = 0; room = parseRoomSnapshot({ ...room, state });
    const draft: QuickDraft = { channel: 'role', command: { ...roleDraft(room, 'both').command, schemeChoice: { kind: 'texas-influence', costDecision: 'pay', replaceSlotId: 'route:R-route-01:slot:1', move: { sourceSlotId: 'route:R-route-01:slot:1', targetSlotId: 'route:F-route-01:slot:1' }, removeSlotId: 'route:F-route-01:slot:1' } } };
    expect(preview(room, draft).options?.execution.legal).toBe(true);
    const next = send(room, draft.channel, draft.command);
    expect(next.state.players.p1!.balances['columbia-voucher']).toBe(9);
    expect(next.state.board.influenceBySlot['route:F-route-01:slot:1']).toBeNull();
    expect(Object.keys(core.getMarkerLedger(next.state, next.definition))).toHaveLength(90);
  });
  it('lets Elysium both obtain minimum iron before its scheme after a real exploration and target placement', () => {
    let room = send(roleFixture('ROLE-02'), 'round', { type: 'choose-major-action', action: 'explore' });
    room = send(room, 'exploration', { type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] });
    const variant = options(room).options!.travel!.event!.choices.find(c => c.id === 'Y01:2')!.variants.find(v => v.legal)!;
    room = send(room, 'exploration', { type: 'choose-exploration-event', choice: variant.choice });
    room = send(room, 'exploration', { type: 'place-exploration-influence', slotId: options(room).options!.travel!.finalSlotIds[0] });
    const move = options(room).options!.quick.role!.elysiumMoves.find(m => m.nodeId === 'D-01')!;
    const draft: QuickDraft = { channel: 'role', command: { type: 'use-base-role', roleId: 'ROLE-02', mode: 'both', strategyChoice: { kind: 'minimum-resource', asset: 'iron' }, schemeChoice: { kind: 'elysium-city-move', costDecision: 'pay', ...move, finalSlotId: 'node:D-01:slot:2' } } };
    expect(preview(room, draft).options?.execution.legal).toBe(true);
    room = send(room, draft.channel, draft.command); expect(room.state.board.cityNodeByPlayer.p1).toBe('D-01');
    expect(options(room).options!.finishTurn.legal).toBe(true);
  });
  it('chooses a reward for each prior Tin Man discard in explicit order, excluding the current Tin Man', () => {
    let room = mark(roleFixture('ROLE-05'), 'route:F-route-01:slot:1');
    const state = core.gameStateSchema.parse(room.state), own = state.roundFlow!.rolesByPlayer[0]!;
    for (const id of ['ROLE-01', 'ROLE-02'] as const) own.discarded.push(own.hand.splice(own.hand.indexOf(id), 1)[0]!);
    room = parseRoomSnapshot({ ...room, state });
    const draft: QuickDraft = { channel: 'role', command: { type: 'use-base-role', roleId: 'ROLE-05', mode: 'both', strategyChoice: { kind: 'tin-point' }, schemeChoice: { kind: 'recover-roles', rewards: [
      { roleId: 'ROLE-02', kind: 'move-influence', sourceSlotId: 'route:F-route-01:slot:1', targetSlotId: 'route:R-route-01:slot:1' }, { roleId: 'ROLE-01', kind: 'vouchers' },
    ] } } };
    expect(preview(room, draft).options?.execution.legal).toBe(true);
    const next = send(room, draft.channel, draft.command); expect(next.state.roundFlow!.rolesByPlayer[0]!.discarded).toEqual(['ROLE-05']);
    expect(next.state.players.p1!.score).toBe(room.state.players.p1!.score + 1);
    expect(next.state.players.p1!.balances['columbia-voucher']).toBe(room.state.players.p1!.balances['columbia-voucher'] + 5);
  });
  it.each(core.getCityPatternActionSupport('1.16.0').declarationPatternIds)('offers original matches and declares %s without creating another major action', id => {
    const { room } = layout(id), draft = declaration(room, id), before = JSON.stringify(room), pattern = options(room).options!.quick.patterns.find(p => p.id === id)!;
    expect(pattern.matches.length).toBeGreaterThan(0); expect(pattern.effectText).toBe(core.getCityPattern(id).effectText);
    expect(preview(room, draft).options?.execution.legal).toBe(true); expect(JSON.stringify(room)).toBe(before);
    const next = send(room, draft.channel, draft.command);
    expect(next.state.players.p1!.score).toBe(room.state.players.p1!.score + core.getCityPattern(id).printedScore);
    expect(next.state.roundFlow!.majorActionOpened).toBe(false);
  });
  it.each(core.getCityPatternActionSupport('1.16.0').specialActionPatternIds)('previews and activates the original %s special, preserving its child budget or pending effects', id => {
    const room = declared(id), draft = special(room, id), before = JSON.stringify(room);
    expect(preview(room, draft).options?.execution.legal).toBe(true); expect(JSON.stringify(room)).toBe(before);
    const next = send(room, draft.channel, draft.command);
    expect(next.state.cityPatterns!.usedSpecialActions).toContainEqual({ playerId: 'p1', patternId: id, turnIndex: 0 });
    expect(next.state.roundFlow!.majorActionOpened).toBe(true);
    expect(options(next, 'p2').options).toBeNull();
  });
  it('requires explicit completion of each industrial child and does not finish its turn early', () => {
    const start = declared('PAT-003'), draft = special(start, 'PAT-003'); let room = send(start, draft.channel, draft.command);
    for (const remaining of [2, 1]) {
      expect(options(room).options!.quick.extraActions[0]!.remainingActions).toBe(remaining);
      expect(options(room).options!.finishTurn.legal).toBe(false);
      room = dispatch(room, false); expect(options(room).options!.finishPattern.legal).toBe(true);
      room = send(room, 'round', { type: 'finish-pattern-action' });
    }
    expect(options(room).options!.finishTurn.legal).toBe(true);
  });
  it('does not leak deck order and offers a sorted entitlement only after the deck-search special', () => {
    const start = declared('PAT-012'), draft = special(start, 'PAT-012'), room = send(start, draft.channel, draft.command);
    const choice = options(room).options!.construction!;
    expect(choice.source).toBe('authorized-deck-search');
    const ids = choice.supply.map(c => c.cardId); expect(ids).toEqual([...ids].sort());
    const original = core.getCityPatternContinuationOptions(room.state, room.definition, 'p1');
    if (!('constructionOptions' in original) || !original.constructionOptions) throw Error('Expected search');
    expect(new Set(ids)).toEqual(new Set(original.constructionOptions.choices.map(c => c.cardId)));
    expect(options(room, 'p2').options).toBeNull(); expect(JSON.stringify(choice)).not.toMatch(/drawPile|DeckOrder/);
    const c = choice.buildChoices.find(c => ['gain', 'none'].includes(core.getFacilityConstructionSpec(c.cardId).entry.kind))!;
    const body = { type: 'construct-facility', cardId: c.cardId, cellId: choice.emptyCellIds[0]!, paymentMode: c.paymentMode, entryChoice: { kind: 'deferred-entry' } };
    const result = getRoomConstructionPreview(room, 'p1', constructionPreviewRequestSchema.parse({ roomId: room.roomId, channel: 'construction', command: { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...body } }));
    expect(result).toMatchObject({ options: { execution: { legal: true } } });
    const six = room.state.facilities!.supply.supply, done = send(room, 'construction', body);
    expect(done.state.facilities!.supply.supply).toEqual(six); expect(done.state.cityPatternContinuation).toBeNull();
  });
  it('returns to public supply for nested extra construction after an authorized deck build', () => {
    const start = declared('PAT-012'), draft = special(start, 'PAT-012');
    let room = send(start, draft.channel, draft.command);
    const first = options(room).options!.construction!;
    const chosen = first.buildChoices.find(c => core.getFacilityConstructionSpec(c.cardId).entry.kind === 'extra-construction')!;
    expect(chosen).toBeDefined();
    room = send(room, 'construction', { type: 'construct-facility', cardId: chosen.cardId, cellId: first.emptyCellIds[0], paymentMode: chosen.paymentMode, entryChoice: { kind: 'deferred-entry' } });
    const nested = options(room).options!.construction!;
    expect(nested.source).toBe('supply'); expect(nested.buildChannel).toBe('facility-entry');
    expect(nested.supply.map(c => c.cardId)).toEqual(room.state.facilities!.supply.supply);
    const extra = nested.buildChoices.find(c => core.getFacilityConstructionSpec(c.cardId).entry.kind === 'warehouse')!;
    expect(extra).toBeDefined();
    room = send(room, 'facility-entry', { type: 'construct-entry-facility', cardId: extra.cardId, cellId: nested.emptyCellIds[0], paymentMode: extra.paymentMode, entryChoice: { kind: 'deferred-entry' } });
    room = send(room, 'facility-entry', { type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-influence', placeSlotId: 'node:A-01:slot:1', move: { sourceSlotId: 'node:A-01:slot:1', targetSlotId: 'route:R-route-01:slot:1' } } });
    expect(room.state.cityPatternContinuation).toBeNull();
    expect(options(room).options!.finishTurn.legal).toBe(true);
  });
  it.each(['PAT-004', 'PAT-006'])('resumes %s free movement/events, repeats the original remaining moves and resolves any extra route placement', id => {
    const start = declared(id), draft = special(start, id); let room = send(start, draft.channel, draft.command), count = 0;
    while (room.state.cityPatternContinuation) {
      const opts = options(room).options!, travel = opts.travel!;
      expect(travel.cityMoveCost).toBe(0);
      if (travel.status === 'ready') {
        const move = travel.moves.find(m => m.legal && m.nodeId === (count === 0 ? 'D-01' : 'A-01'))!;
        room = send(room, 'city-move', { type: 'move-city', nodeId: move.nodeId, routeId: move.routeId }); count++;
      } else if (travel.status === 'event-choice') room = send(room, 'city-move', { type: 'choose-city-move-event', choice: travel.event!.choices.flatMap(c => c.variants).find(v => v.legal)!.choice });
      else if (travel.status === 'final-influence') room = send(room, 'city-move', { type: 'place-city-move-influence', slotId: travel.finalSlotIds[0] });
      else room = send(room, 'pattern-continuation', { type: 'place-pattern-route-influence', slotId: opts.quick.patternRouteSlotIds[0] });
    }
    expect(count).toBe(id === 'PAT-004' ? 1 : 2); expect(options(room).options!.finishTurn.legal).toBe(true);
  });
  it('exposes the original declaration-build continuation and completes it through ordinary construction', () => {
    const room = declared('PAT-013'), choice = options(room).options!.construction!;
    expect(choice.source).toBe('supply'); expect(choice.buildChannel).toBe('construction');
    expect(choice.buildChoices.length).toBeGreaterThan(0);
    const c = choice.buildChoices.find(c => core.getFacilityConstructionSpec(c.cardId).entry.kind === 'warehouse')!;
    let next = send(room, 'construction', { type: 'construct-facility', cardId: c.cardId, cellId: choice.emptyCellIds[0], paymentMode: c.paymentMode, entryChoice: { kind: 'deferred-entry' } });
    next = send(next, 'facility-entry', { type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-influence', placeSlotId: 'node:A-01:slot:1', move: { sourceSlotId: 'node:A-01:slot:1', targetSlotId: 'route:R-route-01:slot:1' } } });
    expect(next.state.cityPatternContinuation).toBeNull(); expect(core.getRoundTurn(next.state, next.definition).majorActionStatus).toBe('not-started');
  });
  it('offers and resolves real Liskarm cleanup after both action cycles and actual harvest submissions', async () => {
    let room = roleFixture('ROLE-01'), draft = roleDraft(room, 'strategy'); room = send(room, draft.channel, draft.command);
    while (room.state.roundFlow!.stage === 'player-actions') room = dispatch(room);
    room = parseRoomSnapshot({ ...room, state: core.openHarvestPhase(room.state, room.definition, { expectedVersion: room.state.stateVersion, roundNumber: 1 }) });
    for (const player of room.definition.players) room = send(room, 'harvest', { type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } }, player.id);
    room = parseRoomSnapshot({ ...room, state: core.openManagedCleanup(room.state, room.definition, { expectedVersion: room.state.stateVersion }) });
    expect(options(room).options!.actions).toEqual([]);
    const ids = options(room).options!.quick.cleanupSlotIds; expect(ids).toHaveLength(2);
    const cleanup: QuickDraft = { channel: 'role-cleanup', command: { type: 'resolve-role-cleanup', slotId: ids[0]! } };
    expect(preview(room, cleanup).options?.execution.legal).toBe(true); room = send(room, cleanup.channel, cleanup.command);
    let saved = room; const store: RoomStore = { create: async () => false, read: async () => saved,
      compareAndSwap: async (_id, version, next) => { if (saved.state.stateVersion !== version) return false; saved = parseRoomSnapshot({ ...saved, state: next }); return true; } };
    await new RoomService(store).readView(room.roomId, { authenticatedUserId: 'user-p1' });
    expect(saved.state.roundFlow!.roundNumber).toBe(2); expect(saved.state.roundFlow!.stage).toBe('role-removal');
  });
  it('respects nonstarting both-mode authority, special-role conflicts, charges and per-round cooldown', () => {
    let room = dispatch(roleFixture('ROLE-02'));
    const plain: QuickDraft = { channel: 'role', command: { type: 'use-base-role', roleId: 'ROLE-03', mode: 'both', strategyChoice: { kind: 'cycle-facility', cardId: room.state.facilities!.supply.supply[0]! }, schemeChoice: { kind: 'texas-influence', costDecision: 'decline' } } };
    expect(preview(room, plain, 'p2').options?.execution.blockedBy).toBe('STARTING_PLAYER_ONLY');
    const f = layout('PAT-010', 3, 'p2'); let state = core.gameStateSchema.parse(f.room.state); state.roundFlow!.turnIndex = 1;
    room = parseRoomSnapshot({ ...f.room, state });
    const match = options(room, 'p2').options!.quick.patterns.find(p => p.id === 'PAT-010')!.matches[0]!;
    room = send(room, 'city-pattern', { type: 'declare-city-pattern', patternId: 'PAT-010', facilityCardIds: [...match.facilityCardIds] }, 'p2');
    room = send(room, 'city-pattern', { type: 'use-pattern-special', patternId: 'PAT-010', markerId: room.state.patternMarkers!.find(m => m.ownerPlayerId === 'p2')!.markerId, effect: { kind: 'command-action' } }, 'p2');
    const role = options(room, 'p2').options!.quick.role!;
    expect(role.roleId).toBe('ROLE-03');
    const authorized: QuickDraft = { ...plain, command: { ...plain.command, strategyChoice: { kind: 'cycle-facility', cardId: room.state.facilities!.supply.supply[0]! } } };
    expect(preview(room, authorized, 'p2').options?.execution.legal).toBe(true);
    const before = declared('PAT-003'), used = send(before, 'role', roleDraft(before, 'strategy').command);
    expect(options(used).options!.quick.patterns.find(p => p.id === 'PAT-003')!.special).toBeNull();
    expect(preview(used, special(before, 'PAT-003')).options?.execution.blockedBy).toBe('ROLE_CONFLICT');
    const basic = declared('PAT-005'), active = send(basic, 'city-pattern', special(basic, 'PAT-005').command);
    expect(options(active).options!.quick.patterns.find(p => p.id === 'PAT-005')!.special).toBeNull();
    expect(preview(active, special(basic, 'PAT-005')).options?.execution.legal).toBe(false);
  });
  it('preserves temporary-settlement return rewards and releases the actual declared cell', () => {
    const f = layout('PAT-005'), state = core.gameStateSchema.parse(f.room.state), panel = state.facilities!.panels[0]!;
    const old = panel.placements.find(p => p.cellId === 'CP-1-1')!, temp = state.facilities!.supply.drawPile.find(core.isTemporarySettlementCard)!;
    const index = state.facilities!.supply.drawPile.indexOf(temp); state.facilities!.supply.drawPile[index] = old.cardId;
    const holding = state.facilities!.supply.playerHoldings[0]!; holding.cardIds.splice(holding.cardIds.indexOf(old.cardId), 1, temp); old.cardId = temp;
    const room = parseRoomSnapshot({ ...f.room, state }), base = declaration(room, 'PAT-005');
    if (base.command.type !== 'declare-city-pattern') throw Error('Expected declaration');
    const draft: QuickDraft = { ...base, command: { ...base.command, returnTemporaryFacilityIds: [temp] } };
    expect(preview(room, draft).options?.execution.legal).toBe(true);
    const next = send(room, draft.channel, draft.command); expect(next.state.players.p1!.balances['columbia-voucher']).toBe(room.state.players.p1!.balances['columbia-voucher'] + 12);
    expect(next.state.facilities!.panels[0]!.placements.some(p => p.cardId === temp)).toBe(false);
  });
  it('keeps preview reads behind membership, strict schemas and storage boundaries without CAS or initialization', async () => {
    const room = snapshots.get(3)!, draft = roleDraft(room, 'strategy'), req = { roomId: room.roomId, channel: draft.channel, command: { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...draft.command } };
    const compareAndSwap = vi.fn(), read = vi.fn(async (id: string) => id === room.roomId ? room : null), service = new RoomService({ create: async () => false, read, compareAndSwap });
    const denied = await service.readQuickPreview(req, { authenticatedUserId: 'outsider' });
    expect(await service.readQuickPreview({ ...req, roomId: 'missing' }, { authenticatedUserId: 'outsider' })).toEqual(denied);
    expect(await service.readQuickPreview({ ...req, playerId: 'p2' }, { authenticatedUserId: 'user-p1' })).toMatchObject({ error: { code: 'INVALID_MESSAGE' } });
    read.mockRejectedValueOnce(Error('PRIVATE_SQL'));
    expect(await service.readQuickPreview(req, { authenticatedUserId: 'user-p1' })).toMatchObject({ error: { code: 'STORAGE_UNAVAILABLE' } });
    const parsed = quickPreviewRequestSchema.parse(req);
    expect(getRoomQuickPreview(room, 'p1', quickPreviewRequestSchema.parse({ ...parsed, command: { ...parsed.command, expectedVersion: 0 } }))).toMatchObject({ options: null });
    expect(compareAndSwap).not.toHaveBeenCalled(); expect(options(entries.get(3)!).options).toBeNull();
  });
});
