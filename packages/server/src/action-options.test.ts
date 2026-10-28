import { beforeAll, describe, expect, it, vi } from "vitest";
import * as core from "@nomad-city-online/game-core";
import { createAutomaticBaseRoomSnapshot } from "./base-room-factory.js";
import { baseSetupIds } from "./automatic-base-plan.js";
import { getRoomExplorationRoute, explorationRouteRequestSchema } from "./travel-options.js";
import { getRoomConstructionPreview, constructionPreviewRequestSchema } from "./construction-options.js";
import type { ConstructionDraft } from "./construction-options.js";
import { getRoomActionOptions } from "./action-options.js";
import { parseRoomSnapshot } from "./room-state.js";
import type { RoomSnapshot, RoomStore } from "./room-state.js";
import { RoomService } from "./room-service.js";
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
      roomId: `action-options-${count}`,
      gameId: `action-game-${count}`,
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

function send(room: RoomSnapshot, channel: "round" | "influence" | "exploration" | "city-move" | ConstructionDraft["channel"], command: Record<string, unknown>): RoomSnapshot {
  return parseRoomSnapshot({ ...room, state: ({ round: core.applyRoundCommand, influence: core.applyInfluenceCommand, exploration: core.applyExplorationCommand, "city-move": core.applyCityMoveCommand, construction: core.applyConstructionCommand, "facility-entry": core.applyNestedFacilityEntryCommand, "warehouse-entry": core.applyWarehouseEntryCommand }[channel])(
    room.state, room.definition, { authenticatedPlayerId: core.getRoundTurn(room.state, room.definition).actorId! },
    { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...command },
  ) });
}
function options(room: RoomSnapshot, playerId = "p1") {
  const result = getRoomActionOptions(room, playerId);
  if (result.status !== "ready") throw Error("Expected ready");
  return result;
}
function choose(room: RoomSnapshot, action: "deploy" | "dispatch" | "explore" | "city-move" | "construct") {
  return send(room, "round", { type: "choose-major-action", action });
}
describe("actor-only ordinary action options from existing reducers", () => {
  it.each([2, 3, 4])("offers %i-player choices without modifying a snapshot or revealing private zones", count => {
    const room = snapshots.get(count)!, before = JSON.stringify(room), result = options(room);
    expect(result.options?.actions).toEqual([
      { action: "deploy", legal: true, blockedBy: null }, { action: "dispatch", legal: true, blockedBy: null },
      { action: "explore", legal: true, blockedBy: null }, { action: "city-move", legal: true, blockedBy: null },
      { action: "construct", legal: true, blockedBy: null },
    ]);
    expect(options(room, "p2").options).toBeNull();
    expect(result.options?.finishTurn.legal).toBe(false);
    expect(result.options?.influence).toBeNull();
    expect(Object.isFrozen(result.options?.actions)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/roleHand|placedRole|drawPile|DeckOrder|members|markerId/);
    expect(JSON.stringify(room)).toBe(before);
  });
  it("uses original deployment slots; a real deployment consumes one supply marker and needs explicit turn completion", () => {
    let room = choose(snapshots.get(3)!, "deploy");
    const before = JSON.stringify(room), result = options(room), slots = result.options!.influence!.deploymentSlotIds;
    expect(slots).toEqual(core.getDeploymentSlotIds(room.state, room.definition, "p1"));
    expect(slots.length).toBeGreaterThan(0);
    expect(result.options!.cancelPreparation.legal).toBe(true);
    expect(result.options!.finishTurn.legal).toBe(false);
    expect(JSON.stringify(room)).toBe(before);
    const markerId = room.state.markerSupplyByPlayer.p1![0]!, count = room.state.markerSupplyByPlayer.p1!.length;
    room = send(room, "influence", { type: "deploy-influence", slotId: slots[0] });
    expect(room.state.board.influenceBySlot[slots[0]!]).toEqual({ markerId, ownerPlayerId: "p1" });
    expect(room.state.markerSupplyByPlayer.p1).toHaveLength(count - 1);
    expect(options(room).options).toMatchObject({ finishTurn: { legal: true }, cancelPreparation: { legal: false },
      influence: { status: "complete", deploymentSlotIds: [] } });
    expect(core.getRoundTurn(room.state, room.definition).actorId).toBe("p1");
    const next = send(room, "round", { type: "finish-player-turn" });
    expect(options(next).options).toBeNull();
    expect(options(next, "p2").options?.actions.every(a => a.legal)).toBe(true);
  });
  it("allows original zero-step cancellation and preserves board, supply, hidden deck and unused role", () => {
    const original = snapshots.get(3)!, next = send(choose(original, "deploy"), "round", { type: "cancel-major-preparation" });
    expect(next.state.board).toEqual(original.state.board);
    expect(next.state.markerSupplyByPlayer).toEqual(original.state.markerSupplyByPlayer);
    expect(next.state.eventDecks).toEqual(original.state.eventDecks);
    expect(next.state.roundFlow!.rolesByPlayer).toEqual(original.state.roundFlow!.rolesByPlayer);
    expect(options(next).options?.actions.every(a => a.legal)).toBe(true);
  });
  it("offers original dispatch pairs after a deployment, transfers the same marker twice and cannot cancel after a move", () => {
    let room = choose(snapshots.get(3)!, "deploy");
    const slotId = options(room).options!.influence!.deploymentSlotIds[0]!;
    room = send(room, "influence", { type: "deploy-influence", slotId });
    room = send(room, "round", { type: "finish-player-turn" });
    // Real other player turns; no injected markers, hand state or fake preceding rounds.
    for (let i = 0; i < 2; i++) {
      room = choose(room, "dispatch");
      room = send(room, "round", { type: "finish-player-turn" });
    }
    room = choose(room, "dispatch");
    const initialSupply = room.state.markerSupplyByPlayer.p1, marker = room.state.board.influenceBySlot[slotId];
    for (let n = 0; n < 2; n++) {
      const choice = options(room).options!.influence!.dispatches[0]!;
      expect(choice.targetSlotIds).toEqual(core.getDispatchTargetSlotIds(room.state, room.definition, "p1", choice.sourceSlotId));
      const targetSlotId = choice.targetSlotIds[0]!;
      room = send(room, "influence", { type: "dispatch-influence", sourceSlotId: choice.sourceSlotId, targetSlotId });
      expect(room.state.board.influenceBySlot[targetSlotId]).toEqual(marker);
      expect(room.state.board.influenceBySlot[choice.sourceSlotId]).toBeNull();
      expect(room.state.markerSupplyByPlayer.p1).toEqual(initialSupply);
      expect(options(room).options!.cancelPreparation.legal).toBe(false);
    }
    expect(options(room).options).toMatchObject({ finishTurn: { legal: true },
      influence: { status: "complete", operationsCompleted: 2, dispatches: [] } });
  });
  it("permits early finish-dispatch after one move without automatically advancing the turn", () => {
    let room = choose(snapshots.get(2)!, "deploy");
    room = send(room, "influence", { type: "deploy-influence", slotId: options(room).options!.influence!.deploymentSlotIds[0] });
    room = send(room, "round", { type: "finish-player-turn" });
    room = choose(room, "dispatch"); // p2 has no markers; completes immediately.
    expect(options(room, "p2").options?.finishTurn.legal).toBe(true);
    room = send(room, "round", { type: "finish-player-turn" });
    room = choose(room, "dispatch");
    const pair = options(room).options!.influence!.dispatches[0]!;
    room = send(room, "influence", { type: "dispatch-influence", sourceSlotId: pair.sourceSlotId, targetSlotId: pair.targetSlotIds[0] });
    expect(options(room).options?.finishDispatch.legal).toBe(true);
    expect(options(room).options?.finishTurn.legal).toBe(false);
    room = send(room, "influence", { type: "finish-dispatch" });
    expect(options(room).options?.finishTurn.legal).toBe(true);
    expect(room.state.roundFlow!.turnIndex).toBe(2);
  });
  it("does not invent available targets or a new marker when supply is empty", () => {
    const room = snapshots.get(3)!, state = core.gameStateSchema.parse(room.state), board = core.loadFoundersBoard("three-player");
    // Isolated marker-conservation fixture, not a claim of previous gameplay.
    const ids = Object.keys(board.influenceSlots).filter(id => id.startsWith("route:"));
    for (const id of ids) {
      const markerId = state.markerSupplyByPlayer.p1!.shift();
      if (!markerId) break;
      state.board.influenceBySlot[id] = { markerId, ownerPlayerId: "p1" };
    }
    expect(state.markerSupplyByPlayer.p1).toHaveLength(0);
    const opened = choose(parseRoomSnapshot({ ...room, state }), "deploy");
    expect(options(opened).options).toMatchObject({ finishTurn: { legal: true },
      influence: { status: "complete", deploymentSlotIds: [] } });
  });
  it("removes executable slots and disables all commands at version exhaustion through original reducers", () => {
    const opened = choose(snapshots.get(3)!, "deploy"), room = parseRoomSnapshot({ ...opened,
      state: { ...opened.state, stateVersion: Number.MAX_SAFE_INTEGER } });
    const result = options(room).options!;
    expect(result.influence?.deploymentSlotIds).toEqual([]);
    expect(result.cancelPreparation).toEqual({ legal: false, blockedBy: "VERSION_OVERFLOW" });
    expect(result.actions.every(a => !a.legal)).toBe(true);
    expect(result.finishTurn.legal).toBe(false);
  });
  it("returns no choices during preparation or pending initialization and performs no store writes", async () => {
    const entry = entries.get(3)!, state = core.beginRoundFlow(entry.state, entry.definition, {
      expectedVersion: entry.state.stateVersion, facilityDeckOrder: core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === "ordinary").map(c => c.id),
    }), room = parseRoomSnapshot({ ...entry, state }), compareAndSwap = vi.fn();
    const service = new RoomService({ read: async () => room, create: async () => false, compareAndSwap });
    expect(await service.readActionOptions(room.roomId, { authenticatedUserId: "user-p1" }))
      .toMatchObject({ blockedReason: "AUTOMATION_PENDING", options: null });
    expect(options(entry).options).toBeNull();
    expect(compareAndSwap).not.toHaveBeenCalled();
  });
  it("normalizes missing, nonmember, invalid-principal and storage failures without writes", async () => {
    const room = snapshots.get(3)!, compareAndSwap = vi.fn(), read = vi.fn(async (id: string) => id === room.roomId ? room : null);
    const service = new RoomService({ read, create: async () => false, compareAndSwap });
    const denied = await service.readActionOptions(room.roomId, { authenticatedUserId: "outsider" });
    expect(denied).toEqual(await service.readActionOptions("missing", { authenticatedUserId: "outsider" }));
    expect(denied).toEqual(await service.readActionOptions(room.roomId, { authenticatedUserId: "bad identity" }));
    read.mockRejectedValueOnce(Error("PRIVATE_SQL"));
    expect(await service.readActionOptions(room.roomId, { authenticatedUserId: "user-p1" }))
      .toEqual({ status: "unavailable", error: { code: "STORAGE_UNAVAILABLE" } });
    expect(compareAndSwap).not.toHaveBeenCalled();
  });
});

const directPath = [{ routeId: 'R-route-01', toNodeId: 'D-01' }];
function route(room: RoomSnapshot, path: readonly core.ExplorationPathStep[], actor = 'p1') {
  const result = getRoomExplorationRoute(room, actor, {
    roomId: room.roomId, gameId: room.state.gameId, expectedVersion: room.state.stateVersion, path,
  });
  if (result.status !== 'ready') throw Error('Expected route preview');
  return result;
}
function walk(room: RoomSnapshot, target: string): core.ExplorationPathStep[] {
  const board = core.loadFoundersBoard(core.getFoundersMapSide(room.definition.players.length));
  const queue: [string, core.ExplorationPathStep[]][] = [[room.state.board.cityNodeByPlayer.p1!, []]], seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const [node, path] = queue[i]!;
    if (node === target) return path;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const r of core.getRoutesForNode(board, node)) for (const n of core.getNodesForRoute(board, r.id))
      if (!seen.has(n.id)) queue.push([n.id, [...path, { routeId: r.id, toNodeId: n.id }]]);
  }
  throw Error('No test path');
}
function putMarker(room: RoomSnapshot, slotId: string, owner = 'p2') {
  const state = core.gameStateSchema.parse(room.state), markerId = state.markerSupplyByPlayer[owner]!.shift()!;
  if (state.board.influenceBySlot[slotId]) throw Error('Occupied fixture slot');
  state.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: owner };
  return parseRoomSnapshot({ ...room, state });
}
function eventRoom(cardId: string) {
  const original = snapshots.get(4)!, state = core.gameStateSchema.parse(original.state), card = core.getFoundersEventCard(cardId);
  // Isolated allowed round/deck ordering fixture; not seven preceding played rounds.
  if (card.color === 'red') state.roundFlow!.roundNumber = 8;
  expect(state.eventDecks![card.color]).toContain(cardId);
  state.eventDecks![card.color] = [cardId, ...state.eventDecks![card.color].filter(id => id !== cardId)];
  const room = choose(parseRoomSnapshot({ ...original, state }), 'explore');
  const board = core.loadFoundersBoard('four-player');
  const node = Object.values(board.resourceNodes).find(n => n.eventDeckColor === card.color && room.state.board.resourceMarkerByNode[n.id] === null)!;
  return send(room, 'exploration', { type: 'explore', nodeId: node.id, path: walk(room, node.id) });
}
describe('read-only travel options and original event execution', () => {
  it.each([2, 3, 4])('offers %i-player draft geometry and original complete-path fees without drawing or writing', count => {
    const room = choose(snapshots.get(count)!, 'explore'), before = JSON.stringify(room), empty = route(room, []);
    expect(empty.options?.currentNodeId).toBe('A-01');
    expect(empty.options?.execution).toEqual({ legal: false, blockedBy: 'PATH_REQUIRED' });
    for (const step of empty.options!.nextSteps) expect(core.areNodesDirectlyConnected(
      core.loadFoundersBoard(core.getFoundersMapSide(count)), 'A-01', step.toNodeId, step.routeId)).toBe(true);
    const draft = route(room, directPath);
    expect(draft.options?.quote).toEqual(core.getExplorationTollQuote(room.state, room.definition, 'p1', 'D-01', directPath));
    expect(draft.options?.execution.legal).toBe(true);
    expect(JSON.stringify(draft)).not.toMatch(/cardId|drawPile|DeckOrder|placedRole|markerId|members/);
    expect(route(room, [], 'p2').options).toBeNull();
    expect(JSON.stringify(room)).toBe(before);
  });
  it('requires explicit recipients for opposing owners and charges repeated routes only once', () => {
    let room = choose(snapshots.get(4)!, 'explore');
    const slots = core.loadFoundersBoard('four-player').routes['R-route-01']!.influenceSlotIds;
    room = putMarker(putMarker(room, slots[0]!, 'p2'), slots[1]!, 'p3');
    const path = [directPath[0]!, { routeId: 'R-route-01', toNodeId: 'A-01' }, directPath[0]!];
    const missing = route(room, path).options!;
    expect(missing.quote?.total).toBe(2); expect(missing.quote?.legs).toHaveLength(1);
    expect(missing.quote?.legs[0]?.recipientPlayerIds).toEqual(['p2', 'p3']);
    expect(missing.execution.blockedBy).toBe('TOLL_RECIPIENT');
    const selected = path.map(step => ({ ...step, payeePlayerId: 'p3' }));
    expect(route(room, selected).options?.execution.legal).toBe(true);
    const after = send(room, 'exploration', { type: 'explore', nodeId: 'D-01', path: selected });
    expect(after.state.players.p3!.balances['columbia-voucher']).toBe(room.state.players.p3!.balances['columbia-voucher'] + 2);
    expect(after.state.players.p1!.balances['columbia-voucher']).toBe(room.state.players.p1!.balances['columbia-voucher'] - 2);
    expect(after.state.board.cityNodeByPlayer).toEqual(room.state.board.cityNodeByPlayer);
    selected[1] = { ...selected[1]!, payeePlayerId: 'p2' };
    expect(route(room, selected).options?.execution.blockedBy).toBe('TOLL_RECIPIENT');
  });
  it('keeps own influence free, rejects unaffordable fees, closed red targets and disconnected paths', () => {
    const original = choose(snapshots.get(4)!, 'explore'), slot = core.loadFoundersBoard('four-player').routes['R-route-01']!.influenceSlotIds[0]!;
    expect(route(putMarker(original, slot, 'p1'), directPath).options?.quote?.total).toBe(0);
    const state = core.gameStateSchema.parse(original.state); state.players.p1!.balances['columbia-voucher'] = 0;
    expect(route(parseRoomSnapshot({ ...original, state }), directPath).options?.execution.blockedBy).toBe('CANNOT_PAY');
    const red = Object.values(core.loadFoundersBoard('four-player').resourceNodes).find(n => n.redRestricted)!;
    expect(route(original, walk(original, red.id)).options?.execution.blockedBy).toBe('RED_CLOSED');
    expect(route(original, [{ routeId: 'F-route-01', toNodeId: 'D-01' }]).options).toMatchObject({ execution: { blockedBy: 'PATH_CONNECTION' }, nextSteps: [] });
  });
  it('does not disclose route data at a stale version, for another game, before exploration or at another player turn', () => {
    const room = choose(snapshots.get(3)!, 'explore'), req = { roomId: room.roomId, gameId: room.state.gameId, expectedVersion: room.state.stateVersion, path: [] };
    expect(getRoomExplorationRoute(room, 'p1', { ...req, expectedVersion: req.expectedVersion - 1 })).toMatchObject({ options: null });
    expect(getRoomExplorationRoute(room, 'p1', { ...req, gameId: 'different-game' })).toMatchObject({ options: null });
    expect(route(snapshots.get(3)!, []).options).toBeNull();
    expect(explorationRouteRequestSchema.safeParse({ ...req, path: Array(23).fill(directPath[0]) }).success).toBe(false);
    expect(explorationRouteRequestSchema.safeParse({ ...req, actorId: 'p2' }).success).toBe(false);
  });
  it('matches city movement options and preserves route identity, payment, clearing and separate final placement', () => {
    let room = choose(snapshots.get(4)!, 'city-move'), result = options(room).options!.travel!;
    expect(result.moves.map(({ nodeId, routeId }) => ({ nodeId, routeId }))).toEqual(core.getCityMoveOptions(room.state, room.definition, 'p1'));
    const move = result.moves.find(m => m.legal && m.nodeId === 'D-01')!;
    expect(move).toBeDefined();
    const slot = core.loadFoundersBoard('four-player').routes[move.routeId]!.influenceSlotIds[0]!;
    room = putMarker(room, slot);
    const oldCount = room.state.markerSupplyByPlayer.p2!.length;
    const after = send(room, 'city-move', { type: 'move-city', nodeId: move.nodeId, routeId: move.routeId });
    expect(after.state.players.p1!.balances.originium).toBe(room.state.players.p1!.balances.originium - 3);
    expect(after.state.board.cityNodeByPlayer.p1).toBe('D-01');
    expect(after.state.board.influenceBySlot[slot]).toBeNull();
    expect(after.state.markerSupplyByPlayer.p2).toHaveLength(oldCount + 1);
    result = options(after).options!.travel!;
    expect(result.status).toBe('event-choice'); expect(result.event?.cardId).toBe(after.state.cityMove!.cardId);
    expect(options(after, 'p2').options).toBeNull();
    expect(options(after).options?.cancelPreparation.legal).toBe(false);
    const variant = result.event!.choices.flatMap(c => c.variants).find(v => v.legal)!;
    const settled = send(after, 'city-move', { type: 'choose-city-move-event', choice: variant.choice });
    const final = options(settled).options!.travel!;
    expect(final.finalSlotIds).toEqual(core.getCityMoveFinalSlotIds(settled.state, settled.definition, 'p1'));
    expect(options(settled).options?.finishTurn.legal).toBe(false);
    const completed = send(settled, 'city-move', { type: 'place-city-move-influence', slotId: final.finalSlotIds[0] });
    expect(options(completed).options?.finishTurn.legal).toBe(true);
  });
  it.each(['G05', 'G06', ...Array.from({ length: 10 }, (_, i) => `Y${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 6 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`)])('projects revealed %s choices and executable variants without exposing other cards', cardId => {
    const room = eventRoom(cardId), before = JSON.stringify(room), result = options(room).options!.travel!, card = core.getFoundersEventCard(cardId);
    expect(result.event).toMatchObject({ cardId, title: card.title, description: card.description });
    expect(result.event!.choices.map(c => c.id)).toEqual(card.choices.map(c => c.id));
    expect(JSON.stringify(result)).not.toMatch(/drawPile|DeckOrder|markerId|placedRole|members/);
    for (const choice of result.event!.choices) {
      const source = card.choices.find(c => c.id === choice.id)!;
      expect(choice.narration).toBe(source.narration); expect(choice.effects).toEqual(source.effects); expect(choice.cost).toEqual(source.cost);
      for (const v of choice.variants) if (v.legal) expect(() => send(room, 'exploration', { type: 'choose-exploration-event', choice: v.choice })).not.toThrow();
    }
    expect(Object.isFrozen(result.event!.choices)).toBe(true);
    expect(JSON.stringify(room)).toBe(before);
  });
  it('retains pay/decline and event placement before recomputing final action influence', () => {
    const room = eventRoom('Y05'), choice = options(room).options!.travel!.event!.choices[0]!;
    expect(choice.variants.some(v => v.choice.costDecision === 'decline' && v.legal)).toBe(true);
    const payment = choice.variants.find(v => v.legal && v.choice.costDecision === 'pay')!;
    const settled = send(room, 'exploration', { type: 'choose-exploration-event', choice: payment.choice });
    expect(settled.state.players.p1!.balances['columbia-voucher']).toBe(room.state.players.p1!.balances['columbia-voucher'] - 4);
    expect(settled.state.board.influenceBySlot[payment.choice.influenceSlotId!]?.ownerPlayerId).toBe('p1');
    expect(options(settled).options!.travel!.finalSlotIds).toEqual(core.getExplorationFinalSlotIds(settled.state, settled.definition, 'p1'));
    const finalId = options(settled).options!.travel!.finalSlotIds[0]!;
    const done = send(settled, 'exploration', { type: 'place-exploration-influence', slotId: finalId });
    expect(options(done).options?.finishTurn.legal).toBe(true);
    const state = core.gameStateSchema.parse(room.state); state.players.p1!.balances['columbia-voucher'] = 0;
    const blocked = options(parseRoomSnapshot({ ...room, state })).options!.travel!.event!.choices[0]!;
    expect(blocked.variants.filter(v => v.choice.costDecision === 'pay').every(v => !v.legal && v.blockedBy === 'CANNOT_PAY')).toBe(true);
    expect(blocked.variants.find(v => v.choice.costDecision === 'decline')?.legal).toBe(true);
  });
  it('normalizes route storage/member failures and never invokes a write or initialization', async () => {
    const room = choose(snapshots.get(3)!, 'explore'), compareAndSwap = vi.fn(), read = vi.fn(async (id: string) => id === room.roomId ? room : null);
    const service = new RoomService({ create: async () => false, read, compareAndSwap });
    const req = { roomId: room.roomId, gameId: room.state.gameId, expectedVersion: room.state.stateVersion, path: directPath };
    const denied = await service.readExplorationRoute(req, { authenticatedUserId: 'outsider' });
    expect(await service.readExplorationRoute({ ...req, roomId: 'missing-room' }, { authenticatedUserId: 'outsider' })).toEqual(denied);
    expect(await service.readExplorationRoute({ ...req, playerId: 'p2' }, { authenticatedUserId: 'user-p1' })).toMatchObject({ error: { code: 'INVALID_MESSAGE' } });
    read.mockRejectedValueOnce(Error('PRIVATE_SQL'));
    expect(await service.readExplorationRoute(req, { authenticatedUserId: 'user-p1' })).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(compareAndSwap).not.toHaveBeenCalled();
  });
});

function fund(room: RoomSnapshot) {
  const state = core.gameStateSchema.parse(room.state);
  for (const asset of Object.keys(state.players.p1!.balances) as (keyof core.GameState['players'][string]['balances'])[]) state.players.p1!.balances[asset] = 1000;
  return parseRoomSnapshot({ ...room, state });
}
function supplyCard(room: RoomSnapshot, facilityId: string, exclude?: string) {
  const state = core.gameStateSchema.parse(room.state), supply = state.facilities!.supply;
  const card = [...supply.supply, ...supply.drawPile].find(id => id !== exclude && core.getFacilityPhysicalCard(id).facilityId === facilityId)!;
  if (!card) throw Error(`Missing fixture ${facilityId}`);
  if (!supply.supply.includes(card)) {
    const index = supply.drawPile.indexOf(card), old = supply.supply[0]!;
    supply.drawPile[index] = old; supply.supply[0] = card;
  }
  return { room: parseRoomSnapshot({ ...room, state }), cardId: card };
}
function buildDraft(cardId: string, cellId = 'CP-2-2', paymentMode: 'resources' | 'vouchers' = 'vouchers'): ConstructionDraft {
  return { channel: 'construction', command: { type: 'construct-facility', cardId, cellId, paymentMode, entryChoice: { kind: 'deferred-entry' } } };
}
function constructionPreview(room: RoomSnapshot, draft: ConstructionDraft, actor = 'p1') {
  const parsed = constructionPreviewRequestSchema.parse({ roomId: room.roomId, channel: draft.channel,
    command: { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...draft.command } });
  const result = getRoomConstructionPreview(room, actor, parsed);
  if (result.status !== 'ready') throw Error('Expected construction preview');
  return result;
}
function constructFixture(facilityId: string, count = 4) {
  const { room, cardId } = supplyCard(fund(snapshots.get(count)!), facilityId);
  return { room: choose(room, 'construct'), cardId };
}
function built(facilityId: string, count = 4) {
  const { room, cardId } = constructFixture(facilityId, count);
  return send(room, 'construction', buildDraft(cardId).command);
}
function nextOwnTurn(room: RoomSnapshot) {
  room = send(room, 'round', { type: 'finish-player-turn' });
  while (core.getRoundTurn(room.state, room.definition).actorId !== 'p1') {
    room = choose(room, 'dispatch');
    room = send(room, 'round', { type: 'finish-player-turn' });
  }
  return room;
}
function entrySend(room: RoomSnapshot, entryChoice: Record<string, unknown>) {
  return send(room, 'facility-entry', { type: 'resolve-facility-entry', entryChoice });
}
describe('construction and persisted facility-entry presentation', () => {
  it.each([2, 3, 4])('offers %i-player public supply and own logical grid, and quotes without changing any saved facts', count => {
    const { room, cardId } = constructFixture('FAC-010', count), before = JSON.stringify(room), choices = options(room).options!.construction!;
    expect(choices.cells).toHaveLength(12); expect(choices.emptyCellIds).toHaveLength(11);
    expect(choices.cells.find(c => c.id === 'CP-3-2')?.card?.color).toBe('rainbow');
    expect(choices.supply.map(c => c.cardId)).toEqual(room.state.facilities!.supply.supply);
    expect(options(room, 'p2').options).toBeNull();
    const preview = constructionPreview(room, buildDraft(cardId)).options!;
    expect(preview.execution.legal).toBe(true);
    const quote = core.getConstructionQuote(room.state, room.definition, { authenticatedPlayerId: 'p1' }, {
      gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...buildDraft(cardId).command });
    expect(preview.quote?.costs).toEqual(quote.costs);
    expect(JSON.stringify(preview)).not.toMatch(/drawPile|DeckOrder|members|placedRole|markerId|refilledCardIds/);
    expect(JSON.stringify(room)).toBe(before);
  });
  it.each(Array.from({ length: 17 }, (_, i) => `FAC-${String(i + 1).padStart(3, '0')}`))('constructs %s with original payment, refill, grid and score before projecting its real entry state', facilityId => {
    const { room, cardId } = constructFixture(facilityId), draft = buildDraft(cardId);
    expect(constructionPreview(room, draft).options?.execution.legal).toBe(true);
    const next = send(room, 'construction', draft.command), result = options(next).options!.construction!;
    expect(next.state.stateVersion).toBe(room.state.stateVersion + 1);
    expect(next.state.facilities!.supply.supply).toHaveLength(6);
    expect(next.state.facilities!.supply.supply).not.toContain(cardId);
    expect(next.state.facilities!.panels[0]!.placements).toContainEqual({ cardId, cellId: 'CP-2-2' });
    expect(next.state.players.p1!.score).toBe(room.state.players.p1!.score + core.getFacilityExecutionFace(facilityId).printedScore);
    expect(result.status).toBe(next.state.construction!.status);
    expect(next.state.roundFlow!.turnIndex).toBe(room.state.roundFlow!.turnIndex);
  });
  it('refuses to fund construction from future entry gains and preserves unresolved refill and version limits', () => {
    const { room, cardId } = constructFixture('FAC-010'), state = core.gameStateSchema.parse(room.state);
    for (const key of Object.keys(state.players.p1!.balances) as (keyof core.GameState['players'][string]['balances'])[]) state.players.p1!.balances[key] = 0;
    const poor = parseRoomSnapshot({ ...room, state });
    expect(constructionPreview(poor, buildDraft(cardId, 'CP-2-2', 'resources')).options?.execution.blockedBy).toBe('CANNOT_PAY');
    const exhausted = core.gameStateSchema.parse(room.state);
    exhausted.facilities!.supply.returnedToBox.push(...exhausted.facilities!.supply.drawPile); exhausted.facilities!.supply.drawPile = [];
    expect(constructionPreview(parseRoomSnapshot({ ...room, state: exhausted }), buildDraft(cardId)).options?.execution.blockedBy).toBe('REFILL_RULE_UNRESOLVED');
    expect(constructionPreview(parseRoomSnapshot({ ...room, state: { ...room.state, stateVersion: Number.MAX_SAFE_INTEGER } }), buildDraft(cardId)).options?.execution.blockedBy).toBe('VERSION_OVERFLOW');
  });
  it('keeps unique-facility rejection and physical-card conservation through a second actual action cycle', () => {
    const first = built('FAC-017'), original = first.state.construction!.builtCardId!, staged = supplyCard(nextOwnTurn(first), 'FAC-017', original);
    const opened = choose(staged.room, 'construct'), before = JSON.stringify(opened);
    expect(constructionPreview(opened, buildDraft(staged.cardId, 'CP-2-1')).options?.execution.blockedBy).toBe('UNIQUE_FACILITY');
    expect(JSON.stringify(opened)).toBe(before);
  });
  it('completes warehouse placement then moves the same newly placed marker, with no new major action', () => {
    const room = built('FAC-001'), placeSlotId = 'node:A-01:slot:1', targetSlotId = 'route:R-route-01:slot:1';
    const draft: ConstructionDraft = { channel: 'facility-entry', command: { type: 'resolve-facility-entry', entryChoice: {
      kind: 'warehouse-influence', placeSlotId, move: { sourceSlotId: placeSlotId, targetSlotId } } } };
    expect(constructionPreview(room, draft).options?.execution.legal).toBe(true);
    const markerId = room.state.markerSupplyByPlayer.p1![0]!, next = send(room, draft.channel, draft.command);
    expect(next.state.board.influenceBySlot[placeSlotId]).toBeNull();
    expect(next.state.board.influenceBySlot[targetSlotId]).toEqual({ markerId, ownerPlayerId: 'p1' });
    expect(next.state.construction!.status).toBe('complete'); expect(options(next).options?.finishTurn.legal).toBe(true);
  });
  it('resumes nested warehouse exploration using the original route quote, event and final placement', () => {
    let room = entrySend(built('FAC-001'), { kind: 'warehouse-explore' });
    expect(options(room).options!.travel).toMatchObject({ kind: 'explore', channel: 'facility-entry', status: 'ready' });
    expect(route(room, directPath).options?.quote).toEqual({ total: 2, legs: [{ routeId: 'R-route-01', amount: 2, recipientPlayerIds: [], toSupply: true }] });
    expect(route(room, directPath).options?.execution.legal).toBe(true);
    room = send(room, 'facility-entry', { type: 'explore', nodeId: 'D-01', path: directPath });
    const event = options(room).options!.travel!.event!, variant = event.choices.flatMap(c => c.variants).find(v => v.legal)!;
    room = send(room, 'facility-entry', { type: 'choose-exploration-event', choice: variant.choice });
    const finals = options(room).options!.travel!.finalSlotIds;
    if (finals.length) room = send(room, 'facility-entry', { type: 'place-exploration-influence', slotId: finals[0] });
    expect(room.state.construction!.status).toBe('complete'); expect(room.state.construction!.constructionsCompleted).toBe(1);
    expect(room.state.phase).toBe('construction'); expect(room.state.roundFlow!.turnIndex).toBe(0);
  });
  it('supports the saved legacy warehouse branch without restarting construction', () => {
    const { room, cardId } = constructFixture('FAC-001');
    let next = send(room, 'construction', { ...buildDraft(cardId).command, entryChoice: { kind: 'warehouse-entry' } });
    expect(options(next).options!.travel?.channel).toBe('warehouse-entry');
    expect(route(next, directPath).options?.execution.legal).toBe(true);
    next = send(next, 'warehouse-entry', { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' }, warehouseExploration: { nodeId: 'D-01', path: directPath } });
    const variant = options(next).options!.travel!.event!.choices.flatMap(c => c.variants).find(v => v.legal)!;
    next = send(next, 'warehouse-entry', { type: 'choose-exploration-event', choice: variant.choice });
    const finals = options(next).options!.travel!.finalSlotIds;
    if (finals.length) next = send(next, 'warehouse-entry', { type: 'place-exploration-influence', slotId: finals[0] });
    expect(next.state.construction!.status).toBe('complete');
  });
  it('restores an impossible legacy warehouse exploration without forcing a fictitious path', () => {
    const { room, cardId } = constructFixture('FAC-001');
    const built = send(room, 'construction', { ...buildDraft(cardId).command, entryChoice: { kind: 'warehouse-entry' } });
    const state = core.gameStateSchema.parse(built.state); state.players.p1!.balances['columbia-voucher'] = 0;
    const pending = parseRoomSnapshot({ ...built, state });
    expect(options(pending).options!.construction!.entry!.skipExploration?.legal).toBe(true);
    const next = send(pending, 'warehouse-entry', { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' } });
    expect(next.state.construction!.status).toBe('complete');
    expect(next.state.construction!.warehouseEntry?.status).toBe('skipped');
  });
  it('keeps free city movement, its event, final node influence and additional route influence distinct', () => {
    let room = built('FAC-007');
    const travel = options(room).options!.travel!;
    expect(travel.cityMoveCost).toBe(0); expect(travel.channel).toBe('facility-entry');
    const move = travel.moves.find(m => m.legal && m.nodeId === 'D-01')!, oldFunds = room.state.players.p1!.balances.originium;
    room = send(room, 'facility-entry', { type: 'move-city', nodeId: move.nodeId, routeId: move.routeId });
    expect(room.state.players.p1!.balances.originium).toBe(oldFunds);
    const variant = options(room).options!.travel!.event!.choices.flatMap(c => c.variants).find(v => v.legal)!;
    room = send(room, 'facility-entry', { type: 'choose-city-move-event', choice: variant.choice });
    room = send(room, 'facility-entry', { type: 'place-city-move-influence', slotId: options(room).options!.travel!.finalSlotIds[0] });
    const routeSlot = options(room).options!.construction!.entry!.routeSlotIds[0]!;
    expect(routeSlot).toBeDefined(); expect(options(room).options?.finishTurn.legal).toBe(false);
    room = send(room, 'facility-entry', { type: 'place-entry-route-influence', slotId: routeSlot });
    expect(room.state.construction!.status).toBe('complete'); expect(options(room).options?.finishTurn.legal).toBe(true);
  });
  it('quotes and performs a paid extra construction within the same major-action grant', () => {
    let room = built('FAC-016'), target = supplyCard(room, 'FAC-010'); room = target.room;
    expect(options(room).options!.construction!.buildChannel).toBe('facility-entry');
    const draft: ConstructionDraft = { channel: 'facility-entry', command: { type: 'construct-entry-facility', cardId: target.cardId, cellId: 'CP-2-1', paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' } } };
    const preview = constructionPreview(room, draft).options!; expect(preview.execution.legal).toBe(true); expect(preview.quote?.costs.length).toBeGreaterThan(0);
    const next = send(room, draft.channel, draft.command);
    expect(next.state.facilities!.panels[0]!.placements).toHaveLength(3); expect(next.state.roundFlow!.turnIndex).toBe(0);
    expect(next.state.construction!.status).toBe('complete');
  });
  it('copies only an original adjacent non-rainbow entry and does not repeat printed points or construction costs', () => {
    const first = built('FAC-010'), target = supplyCard(nextOwnTurn(first), 'FAC-014');
    let room = send(choose(target.room, 'construct'), 'construction', buildDraft(target.cardId, 'CP-2-1').command);
    const entry = options(room).options!.construction!.entry!, sourceId = first.state.construction!.builtCardId!;
    expect(entry.copyCards.map(c => c.cardId)).toContain(sourceId);
    const old = room.state.players.p1!, oldCount = room.state.facilities!.panels[0]!.placements.length;
    room = send(room, 'facility-entry', { type: 'copy-facility-entry', targetCardId: sourceId });
    expect(room.state.players.p1!.balances.iron).toBe(old.balances.iron + 4); expect(room.state.players.p1!.score).toBe(old.score);
    expect(room.state.players.p1!.balances['columbia-voucher']).toBe(old.balances['columbia-voucher']);
    expect(room.state.facilities!.panels[0]!.placements).toHaveLength(oldCount);
  });
  it('places a reserve-only logistics extension for free and permits explicit decline', () => {
    const room = built('FAC-004'), cardId = options(room).options!.construction!.entry!.extensionCards[0]!.cardId;
    const draft: ConstructionDraft = { channel: 'facility-entry', command: { type: 'build-logistics-extension', placement: { cardId, cellId: 'CP-2-1' } } };
    expect(constructionPreview(room, draft).options?.execution.legal).toBe(true);
    const next = send(room, draft.channel, draft.command);
    expect(next.state.facilities!.supply.extensionReserve).not.toContain(cardId);
    expect(next.state.players.p1!.balances).toEqual(room.state.players.p1!.balances);
    expect(send(room, 'facility-entry', { type: 'build-logistics-extension', placement: null }).state.construction!.status).toBe('complete');
  });
  it('resolves resource allocation, mandatory removal, mercenary replacement and optional sales through original effects', () => {
    let room = built('FAC-008'), previous = room.state.players.p1!.balances;
    room = entrySend(room, { kind: 'resource-allocation', gains: { orirock: 1, originium: 2, iron: 2 } });
    expect(room.state.players.p1!.balances.orirock).toBe(previous.orirock + 1);
    let initial = constructFixture('FAC-002');
    let marked = putMarker(putMarker(initial.room, 'route:R-route-01:slot:1', 'p2'), 'node:A-01:slot:1', 'p1');
    marked = send(marked, 'construction', buildDraft(initial.cardId).command);
    const partial: ConstructionDraft = { channel: 'facility-entry', command: { type: 'resolve-facility-entry', entryChoice: { kind: 'remove-influence', slotIds: ['node:A-01:slot:1'] } } };
    expect(constructionPreview(marked, partial).options?.execution.legal).toBe(false);
    room = entrySend(marked, { kind: 'remove-influence', slotIds: ['node:A-01:slot:1', 'route:R-route-01:slot:1'] });
    expect(Object.values(room.state.board.influenceBySlot).every(m => m === null)).toBe(true);
    initial = constructFixture('FAC-003'); marked = putMarker(initial.room, 'node:A-02:slot:1', 'p2');
    marked = send(marked, 'construction', buildDraft(initial.cardId).command);
    room = entrySend(marked, { kind: 'mercenary-influence', effect: 'replace', slotId: 'node:A-02:slot:1' });
    expect(room.state.board.influenceBySlot['node:A-02:slot:1']).toBeNull();
    const sales = built('FAC-006'), oldVouchers = sales.state.players.p1!.balances['columbia-voucher'];
    room = entrySend(sales, { kind: 'sell-resources', amounts: { orirock: 1, originium: 2, iron: 1, 'pure-originium': 1 } });
    expect(room.state.players.p1!.balances['columbia-voucher']).toBe(oldVouchers + 28);
  });
  it('rejects stale, other-game and nonactor drafts, unsafe channels, injection and failed storage without committing', async () => {
    const { room, cardId } = constructFixture('FAC-010'), draft = buildDraft(cardId);
    const req = constructionPreviewRequestSchema.parse({ roomId: room.roomId, channel: draft.channel, command: { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...draft.command } });
    expect(constructionPreview(room, draft, 'p2').options).toBeNull();
    expect(getRoomConstructionPreview(room, 'p1', constructionPreviewRequestSchema.parse({ ...req, command: { ...req.command, expectedVersion: 0 } }))).toMatchObject({ options: null });
    expect(getRoomConstructionPreview(room, 'p1', constructionPreviewRequestSchema.parse({ ...req, command: { ...req.command, gameId: 'different-game' } }))).toMatchObject({ options: null });
    expect(constructionPreviewRequestSchema.safeParse({ ...req, actorId: 'p2' }).success).toBe(false);
    const compareAndSwap = vi.fn(), read = vi.fn(async (id: string) => id === room.roomId ? room : null), service = new RoomService({ create: async () => false, read, compareAndSwap });
    const denied = await service.readConstructionPreview(req, { authenticatedUserId: 'outsider' });
    expect(await service.readConstructionPreview({ ...req, roomId: 'missing-room' }, { authenticatedUserId: 'outsider' })).toEqual(denied);
    expect(await service.readConstructionPreview({ ...req, channel: 'round' }, { authenticatedUserId: 'user-p1' })).toMatchObject({ error: { code: 'INVALID_MESSAGE' } });
    read.mockRejectedValueOnce(Error('PRIVATE_SQL'));
    expect(await service.readConstructionPreview(req, { authenticatedUserId: 'user-p1' })).toMatchObject({ error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(compareAndSwap).not.toHaveBeenCalled();
  });
});
