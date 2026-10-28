import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@nomad-city-online/game-core';
import { createAutomaticBaseRoomSnapshot } from './base-room-factory.js';
import { baseSetupIds } from './automatic-base-plan.js';
import { parseRoomSnapshot } from './room-state.js';
import type { RoomSnapshot, RoomStore } from './room-state.js';
import { RoomService } from './room-service.js';
import { getRoomHarvestOptions, getRoomHarvestPreview, harvestPreviewRequestSchema } from './harvest-options.js';
const snapshots = new Map<number, RoomSnapshot>();
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
      roomId: `harvest-options-${count}`,
      gameId: `harvest-game-${count}`,
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
    while (saved.state.roundFlow!.stage === 'player-actions') {
      saved = send(saved, 'round', { type: 'choose-major-action', action: 'dispatch' });
      if (saved.state.influenceAction!.status === 'ready') saved = send(saved, 'influence', { type: 'finish-dispatch' });
      saved = send(saved, 'round', { type: 'finish-player-turn' });
    }
    saved = parseRoomSnapshot({ ...saved, state: core.openHarvestPhase(saved.state, saved.definition, { expectedVersion: saved.state.stateVersion, roundNumber: 1 }) });
    snapshots.set(count, saved);
  }
});

function send(room: RoomSnapshot, channel: string, command: Record<string, unknown>, actor = core.getRoundTurn(room.state, room.definition).actorId!) {
  const result = core.executeGamePlayerRequest(room.state, room.definition, { authenticatedPlayerId: actor }, {
    apiVersion: '1.0.0', requestId: 'harvest-test', channel,
    command: { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...command },
  });
  if (result.status !== 'accepted') throw Error(JSON.stringify(result.reply));
  return parseRoomSnapshot({ ...room, state: result.state });
}
const empty = { nodeIds: [], routeIds: [] };
function options(room: RoomSnapshot, playerId = 'p1') { return getRoomHarvestOptions(room, playerId); }
function preview(room: RoomSnapshot, plan: core.HarvestPlayerCommand['plan'], playerId = 'p1', extra = {}) {
  const request = harvestPreviewRequestSchema.parse({ roomId: room.roomId, command: { type: 'set-harvest-plan', gameId: room.state.gameId, expectedVersion: room.state.stateVersion, plan, ...extra } });
  const result = getRoomHarvestPreview(room, playerId, request); if (result.status !== 'ready') throw Error('Expected ready'); return result;
}
function remote(count = 3) {
  const room = snapshots.get(count)!, state = core.gameStateSchema.parse(room.state);
  // Isolated revealed layout with real physical markers, not a fabricated exploration history.
  state.eventDecks!.yellow = state.eventDecks!.yellow.filter(id => id !== 'Y01');
  const card = core.getFoundersEventCard('Y01');
  state.board.resourceMarkerByNode['D-01'] = { markerDefinitionId: 'Y01', resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
  state.board.influenceBySlot['node:D-01:slot:1'] = { markerId: state.markerSupplyByPlayer.p1!.shift()!, ownerPlayerId: 'p1' };
  return parseRoomSnapshot({ ...room, state });
}
function marked(room: RoomSnapshot, slotId: string, ownerPlayerId: string) {
  const state = core.gameStateSchema.parse(room.state);
  state.board.influenceBySlot[slotId] = { markerId: state.markerSupplyByPlayer[ownerPlayerId]!.shift()!, ownerPlayerId };
  return parseRoomSnapshot({ ...room, state });
}
describe('member-owned simultaneous harvest advice', () => {
  it.each([2, 3, 4])('offers original eligible nodes and topology to every %i-player member, without writes or hidden fields', count => {
    const room = snapshots.get(count)!, before = JSON.stringify(room);
    for (const p of room.definition.players) {
      const result = options(room, p.id); expect(result.options).not.toBeNull();
      expect(result.options!.nodeChoices.map(n => n.nodeId)).toEqual(core.getHarvestEligibleNodeIds(room.state, room.definition, p.id));
      expect(result.options!.routes).toHaveLength(count === 4 ? 22 : 20);
      expect(result.options!.plan).toBeNull(); expect(Object.isFrozen(result.options!.routes[0])).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/drawPile|DeckOrder|placedRoleId|markerId|plansByPlayer|members/);
    }
    expect(options(room, 'outsider').options).toBeNull(); expect(JSON.stringify(room)).toBe(before);
  });
  it('retains only the viewer plan and allows submitted members to replace it until the last plan', () => {
    const start = snapshots.get(3)!, plan = { nodeIds: ['A-01'], routeIds: [] };
    const room = send(start, 'harvest', { type: 'set-harvest-plan', plan }, 'p1');
    expect(room.state.players).toEqual(start.state.players);
    expect(options(room).options!.plan).toEqual(plan); expect(options(room, 'p2').options!.plan).toBeNull();
    expect(preview(room, empty).options!.execution.legal).toBe(true);
    const replaced = send(room, 'harvest', { type: 'set-harvest-plan', plan: empty }, 'p1');
    expect(options(replaced).options!.plan).toEqual(empty);
    const publicView = core.getGamePublicView(replaced.state, replaced.definition);
    expect(publicView.harvest!.submittedPlayerIds).toEqual(['p1']); expect(JSON.stringify(publicView.harvest)).not.toContain('nodeIds');
  });
  it.each([2, 3, 4])('previews all %i-player city gains from original markers, then settles only the final plan', count => {
    let room = snapshots.get(count)!;
    const before = room.state.players;
    for (const p of room.definition.players) {
      const plan = { nodeIds: [room.state.board.cityNodeByPlayer[p.id]!], routeIds: [] }, quote = preview(room, plan, p.id);
      expect(quote.options!.quote).toEqual(core.getHarvestQuote(room.state, room.definition, p.id, plan));
      expect(quote.options!.execution.legal).toBe(true);
      room = send(room, 'harvest', { type: 'set-harvest-plan', plan }, p.id);
      if (room.state.harvest!.status === 'planning') expect(room.state.players).toEqual(before);
    }
    expect(room.state.harvest!.status).toBe('complete'); expect(options(room).options).toBeNull(); expect(preview(room, empty).options).toBeNull();
  });
  it.each(['supply', 'opponent', 'self', 'multiple'] as const)('uses original %s route costs and explicit recipient choices', mode => {
    let room = marked(remote(), 'route:R-route-01:slot:1', 'p1');
    if (mode === 'opponent' || mode === 'multiple') room = marked(room, 'route:D-route-01:slot:1', 'p2');
    if (mode === 'multiple') room = marked(room, 'route:D-route-01:slot:2', 'p3');
    if (mode === 'self') room = marked(marked(room, 'route:D-route-01:slot:1', 'p2'), 'route:D-route-01:slot:2', 'p1');
    const advice = options(room).options!.routes.find(r => r.routeId === 'D-route-01')!;
    expect(advice.amount).toBe(mode === 'self' ? 0 : 2);
    expect(advice.recipientPlayerIds).toEqual(mode === 'self' || mode === 'supply' ? [] : mode === 'opponent' ? ['p2'] : ['p2', 'p3']);
    const plan = { nodeIds: ['D-01'], routeIds: ['R-route-01', 'D-route-01', 'D-route-01'], ...(mode === 'multiple' ? { tollRecipients: [{ routeId: 'D-route-01', payeePlayerId: 'p3' }] } : {}) };
    const before = JSON.stringify(room), result = preview(room, plan).options!;
    expect(result.execution.legal).toBe(true); expect(result.quote!.payments).toHaveLength(2); expect(result.quote!.total).toBe(advice.amount);
    expect(result.quote!.payments.find(p => p.routeId === 'D-route-01')!.payeePlayerId).toBe(mode === 'opponent' ? 'p2' : mode === 'multiple' ? 'p3' : null);
    expect(JSON.stringify(room)).toBe(before);
    if (mode === 'multiple') expect(preview(room, { nodeIds: ['D-01'], routeIds: ['R-route-01', 'D-route-01'] }).options!.execution.blockedBy).toBe('TOLL_RECIPIENT');
  });
  it.each([
    [{ nodeIds: [], routeIds: ['R-route-01'] }, 'EMPTY_PLAN'],
    [{ nodeIds: ['A-01', 'A-01'], routeIds: [] }, 'DUPLICATE_TARGET'],
    [{ nodeIds: ['D-01'], routeIds: [] }, 'HARVEST_CONNECTION'],
    [{ nodeIds: ['D-03'], routeIds: [] }, 'HARVEST_TARGET'],
    [{ nodeIds: ['A-01'], routeIds: ['B-route-01'] }, 'HARVEST_CONNECTION'],
    [{ nodeIds: ['D-01'], routeIds: ['R-route-01'], tollRecipients: [{ routeId: 'R-route-01', payeePlayerId: 'p2' }] }, 'TOLL_RECIPIENT'],
  ] as const)('rejects the original invalid plan %j atomically', (raw, code) => {
    const room = remote(), before = JSON.stringify(room), plan = core.harvestPlayerCommandSchema.parse({ type: 'set-harvest-plan', gameId: room.state.gameId, expectedVersion: 1, plan: raw }).plan;
    expect(preview(room, plan).options!.execution.blockedBy).toBe(code); expect(JSON.stringify(room)).toBe(before);
  });
  it('rejects an unaffordable plan before any incoming tolls and a final-plan credit overflow without partial settlement', () => {
    let room = remote(), state = core.gameStateSchema.parse(room.state); state.players.p1!.balances['columbia-voucher'] = 1;
    room = parseRoomSnapshot({ ...room, state });
    expect(preview(room, { nodeIds: ['D-01'], routeIds: ['R-route-01'] }).options!.execution.blockedBy).toBe('INSUFFICIENT_VOUCHERS');
    room = snapshots.get(3)!;
    for (const id of ['p1', 'p2']) room = send(room, 'harvest', { type: 'set-harvest-plan', plan: empty }, id);
    state = core.gameStateSchema.parse(room.state); const marker = state.board.resourceMarkerByNode[state.board.cityNodeByPlayer.p3!]!;
    state.players.p3!.balances[marker.resourceKind] = Number.MAX_SAFE_INTEGER; room = parseRoomSnapshot({ ...room, state });
    const before = JSON.stringify(room), last = preview(room, { nodeIds: [state.board.cityNodeByPlayer.p3!], routeIds: [] }, 'p3');
    expect(last.options!.execution.blockedBy).toBe('BALANCE_OVERFLOW'); expect(last.options!.quote).not.toBeNull(); expect(JSON.stringify(room)).toBe(before);
  });
  it('discards mismatched references, preserves schema restrictions and version exhaustion', () => {
    const room = snapshots.get(3)!;
    for (const extra of [{ gameId: 'wrong' }, { expectedVersion: room.state.stateVersion - 1 }]) expect(preview(room, empty, 'p1', extra).options).toBeNull();
    expect(harvestPreviewRequestSchema.safeParse({ roomId: room.roomId, playerId: 'p2', command: { type: 'set-harvest-plan', gameId: room.state.gameId, expectedVersion: 1, plan: empty } }).success).toBe(false);
    const state = core.gameStateSchema.parse(room.state); state.stateVersion = Number.MAX_SAFE_INTEGER;
    const overflow = parseRoomSnapshot({ ...room, state }); expect(preview(overflow, empty).options!.execution.blockedBy).toBe('VERSION_OVERFLOW');
  });
  it('keeps queue/membership/storage boundaries and never calls compareAndSwap for options or preview', async () => {
    const room = snapshots.get(3)!, compareAndSwap = vi.fn(async () => true), read = vi.fn(async () => room), store: RoomStore = { create: async () => false, read, compareAndSwap };
    const service = new RoomService(store), principal = { authenticatedUserId: 'user-p1' }, body = { roomId: room.roomId, command: { type: 'set-harvest-plan', gameId: room.state.gameId, expectedVersion: room.state.stateVersion, plan: empty } };
    expect(await service.readHarvestOptions(room.roomId, principal)).toEqual(options(room));
    expect(await service.readHarvestPreview(body, principal)).toEqual(preview(room, empty));
    expect(await service.readHarvestOptions(room.roomId, { authenticatedUserId: 'outsider' })).toMatchObject({ error: { code: 'ROOM_UNAVAILABLE' } });
    expect(await service.readHarvestPreview({ ...body, state: {} }, principal)).toMatchObject({ error: { code: 'INVALID_MESSAGE' } });
    read.mockRejectedValueOnce(Error('SQL SECRET'));
    expect(await service.readHarvestPreview(body, principal)).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(compareAndSwap).not.toHaveBeenCalled();
  });
});
