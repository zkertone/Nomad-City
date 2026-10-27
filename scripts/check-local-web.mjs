import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { createLocalApplication } from "./local-app.mjs";
import {
  createRoomSocketApplication,
  PostgresRoomStore,
} from "@nomad-city-online/server";

const directory = await mkdtemp(join(tmpdir(), "nco-local-web-")),
  origin = "http://nomad.local",
  peers = new Set();
let local,
  base,
  entryWrites = 0,
  autoWrites = 0,
  roundSetupWrites = 0;
const saved = [];
const headers = {
  Host: "nomad.local",
  Origin: origin,
  "Content-Type": "application/json",
};
async function open() {
  local = await createLocalApplication({
    dataDirectory: join(directory, "data"),
    origin,
    port: 0,
  });
  await local.app.listen(0, "127.0.0.1");
  base = await local.app.getUrl();
}
async function connect(token) {
  const socket = io(`${base}/game`, {
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
    forceNew: true,
    extraHeaders: { Origin: origin },
    auth: { protocolVersion: "1.0.0", sessionToken: token },
  });
  peers.add(socket);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", () =>
      reject(Error("Local connection failed")),
    );
    socket.connect();
  });
  return socket;
}
const rpc = (socket, event, body) =>
  socket.timeout(5000).emitWithAck(event, body);
try {
  await open();
  const page = await fetch(base, { headers });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Nomad City Online/);
  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(
    (m) => m[1],
  );
  assert.equal(paths.length, 2);
  for (const path of paths) {
    const response = await fetch(`${base}${path}`, { headers });
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /node:crypto|@nestjs|PGlite/);
  }
  assert.equal((await fetch(`${base}/package.json`, { headers })).status, 404);
  assert.equal(
    (await fetch(`${base}/__local/session`, { headers })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/__local/session`, {
        method: "POST",
        headers: { ...headers, Origin: "https://outside.example" },
        body: JSON.stringify({ fixtureId: 1 }),
      })
    ).status,
    403,
  );
  for (const body of [
    { fixtureId: 0 },
    { fixtureId: 5 },
    { fixtureId: 1, userId: "forged" },
    null,
  ])
    assert.equal(
      (
        await fetch(`${base}/__local/session`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      ).status,
      400,
    );
  const tokens = [];
  for (let fixtureId = 1; fixtureId <= 4; fixtureId++) {
    const response = await fetch(`${base}/__local/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fixtureId }),
    });
    assert.equal(response.status, 200);
    tokens.push((await response.json()).token);
  }
  const catalog = await (
    await fetch(`${base}/__local/catalog`, { headers })
  ).json();
  assert.equal(Object.keys(catalog.three.resourceNodes).length, 18);
  assert.equal(Object.keys(catalog.four.resourceNodes).length, 22);
  const ordinary = await createRoomSocketApplication({
    sql: local.sql,
    allowedOrigins: [origin],
  });
  await ordinary.listen(0, "127.0.0.1");
  try {
    assert.equal(
      (await fetch(`${await ordinary.getUrl()}/__local/session`)).status,
      404,
    );
  } finally {
    await ordinary.close();
  }
  for (const count of [2, 3, 4]) {
    const sockets = await Promise.all(tokens.slice(0, count).map(connect));
    let result = await rpc(sockets[0], "lobby:create", {
      requestId: randomUUID(),
      playerCount: count,
    });
    assert.equal(result.status, "created");
    const id = result.view.lobbyId,
      invitation = result.inviteToken;
    for (const socket of sockets.slice(1)) {
      result = await rpc(socket, "lobby:join", {
        lobbyId: id,
        inviteToken: invitation,
      });
      assert.equal(result.status, "joined");
    }
    result = await rpc(sockets[0], "lobby:command", {
      lobbyId: id,
      expectedVersion: result.view.version,
      type: "configure",
      startingPlayerId: "p1",
      clockwisePlayerIds: Array.from({ length: count }, (_, i) => `p${i + 1}`),
    });
    assert.equal(result.status, "updated");
    for (const socket of sockets) {
      result = await rpc(socket, "lobby:command", {
        lobbyId: id,
        expectedVersion: result.view.version,
        type: "set-ready",
        ready: true,
      });
      assert.equal(result.status, "updated");
    }
    result = await rpc(sockets[0], "lobby:command", {
      lobbyId: id,
      expectedVersion: result.view.version,
      type: "start",
    });
    assert.equal(result.status, "updated");
    let view = (await rpc(sockets[0], "room:subscribe", { roomId: id })).view;
    for (let guard = 0; view.public.entry && guard < 12; guard++) {
      let acting, options;
      for (const [i, socket] of sockets.entries()) {
        const available = await rpc(socket, "room:entry-options", {
          roomId: id,
        });
        assert.equal(available.status, "ready");
        if (available.options) {
          assert.equal(acting, undefined);
          acting = i;
          options = available;
        }
      }
      assert.notEqual(acting, undefined);
      const choice = options.options;
      const command =
        choice.status === "selecting-node"
          ? {
              type: "select-initial-node",
              nodeId: choice.nodeIds[0],
              ...(choice.nodeIds[0] === "B-01" ? { b01Bonus: "decline" } : {}),
            }
          : choice.event
            ? {
                type: "choose-green-event",
                choiceId: choice.event.choices[0].id,
              }
            : { type: "choose-entry-influence", slotId: null };
      const before = options.stateVersion;
      result = await rpc(sockets[acting], "room:command", {
        roomId: id,
        request: {
          apiVersion: "1.0.0",
          requestId: randomUUID(),
          channel: "entry",
          command: {
            gameId: options.gameId,
            expectedVersion: before,
            ...command,
          },
        },
      });
      assert.equal(result.status, "committed");
      view = result.view;
      entryWrites++;
      autoWrites += view.public.stateVersion - before - 1;
    }
    assert.equal(view.public.snapshotVersion, "1.16.0");
    assert.equal(view.public.round.roundNumber, 1);
    assert.equal(
      (await rpc(sockets[0], "room:entry-options", { roomId: id })).options,
      null,
    );
    let removed = 0,
      placed = 0;
    while (
      ["role-removal", "role-placement"].includes(view.public.round.stage)
    ) {
      let acting, options;
      for (const [i, socket] of sockets.entries()) {
        const current = await rpc(socket, "room:round-setup-options", {
          roomId: id,
        });
        assert.equal(current.status, "ready");
        assert.equal(current.blockedReason, null);
        assert.equal(current.stateVersion, view.public.stateVersion);
        if (current.options) {
          assert.equal(acting, undefined);
          acting = i;
          options = current;
        }
      }
      assert.notEqual(acting, undefined);
      const choice = options.options;
      const candidate =
        choice.stage === "role-removal"
          ? choice.cards.find((card) => card.legal)
          : choice.roles.find(
              (role) =>
                role.legal &&
                role.roleId === (acting === 0 ? "ROLE-03" : "ROLE-02"),
            );
      assert.ok(candidate);
      const command =
        choice.stage === "role-removal"
          ? { type: "remove-round-supply-card", cardId: candidate.cardId }
          : { type: "place-round-role", roleId: candidate.roleId };
      result = await rpc(sockets[acting], "room:command", {
        roomId: id,
        request: {
          apiVersion: "1.0.0",
          requestId: randomUUID(),
          channel: "round",
          command: {
            gameId: options.gameId,
            expectedVersion: options.stateVersion,
            ...command,
          },
        },
      });
      assert.equal(result.status, "committed");
      assert.equal(result.view.public.stateVersion, options.stateVersion + 1);
      view = result.view;
      roundSetupWrites++;
      if (choice.stage === "role-removal") {
        removed++;
        assert.equal(view.public.facilities.supply.supply.length, 6);
        assert.equal(
          view.public.facilities.supply.supply.includes(candidate.cardId),
          false,
        );
        assert.ok(
          view.public.facilities.supply.returnedToBox.includes(
            candidate.cardId,
          ),
        );
      } else {
        placed++;
        assert.equal(view.private.placedRoleId, candidate.roleId);
      }
      for (const player of view.public.players)
        assert.equal(Object.hasOwn(player.roles, "placedRoleId"), false);
    }
    assert.equal(removed, count === 2 ? 2 : 0);
    assert.equal(placed, count);
    assert.equal(view.public.round.stage, "player-actions");
    assert.equal(
      (await rpc(sockets[0], "room:round-setup-options", { roomId: id }))
        .options,
      null,
    );
    const own = (await rpc(sockets[0], "room:subscribe", { roomId: id })).view;
    saved.push({ id, view: own });
    for (const socket of sockets) socket.disconnect();
  }
  assert.equal(entryWrites, 19);
  assert.equal(autoWrites, 30);
  assert.equal(roundSetupWrites, 11);
  for (const peer of peers) peer.disconnect();
  peers.clear();
  await local.close();
  local = null;
  await open();
  const restored = await connect(tokens[0]);
  for (const s of saved)
    assert.deepEqual(
      (await rpc(restored, "room:subscribe", { roomId: s.id })).view,
      s.view,
    );
  assert.deepEqual(
    (await new PostgresRoomStore(local.sql).read(saved[0].id)).state
      .stateVersion,
    saved[0].view.public.stateVersion,
  );
  console.log(
    JSON.stringify({
      check: "PASS",
      staticAssets: paths.length,
      fixtureOriginAndIdentityGuards: true,
      productionHasNoFixtureRoute: true,
      games: 3,
      entryWrites,
      automaticStartupWrites: autoWrites,
      roundSetupWrites,
      preparationToFirstAction: true,
      persistedSessionAndEntryRecovery: true,
      browserBundleHasNoServerRuntime: true,
      database: "PGlite test only",
    }),
  );
} finally {
  for (const peer of peers) peer.disconnect();
  if (local) await local.close();
  await rm(directory, { recursive: true, force: true });
}
