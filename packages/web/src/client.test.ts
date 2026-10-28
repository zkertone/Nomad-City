import { describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import type { GamePlayerView } from "@nomad-city-online/game-core";
import type { LobbyView } from "@nomad-city-online/server";
import { selectionKey } from "./selection-key.js";
import type { ConstructionDraft } from "@nomad-city-online/server";
import { CityClient, errorMessage, newerGame, newerLobby } from "./client.js";

const lobby = (version: number, lobbyId = "lobby-a"): LobbyView => ({
  lobbyId,
  version,
  status: "waiting",
  playerCount: 2,
  selfPlayerId: "p1",
  ownerPlayerId: "p1",
  roomId: null,
  members: [{ playerId: "p1", color: "red", ready: false }],
  setup: null,
});
const game = (version: number, gameId = "game-a") =>
  ({
    public: { gameId, stateVersion: version },
    private: { playerId: "p1" },
  }) as GamePlayerView;
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
class FakeSocket {
  connected = false;
  handlers = new Map<string, ((value?: unknown) => void)[]>();
  request = vi.fn(
    async (event: string, _payload: unknown): Promise<unknown> => {
      if (event === "session:current")
        return { status: "authenticated", userId: "local-user-1" };
      if (event === "lobby:list")
        return { status: "listed", lobbies: [], nextAfterLobbyId: null };
      if (event === "room:list")
        return { status: "listed", rooms: [], nextAfterRoomId: null };
      if (
        event === "room:entry-options" ||
        event === "room:round-setup-options" || event === "room:action-options"
      )
        return {
          status: "ready",
          roomId: "room-a",
          gameId: "game-a",
          stateVersion: 1,
          options: null,
        };
      return { status: "unsubscribed" };
    },
  );
  on(name: string, handler: (value?: unknown) => void) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    return this;
  }
  emit(name: string, value?: unknown) {
    for (const handler of this.handlers.get(name) ?? []) handler(value);
  }
  connect() {
    this.connected = true;
    this.emit("connect");
  }
  disconnect() {
    this.connected = false;
    this.emit("disconnect");
  }
  timeout() {
    return this;
  }
  emitWithAck(event: string, payload: unknown) {
    return this.request(event, payload);
  }
}
async function fixture() {
  const values = new Map([["nco.local.session", "local-fixture-token"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const socket = new FakeSocket(),
    client = new CityClient(storage, () => socket as unknown as Socket);
  client.resume();
  await vi.waitFor(() =>
    expect(client.getSnapshot()).toMatchObject({
      connected: true,
      busy: false,
    }),
  );
  return { client, socket, values };
}
describe("browser session and confirmed-view controller", () => {
  it("matches construction drafts despite strict-schema object field reordering, while preserving changed choices and ordered removals", () => {
    const draft = { channel: "construction", command: { type: "construct-facility", cardId: "card", cellId: "CP-2-2", paymentMode: "vouchers", entryChoice: { kind: "deferred-entry" } } };
    const echo = { command: { cardId: "card", cellId: "CP-2-2", paymentMode: "vouchers", entryChoice: { kind: "deferred-entry" }, type: "construct-facility" }, channel: "construction" };
    expect(JSON.stringify(draft)).not.toBe(JSON.stringify(echo));
    expect(selectionKey(draft)).toBe(selectionKey(echo));
    expect(selectionKey(draft)).not.toBe(selectionKey({ ...draft, command: { ...draft.command, cellId: "CP-1-1" } }));
    expect(selectionKey({ slotIds: ["first", "second"] })).not.toBe(selectionKey({ slotIds: ["second", "first"] }));
  });
  it("uses original construction, facility-entry and warehouse channels, and previews the current confirmed version", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "room:subscribe") return { status: "ready", view: game(1) };
      if (event === "room:construction-preview") return { status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: f.client.getSnapshot().game!.public.stateVersion, options: null };
      if (event === "room:command") return { status: "committed", reply: { stateVersion: 2 }, view: game(f.client.getSnapshot().game!.public.stateVersion + 2) };
      return original(event, body);
    });
    await f.client.openRoom("room-a");
    const draft: ConstructionDraft = { channel: "construction", command: { type: "construct-facility", cardId: "card", cellId: "CP-2-2", paymentMode: "vouchers", entryChoice: { kind: "deferred-entry" } } };
    await f.client.constructionPreview(draft);
    expect(f.socket.request).toHaveBeenCalledWith("room:construction-preview", { roomId: "room-a", channel: "construction", command: { gameId: "game-a", expectedVersion: 1, ...draft.command } });
    await f.client.constructionCommand(draft);
    await f.client.constructionCommand({ channel: "facility-entry", command: { type: "resolve-facility-entry", entryChoice: { kind: "warehouse-explore" } } });
    await f.client.constructionCommand({ channel: "warehouse-entry", command: { type: "choose-exploration-event", choice: { choiceId: "Y01:1" } } });
    const writes = f.socket.request.mock.calls.filter(([e]) => e === "room:command");
    expect(writes.map(([, b]) => (b as { request: { channel: string } }).request.channel)).toEqual(["construction", "facility-entry", "warehouse-entry"]);
    expect(writes.map(([, b]) => (b as { request: { command: { expectedVersion: number } } }).request.command.expectedVersion)).toEqual([1, 3, 5]);
    f.client.dispose();
  });
  it("drops delayed construction quotes after new views or room changes, and rejects old-session replies", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) => event === "room:subscribe" ? { status: "ready", view: game(1) } : original(event, body));
    await f.client.openRoom("room-a");
    const draft: ConstructionDraft = { channel: "facility-entry", command: { type: "build-logistics-extension", placement: null } };
    const pending = gate<unknown>(); f.socket.request.mockImplementationOnce(() => pending.promise);
    const preview = f.client.constructionPreview(draft);
    f.socket.emit("room:state", { roomId: "room-a", view: game(2) });
    pending.resolve({ status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: 1, options: { draft } });
    expect(await preview).toBeNull();
    const later = gate<unknown>(); f.socket.request.mockImplementationOnce(() => later.promise);
    const old = f.client.constructionPreview(draft);
    await f.client.openRoom("room-b");
    later.resolve({ status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: 2, options: { draft } });
    expect(await old).toBeNull();
    const revoked = gate<unknown>(); f.socket.request.mockImplementationOnce(() => revoked.promise);
    const request = f.client.constructionPreview(draft), rejected = expect(request).rejects.toThrow("AUTH_REQUIRED");
    f.socket.emit("session:invalidated"); revoked.resolve({ status: "ready", roomId: "room-b", gameId: "game-a", stateVersion: 1, options: { draft } });
    await rejected; f.client.dispose();
  });
  it("does not retry rejected or timed-out construction mutations or accept their candidate views", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) => event === "room:subscribe" ? { status: "ready", view: game(1) } : original(event, body));
    await f.client.openRoom("room-a");
    const draft: ConstructionDraft = { channel: "facility-entry", command: { type: "build-logistics-extension", placement: null } };
    f.socket.request.mockResolvedValueOnce({ status: "rejected", reply: { error: { code: "STALE_VERSION" } }, view: game(99) });
    await f.client.run(() => f.client.constructionCommand(draft));
    f.socket.request.mockRejectedValueOnce(Error("PRIVATE_SQL"));
    await f.client.run(() => f.client.constructionCommand(draft));
    expect(f.client.getSnapshot().game?.public.stateVersion).toBe(1);
    expect(f.socket.request.mock.calls.filter(([e]) => e === "room:command")).toHaveLength(2);
    f.client.dispose();
  });

  it("uses original exploration and city-move channels and queries routes against the latest confirmed view", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "room:subscribe") return { status: "ready", view: game(1) };
      if (event === "room:exploration-route") return { status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: f.client.getSnapshot().game!.public.stateVersion, options: null };
      if (event === "room:command") return { status: "committed", reply: { stateVersion: 2 }, view: game(f.client.getSnapshot().game!.public.stateVersion + 2) };
      return original(event, body);
    });
    await f.client.openRoom("room-a");
    const path = [{ routeId: "R-route-01", toNodeId: "D-01", payeePlayerId: "p2" }];
    await f.client.explorationPreview(path);
    expect(f.socket.request).toHaveBeenCalledWith("room:exploration-route", { roomId: "room-a", gameId: "game-a", expectedVersion: 1, path });
    await f.client.explorationCommand({ type: "explore", nodeId: "D-01", path });
    await f.client.explorationCommand({ type: "choose-exploration-event", choice: { choiceId: "Y05:1", costDecision: "pay", influenceSlotId: "node:D-01:slot:1" } });
    await f.client.cityMoveCommand({ type: "move-city", nodeId: "D-01", routeId: "R-route-01" });
    await f.client.cityMoveCommand({ type: "place-city-move-influence", slotId: "node:D-01:slot:2" });
    const writes = f.socket.request.mock.calls.filter(([event]) => event === "room:command");
    expect(writes.map(([, b]) => (b as { request: { channel: string } }).request.channel)).toEqual(["exploration", "exploration", "city-move", "city-move"]);
    expect(writes.map(([, b]) => (b as { request: { command: { expectedVersion: number } } }).request.command.expectedVersion)).toEqual([1, 3, 5, 7]);
    expect(writes[1]![1]).toMatchObject({ request: { command: { choice: { costDecision: "pay", influenceSlotId: "node:D-01:slot:1" } } } });
    f.client.dispose();
  });
  it("discards an old route preview after a newer committed view or room selection", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!, pending = gate<unknown>();
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "room:subscribe") return { status: "ready", view: game(1) };
      if (event === "room:exploration-route") return pending.promise;
      return original(event, body);
    });
    await f.client.openRoom("room-a");
    const preview = f.client.explorationPreview([]);
    f.socket.emit("room:state", { roomId: "room-a", view: game(2) });
    pending.resolve({ status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: 1, options: { path: [] } });
    expect(await preview).toBeNull();
    const delayed = gate<unknown>();
    f.socket.request.mockImplementationOnce(() => delayed.promise);
    const old = f.client.explorationPreview([]);
    await f.client.openRoom("room-b");
    delayed.resolve({ status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: 2, options: { path: [] } });
    expect(await old).toBeNull();
    f.client.dispose();
  });
  it("drops revoked route responses and never retries a rejected or timed-out travel mutation", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!, pending = gate<unknown>();
    f.socket.request.mockImplementation(async (event, body) => event === "room:subscribe" ? { status: "ready", view: game(1) } : original(event, body));
    await f.client.openRoom("room-a");
    f.socket.request.mockResolvedValueOnce({ status: "rejected", reply: { error: { code: "STALE_VERSION" } }, view: game(99) });
    await f.client.run(() => f.client.cityMoveCommand({ type: "choose-city-move-event", choice: { choiceId: "Y05:1", costDecision: "decline" } }));
    expect(f.client.getSnapshot().game?.public.stateVersion).toBe(1);
    f.socket.request.mockRejectedValueOnce(Error("PRIVATE_SQL"));
    await f.client.run(() => f.client.explorationCommand({ type: "place-exploration-influence", slotId: "node:D-01:slot:1" }));
    expect(f.socket.request.mock.calls.filter(([event]) => event === "room:command")).toHaveLength(2);
    f.socket.request.mockImplementationOnce(() => pending.promise);
    const preview = f.client.explorationPreview([]);
    const rejected = expect(preview).rejects.toThrow("AUTH_REQUIRED");
    f.socket.emit("session:invalidated");
    pending.resolve({ status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: 1, options: null });
    await rejected; f.client.dispose();
  });

  it("queries actor action options and sends round/influence commands using only confirmed view versions", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!;
    const actionGame = (v: number) => ({ ...game(v), public: { ...game(v).public, round: { stage: "player-actions" } } }) as GamePlayerView;
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "room:subscribe") return { status: "ready", view: actionGame(1) };
      if (event === "room:action-options") return { status: "ready", roomId: "room-a", gameId: "game-a",
        stateVersion: f.client.getSnapshot().game!.public.stateVersion, options: null };
      if (event === "room:command") return { status: "committed", reply: { stateVersion: 2 },
        view: actionGame(f.client.getSnapshot().game!.public.stateVersion + 2) };
      return original(event, body);
    });
    await f.client.openRoom("room-a");
    expect(f.client.getSnapshot().actionOptions?.stateVersion).toBe(1);
    expect(f.client.getSnapshot().roundSetup).toBeNull();
    await f.client.majorActionCommand({ type: "choose-major-action", action: "deploy" });
    await f.client.influenceCommand({ type: "deploy-influence", slotId: "node:A-01:slot:1" });
    await f.client.majorActionCommand({ type: "finish-player-turn" });
    const writes = f.socket.request.mock.calls.filter(([e]) => e === "room:command");
    expect(writes.map(([, b]) => (b as { request: { channel: string } }).request.channel)).toEqual(["round", "influence", "round"]);
    expect(writes.map(([, b]) => (b as { request: { command: { expectedVersion: number } } }).request.command.expectedVersion)).toEqual([1, 3, 5]);
    expect(writes[1]![1]).toMatchObject({ request: { command: { type: "deploy-influence", slotId: "node:A-01:slot:1" } } });
    expect(f.client.getSnapshot().actionOptions?.stateVersion).toBe(7);
    f.client.dispose();
  });
  it("discards delayed action options after a newer view and clears them on disconnect or room changes", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!, delayed = gate<unknown>();
    const actionGame = (v: number) => ({ ...game(v), public: { ...game(v).public, round: { stage: "player-actions" } } }) as GamePlayerView;
    let queries = 0;
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "room:subscribe") return { status: "ready", view: actionGame(queries > 0 ? 2 : 1) };
      if (event === "room:action-options") return ++queries === 1 ? delayed.promise : { status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: 2, options: null };
      return original(event, body);
    });
    const opening = f.client.openRoom("room-a");
    await vi.waitFor(() => expect(queries).toBe(1));
    f.socket.emit("room:state", { roomId: "room-a", view: actionGame(2) });
    await vi.waitFor(() => expect(f.client.getSnapshot().actionOptions?.stateVersion).toBe(2));
    delayed.resolve({ status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: 1, options: null });
    await opening;
    expect(f.client.getSnapshot().actionOptions?.stateVersion).toBe(2);
    f.socket.disconnect(); expect(f.client.getSnapshot().actionOptions).toBeNull();
    f.socket.connect();
    await vi.waitFor(() => expect(f.client.getSnapshot().actionOptions).not.toBeNull());
    await f.client.openRoom("room-b"); // old room query identity does not fit selected room
    expect(f.client.getSnapshot().actionOptions).toBeNull();
    f.client.dispose();
  });
  it("does not retry influence mutations or replace a confirmed view after rejection or timeout", async () => {
    const f = await fixture(), original = f.socket.request.getMockImplementation()!;
    const current = { ...game(1), public: { ...game(1).public, round: { stage: "player-actions" } } } as GamePlayerView;
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "room:subscribe") return { status: "ready", view: current };
      if (event === "room:action-options") return { status: "ready", roomId: "room-a", gameId: "game-a", stateVersion: 1, options: null };
      return original(event, body);
    });
    await f.client.openRoom("room-a");
    const before = f.client.getSnapshot().actionOptions;
    f.socket.request.mockResolvedValueOnce({ status: "rejected", reply: { error: { code: "STALE_VERSION" } }, view: game(99) });
    await f.client.run(() => f.client.influenceCommand({ type: "dispatch-influence", sourceSlotId: "source", targetSlotId: "target" }));
    expect(f.client.getSnapshot().actionOptions).toBe(before);
    f.socket.request.mockRejectedValueOnce(Error("PRIVATE_SQL"));
    await f.client.run(() => f.client.influenceCommand({ type: "finish-dispatch" }));
    expect(f.client.getSnapshot().game?.public.stateVersion).toBe(1);
    expect(f.client.getSnapshot().error).toBe(errorMessage("TIMEOUT"));
    expect(f.socket.request.mock.calls.filter(([e]) => e === "room:command")).toHaveLength(2);
    f.socket.emit("session:invalidated");
    expect(f.client.getSnapshot().actionOptions).toBeNull();
    f.client.dispose();
  });

  it("uses the round channel and latest returned view version rather than the earlier player receipt", async () => {
    const f = await fixture(),
      original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "room:subscribe") return { status: "ready", view: game(1) };
      if (event === "room:command")
        return {
          status: "committed",
          reply: { stateVersion: 2 },
          view: game(5),
        };
      if (event === "room:round-setup-options")
        return {
          status: "ready",
          roomId: "room-a",
          gameId: "game-a",
          stateVersion: f.client.getSnapshot().game?.public.stateVersion,
          blockedReason: null,
          options: null,
        };
      return original(event, body);
    });
    await f.client.openRoom("room-a");
    await f.client.roundSetupCommand({
      type: "remove-round-supply-card",
      cardId: "physical-card",
    });
    await f.client.roundSetupCommand({
      type: "place-round-role",
      roleId: "ROLE-03",
    });
    const commands = f.socket.request.mock.calls.filter(
      ([event]) => event === "room:command",
    );
    expect(commands[0]![1]).toMatchObject({
      request: {
        channel: "round",
        command: { expectedVersion: 1, type: "remove-round-supply-card" },
      },
    });
    expect(commands[1]![1]).toMatchObject({
      request: {
        channel: "round",
        command: { expectedVersion: 5, type: "place-round-role" },
      },
    });
    expect(f.client.getSnapshot().roundSetup?.stateVersion).toBe(5);
    f.client.dispose();
  });
  it("does not replace newer round choices with delayed options for an earlier version", async () => {
    const f = await fixture(),
      original = f.socket.request.getMockImplementation()!,
      delayed = gate<unknown>();
    let queries = 0;
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "room:subscribe") return { status: "ready", view: game(1) };
      if (event === "room:round-setup-options")
        return ++queries === 1
          ? delayed.promise
          : {
              status: "ready",
              roomId: "room-a",
              gameId: "game-a",
              stateVersion: 2,
              blockedReason: null,
              options: null,
            };
      return original(event, body);
    });
    const opening = f.client.openRoom("room-a");
    await vi.waitFor(() => expect(queries).toBe(1));
    f.socket.emit("room:state", { roomId: "room-a", view: game(2) });
    await vi.waitFor(() =>
      expect(f.client.getSnapshot().roundSetup?.stateVersion).toBe(2),
    );
    delayed.resolve({
      status: "ready",
      roomId: "room-a",
      gameId: "game-a",
      stateVersion: 1,
      blockedReason: null,
      options: null,
    });
    await opening;
    expect(f.client.getSnapshot().roundSetup?.stateVersion).toBe(2);
    f.client.dispose();
  });
  it("clears round choices on disconnect and invalidation along with the own game view", async () => {
    const f = await fixture(),
      original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) =>
      event === "room:subscribe"
        ? { status: "ready", view: game(1) }
        : original(event, body),
    );
    await f.client.openRoom("room-a");
    expect(f.client.getSnapshot().roundSetup).not.toBeNull();
    f.socket.disconnect();
    expect(f.client.getSnapshot().roundSetup).toBeNull();
    f.socket.connect();
    await vi.waitFor(() =>
      expect(f.client.getSnapshot().roundSetup).not.toBeNull(),
    );
    f.socket.emit("session:invalidated");
    expect(f.client.getSnapshot()).toMatchObject({
      game: null,
      roundSetup: null,
    });
    f.client.dispose();
  });
  it("keeps the confirmed view and existing choices when a round mutation is rejected", async () => {
    const f = await fixture(),
      original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) =>
      event === "room:subscribe"
        ? { status: "ready", view: game(1) }
        : original(event, body),
    );
    await f.client.openRoom("room-a");
    const before = f.client.getSnapshot().roundSetup;
    f.socket.request.mockResolvedValueOnce({
      status: "rejected",
      reply: { error: { code: "STALE_VERSION" } },
      view: game(99),
    });
    await f.client.run(() =>
      f.client.roundSetupCommand({
        type: "place-round-role",
        roleId: "ROLE-03",
      }),
    );
    expect(f.client.getSnapshot().game?.public.stateVersion).toBe(1);
    expect(f.client.getSnapshot().roundSetup).toBe(before);
    f.client.dispose();
  });
  it("ignores an unavailable event from a previously selected lobby or room", async () => {
    const f = await fixture(),
      original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) => {
      if (event === "lobby:subscribe")
        return { status: "ready", view: lobby(3, "lobby-b") };
      if (event === "room:subscribe")
        return { status: "ready", view: game(7, "game-b") };
      return original(event, body);
    });
    await f.client.openLobby("lobby-b");
    await f.client.openRoom("room-b");
    f.socket.emit("lobby:unavailable", { lobbyId: "lobby-a" });
    f.socket.emit("room:unavailable", { roomId: "room-a" });
    expect(f.client.getSnapshot()).toMatchObject({
      lobby: { lobbyId: "lobby-b" },
      game: { public: { gameId: "game-b" } },
      error: null,
    });
    f.socket.emit("lobby:unavailable", { lobbyId: "lobby-b" });
    f.socket.emit("room:unavailable", { roomId: "room-b" });
    expect(f.client.getSnapshot()).toMatchObject({ lobby: null, game: null });
    f.client.dispose();
  });
  it("preserves newer game and lobby pushes when a later acknowledgement is older or equal", () => {
    const g = game(12),
      l = lobby(12);
    expect(newerGame(g, game(8))).toBe(g);
    expect(newerGame(g, game(12))).toBe(g);
    expect(newerGame(g, game(13)).public.stateVersion).toBe(13);
    expect(newerLobby(l, lobby(8))).toBe(l);
    expect(newerLobby(l, lobby(12))).toBe(l);
    expect(newerLobby(l, lobby(13)).version).toBe(13);
    expect(newerGame(g, game(1, "different")).public.gameId).toBe("different");
  });
  it("connects using a tab credential and resolves server identity without sending any client userId", async () => {
    const f = await fixture();
    expect(f.client.getSnapshot().userId).toBe("local-user-1");
    expect(f.socket.request.mock.calls[0]).toEqual(["session:current", {}]);
    f.client.dispose();
  });
  it("ignores game pushes for an unselected room and orders a selected room push before an older ack", async () => {
    const f = await fixture(),
      pending = gate<unknown>();
    f.socket.request.mockImplementationOnce(() => pending.promise);
    const opening = f.client.openRoom("room-a");
    f.socket.emit("room:state", { roomId: "wrong", view: game(99) });
    expect(f.client.getSnapshot().game).toBeNull();
    f.socket.emit("room:state", { roomId: "room-a", view: game(12) });
    pending.resolve({ status: "ready", view: game(10) });
    await opening;
    expect(f.client.getSnapshot().game?.public.stateVersion).toBe(12);
    expect(f.client.getSnapshot().entry).toBeNull();
    f.client.dispose();
  });
  it("does not let an old room subscription response replace a newly selected room", async () => {
    const f = await fixture(),
      pending = gate<unknown>();
    f.socket.request.mockImplementationOnce(() => pending.promise);
    const old = f.client.openRoom("room-a");
    const original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) =>
      event === "room:subscribe"
        ? { status: "ready", view: game(1, "game-b") }
        : original(event, body),
    );
    await f.client.openRoom("room-b");
    pending.resolve({ status: "ready", view: game(100) });
    await old;
    expect(f.client.getSnapshot()).toMatchObject({
      roomId: "room-b",
      game: { public: { gameId: "game-b", stateVersion: 1 } },
    });
    f.client.dispose();
  });
  it("discards old-session responses after invalidation and clears private views, invitations and persisted selection", async () => {
    const f = await fixture();
    f.socket.request.mockResolvedValueOnce({ status: "ready", view: lobby(1) });
    await f.client.openLobby("lobby-a");
    const pending = gate<unknown>();
    f.socket.request.mockImplementationOnce(() => pending.promise);
    const action = f.client.run(() => f.client.lobbyCommand("rotate-invite"));
    f.socket.emit("session:invalidated");
    pending.resolve({
      status: "updated",
      view: lobby(2),
      inviteToken: "NEVER_SHOW",
    });
    await action;
    expect(f.client.getSnapshot()).toMatchObject({
      userId: null,
      lobby: null,
      game: null,
      inviteToken: null,
      busy: false,
    });
    expect(f.values.size).toBe(0);
    f.client.dispose();
  });
  it("clears individual views on disconnect and reauthenticates/resubscribes saved selections on reconnect", async () => {
    const f = await fixture();
    const original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) =>
      event === "lobby:subscribe"
        ? { status: "ready", view: lobby(3) }
        : original(event, body),
    );
    await f.client.openLobby("lobby-a");
    f.socket.disconnect();
    expect(f.client.getSnapshot().lobby).toBeNull();
    f.socket.connect();
    await vi.waitFor(() =>
      expect(f.client.getSnapshot().lobby?.version).toBe(3),
    );
    expect(
      f.socket.request.mock.calls.filter(
        ([event]) => event === "session:current",
      ),
    ).toHaveLength(2);
    f.client.dispose();
  });
  it("collects every bounded directory page using the server cursors", async () => {
    const f = await fixture(),
      original = f.socket.request.getMockImplementation()!;
    f.socket.request.mockImplementation(async (event, body) =>
      event === "lobby:list"
        ? (body as { afterLobbyId?: string }).afterLobbyId
          ? {
              status: "listed",
              lobbies: [lobby(2, "lobby-b")],
              nextAfterLobbyId: null,
            }
          : {
              status: "listed",
              lobbies: [lobby(1)],
              nextAfterLobbyId: "lobby-a",
            }
        : original(event, body),
    );
    await f.client.refresh();
    expect(f.client.getSnapshot().lobbies.map((l) => l.lobbyId)).toEqual([
      "lobby-a",
      "lobby-b",
    ]);
    expect(f.socket.request).toHaveBeenCalledWith("lobby:list", {
      limit: 50,
      afterLobbyId: "lobby-a",
    });
    f.client.dispose();
  });
  it("does not retry a timed-out mutation and shows no raw server error or candidate state", async () => {
    const f = await fixture();
    f.socket.request.mockRejectedValueOnce(Error("SQL SECRET"));
    await f.client.run(() => f.client.create(2));
    expect(f.client.getSnapshot().error).toBe(errorMessage("TIMEOUT"));
    expect(f.client.getSnapshot().lobby).toBeNull();
    expect(
      f.socket.request.mock.calls.filter(([event]) => event === "lobby:create"),
    ).toHaveLength(1);
    f.client.dispose();
  });
  it("reports a rejected write without accepting its candidate view", async () => {
    const f = await fixture();
    f.socket.request.mockResolvedValueOnce({
      status: "unavailable",
      error: { code: "STALE_VERSION", detail: "DO_NOT_LEAK" },
      view: lobby(90),
    });
    await f.client.run(() => f.client.create(2));
    expect(f.client.getSnapshot().lobby).toBeNull();
    expect(f.client.getSnapshot().error).toBe(errorMessage("STALE_VERSION"));
    f.client.dispose();
  });
  it("removes credentials on explicit logout even when the acknowledgement is lost", async () => {
    const f = await fixture();
    f.socket.request.mockRejectedValueOnce(Error("timeout"));
    await expect(f.client.logout()).rejects.toThrow("TIMEOUT");
    expect(f.values.size).toBe(0);
    expect(f.client.getSnapshot().userId).toBeNull();
    f.client.dispose();
  });
});
