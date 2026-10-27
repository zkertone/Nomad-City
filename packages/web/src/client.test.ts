import { describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import type { GamePlayerView } from "@nomad-city-online/game-core";
import type { LobbyView } from "@nomad-city-online/server";
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
      if (event === "room:entry-options")
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
