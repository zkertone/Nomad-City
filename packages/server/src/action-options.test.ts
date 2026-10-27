import { beforeAll, describe, expect, it, vi } from "vitest";
import * as core from "@nomad-city-online/game-core";
import { createAutomaticBaseRoomSnapshot } from "./base-room-factory.js";
import { baseSetupIds } from "./automatic-base-plan.js";
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

function send(room: RoomSnapshot, channel: "round" | "influence", command: Record<string, unknown>): RoomSnapshot {
  return parseRoomSnapshot({ ...room, state: (channel === "round" ? core.applyRoundCommand : core.applyInfluenceCommand)(
    room.state, room.definition, { authenticatedPlayerId: core.getRoundTurn(room.state, room.definition).actorId! },
    { gameId: room.state.gameId, expectedVersion: room.state.stateVersion, ...command },
  ) });
}
function options(room: RoomSnapshot, playerId = "p1") {
  const result = getRoomActionOptions(room, playerId);
  if (result.status !== "ready") throw Error("Expected ready");
  return result;
}
function choose(room: RoomSnapshot, action: "deploy" | "dispatch") {
  return send(room, "round", { type: "choose-major-action", action });
}
describe("actor-only ordinary action options from existing reducers", () => {
  it.each([2, 3, 4])("offers %i-player choices without modifying a snapshot or revealing private zones", count => {
    const room = snapshots.get(count)!, before = JSON.stringify(room), result = options(room);
    expect(result.options?.actions).toEqual([
      { action: "deploy", legal: true, blockedBy: null }, { action: "dispatch", legal: true, blockedBy: null },
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
