import { beforeAll, describe, expect, it, vi } from "vitest";
import * as core from "@nomad-city-online/game-core";
import { createAutomaticBaseRoomSnapshot } from "./base-room-factory.js";
import { baseSetupIds } from "./automatic-base-plan.js";
import { getRoomRoundSetupOptions } from "./round-setup-options.js";
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
      roomId: `round-options-${count}`,
      gameId: `round-game-${count}`,
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
    snapshots.set(count, saved);
  }
});
function options(room: RoomSnapshot, actor = "p1") {
  const result = getRoomRoundSetupOptions(room, actor);
  if (result.status !== "ready") throw Error("Expected ready");
  return result;
}
function round(
  room: RoomSnapshot,
  command: Record<string, unknown>,
): RoomSnapshot {
  const actor = core.getRoundTurn(room.state, room.definition).actorId!;
  return parseRoomSnapshot({
    ...room,
    state: core.applyRoundCommand(
      room.state,
      room.definition,
      { authenticatedPlayerId: actor },
      {
        gameId: room.state.gameId,
        expectedVersion: room.state.stateVersion,
        ...command,
      },
    ),
  });
}
describe("read-only authoritative round preparation options", () => {
  it("offers exactly the actual two-player supply without changing the saved state or hidden deck", () => {
    const room = snapshots.get(2)!,
      before = JSON.stringify(room),
      result = options(room);
    expect(result.options?.stage).toBe("role-removal");
    if (result.options?.stage !== "role-removal") return;
    expect(result.options.cards.map((c) => c.cardId)).toEqual(
      room.state.facilities!.supply.supply,
    );
    for (const card of result.options.cards) {
      const source = core.getFacilityPhysicalCard(card.cardId);
      expect(card.name).toBe(
        core.getFacilityExecutionFace(source.facilityId).name,
      );
      expect(card.legal).toBe(true);
      expect(card.effect).toBe(core.getFacilityEffectText(source.facilityId));
      expect(() =>
        round(room, { type: "remove-round-supply-card", cardId: card.cardId }),
      ).not.toThrow();
    }
    expect(JSON.stringify(room)).toBe(before);
    expect(Object.isFrozen(result.options.cards[0]!.constructionCost)).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /drawPile|DeckOrder|members|rolesByPlayer|user-p/,
    );
  });
  it.each([3, 4])(
    "offers %i-player actor roles from the real reducer and gives nonactors no choices",
    (count) => {
      const room = snapshots.get(count)!,
        result = options(room);
      expect(result.options?.stage).toBe("role-placement");
      if (result.options?.stage !== "role-placement") return;
      expect(result.options.roles.map((r) => r.roleId)).toEqual(
        core.FOUNDERS_BASE_ROLES.map((r) => r.id),
      );
      expect(result.options.recoversDiscard).toBe(false);
      expect(options(room, "p2").options).toBeNull();
      for (const role of result.options.roles)
        expect(() =>
          round(room, { type: "place-round-role", roleId: role.roleId }),
        ).not.toThrow();
    },
  );
  it("replaces a removed card using the original reducer, advances the actor and never repeats the removed physical ID", () => {
    const room = snapshots.get(2)!,
      first = room.state.facilities!.supply.supply[0]!;
    const next = round(room, {
      type: "remove-round-supply-card",
      cardId: first,
    });
    expect(options(next).options).toBeNull();
    const second = options(next, "p2");
    expect(second.options?.stage).toBe("role-removal");
    if (second.options?.stage !== "role-removal") return;
    expect(second.options.cards).toHaveLength(6);
    expect(second.options.cards.map((c) => c.cardId)).not.toContain(first);
    expect(next.state.facilities!.supply.returnedToBox).toContain(first);
  });
  it("does not invent an exhaustion fallback when the mandatory refill is impossible", () => {
    const room = snapshots.get(2)!,
      s = core.gameStateSchema.parse(room.state);
    s.facilities!.supply.returnedToBox.push(...s.facilities!.supply.drawPile);
    s.facilities!.supply.drawPile = [];
    const changed = parseRoomSnapshot({ ...room, state: s }),
      result = options(changed);
    expect(result.options?.stage).toBe("role-removal");
    if (result.options?.stage !== "role-removal") return;
    expect(
      result.options.cards.every(
        (c) => !c.legal && c.blockedBy === "REFILL_UNRESOLVED",
      ),
    ).toBe(true);
    expect(changed.state.stateVersion).toBe(room.state.stateVersion);
  });
  it("uses only the own remaining hand and permits original empty-hand discard recovery without executing it", () => {
    const room = snapshots.get(3)!,
      s = core.gameStateSchema.parse(room.state),
      row = s.roundFlow!.rolesByPlayer[0]!;
    row.discarded = row.hand.splice(1);
    let changed = parseRoomSnapshot({ ...room, state: s });
    let result = options(changed);
    expect(result.options?.stage).toBe("role-placement");
    if (result.options?.stage !== "role-placement") return;
    expect(result.options.roles.map((r) => r.roleId)).toEqual(["ROLE-01"]);
    row.discarded.push(...row.hand.splice(0));
    changed = parseRoomSnapshot({ ...room, state: s });
    result = options(changed);
    if (result.options?.stage !== "role-placement")
      throw Error("Expected placement");
    expect(result.options.recoversDiscard).toBe(true);
    expect(result.options.roles).toHaveLength(5);
    expect(changed.state.roundFlow!.rolesByPlayer[0]!.hand).toEqual([]);
    expect(
      round(changed, { type: "place-round-role", roleId: "ROLE-04" }).state
        .roundFlow!.rolesByPlayer[0]!.placed,
    ).toBe("ROLE-04");
  });
  it("does not reveal a previous player placed role and returns no setup choices after everyone places", () => {
    let room = snapshots.get(3)!;
    room = round(room, { type: "place-round-role", roleId: "ROLE-03" });
    const result = options(room, "p2");
    expect(JSON.stringify(result)).not.toMatch(/placed|hand|discarded/);
    expect(
      core.getGamePlayerView(room.state, room.definition, {
        authenticatedPlayerId: "p2",
      }).private.placedRoleId,
    ).toBeNull();
    room = round(room, { type: "place-round-role", roleId: "ROLE-02" });
    room = round(room, { type: "place-round-role", roleId: "ROLE-01" });
    expect(options(room).options).toBeNull();
    expect(room.state.roundFlow!.stage).toBe("player-actions");
  });
  it("blocks choices during an unfinished automatic initialization and never resumes it as a read side effect", async () => {
    const entry = entries.get(3)!,
      state = core.beginRoundFlow(entry.state, entry.definition, {
        expectedVersion: entry.state.stateVersion,
        facilityDeckOrder: core.FOUNDERS_FACILITY_STOCK.cards
          .filter((c) => c.group === "ordinary")
          .map((c) => c.id),
      });
    const pending = parseRoomSnapshot({ ...entry, state }),
      compareAndSwap = vi.fn();
    const service = new RoomService({
      create: async () => false,
      read: async () => pending,
      compareAndSwap,
    });
    expect(
      await service.readRoundSetupOptions(pending.roomId, {
        authenticatedUserId: "user-p1",
      }),
    ).toMatchObject({
      status: "ready",
      blockedReason: "AUTOMATION_PENDING",
      options: null,
    });
    expect(compareAndSwap).not.toHaveBeenCalled();
  });
  it("reports version exhaustion through original reducer rejection without a candidate commit", () => {
    const room = snapshots.get(2)!,
      result = options(
        parseRoomSnapshot({
          ...room,
          state: { ...room.state, stateVersion: Number.MAX_SAFE_INTEGER },
        }),
      );
    if (result.options?.stage !== "role-removal")
      throw Error("Expected supply");
    expect(
      result.options.cards.every(
        (c) => c.blockedBy === "VERSION_OVERFLOW" && !c.legal,
      ),
    ).toBe(true);
  });
  it("keeps legacy manual rooms manual and does not create options before managed rounds exist", () => {
    const { lifecycle: _life, ...manual } = snapshots.get(3)!;
    expect(options(parseRoomSnapshot(manual)).options?.stage).toBe(
      "role-placement",
    );
    expect(options(entries.get(3)!).options).toBeNull();
  });
  it("enforces membership and normalizes missing or failed storage without invoking a write", async () => {
    const room = snapshots.get(3)!,
      read = vi.fn(async (id: string) => (id === room.roomId ? room : null)),
      compareAndSwap = vi.fn();
    const service = new RoomService({
      create: async () => false,
      read,
      compareAndSwap,
    });
    const denied = await service.readRoundSetupOptions(room.roomId, {
      authenticatedUserId: "outsider",
    });
    expect(denied).toEqual(
      await service.readRoundSetupOptions("missing", {
        authenticatedUserId: "outsider",
      }),
    );
    expect(
      await service.readRoundSetupOptions(room.roomId, {
        authenticatedUserId: "bad identity",
      }),
    ).toEqual(denied);
    read.mockRejectedValueOnce(Error("DO_NOT_LEAK"));
    expect(
      await service.readRoundSetupOptions(room.roomId, {
        authenticatedUserId: "user-p1",
      }),
    ).toEqual({
      status: "unavailable",
      error: { code: "STORAGE_UNAVAILABLE" },
    });
    expect(compareAndSwap).not.toHaveBeenCalled();
  });
});
