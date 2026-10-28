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
  roundSetupWrites = 0,
  majorActionWrites = 0,
  deployments = 0,
  dispatchMoves = 0;
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
  assert.equal(catalog.facilities.cards.length, 51); assert.equal(catalog.facilities.cells.length, 12);
  assert.doesNotMatch(JSON.stringify(catalog.facilities), /drawPile|members|placedRoleId/);
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
      let acting, options, eligible = 0;
      for (const [i, socket] of sockets.entries()) {
        const current = await rpc(socket, "room:round-setup-options", {
          roomId: id,
        });
        assert.equal(current.status, "ready");
        assert.equal(current.blockedReason, null);
        assert.equal(current.stateVersion, view.public.stateVersion);
        if (current.options) {
          eligible++;
          if (current.options.stage === "role-removal") assert.equal(acting, undefined);
          acting = i;
          options = current;
        }
      }
      assert.notEqual(acting, undefined);
      const choice = options.options;
      assert.equal(eligible, choice.stage === "role-placement" ? count - placed : 1);
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
    assert.equal(removed, count === 2 ? 2 : count === 3 ? 1 : 0);
    assert.equal(placed, count);
    assert.equal(view.public.round.stage, "player-actions");
    assert.equal(
      (await rpc(sockets[0], "room:round-setup-options", { roomId: id }))
        .options,
      null,
    );
    const actionRead = async (socket) => {
      const options = await rpc(socket, "room:action-options", { roomId: id });
      assert.equal(options.status, "ready");
      assert.equal(options.blockedReason, null);
      assert.equal(options.stateVersion, view.public.stateVersion);
      return options;
    };
    const actionSend = async (socket, channel, command) => {
      const before = view.public.stateVersion;
      const committed = await rpc(socket, "room:command", { roomId: id, request: {
        apiVersion: "1.0.0", requestId: randomUUID(), channel,
        command: { gameId: view.public.gameId, expectedVersion: before, ...command },
      } });
      assert.equal(committed.status, "committed");
      assert.equal(committed.view.public.stateVersion, before + 1);
      view = committed.view; majorActionWrites++;
    };
    for (const [i, socket] of sockets.entries()) {
      const ownOptions = await actionRead(socket);
      assert.equal(ownOptions.options.actorId, `p${i + 1}`);
      for (const other of sockets.filter(s => s !== socket))
        assert.equal((await actionRead(other)).options, null);
      await actionSend(socket, "round", { type: "choose-major-action", action: "deploy" });
      if (i === 0) {
        assert.equal((await actionRead(socket)).options.cancelPreparation.legal, true);
        await actionSend(socket, "round", { type: "cancel-major-preparation" });
        await actionSend(socket, "round", { type: "choose-major-action", action: "deploy" });
      }
      const target = (await actionRead(socket)).options.influence.deploymentSlotIds[0];
      assert.ok(target);
      const before = await new PostgresRoomStore(local.sql).read(id),
        playerId = `p${i + 1}`, marker = before.state.markerSupplyByPlayer[playerId][0];
      await actionSend(socket, "influence", { type: "deploy-influence", slotId: target });
      deployments++;
      const after = await new PostgresRoomStore(local.sql).read(id);
      assert.deepEqual(after.state.board.influenceBySlot[target], { ownerPlayerId: playerId, markerId: marker });
      assert.equal(after.state.markerSupplyByPlayer[playerId].length, before.state.markerSupplyByPlayer[playerId].length - 1);
      assert.equal((await actionRead(socket)).options.finishTurn.legal, true);
      assert.equal(view.public.round.actorId, playerId);
      await actionSend(socket, "round", { type: "finish-player-turn" });
    }
    assert.equal(view.public.round.cycle, 2);
    await actionSend(sockets[0], "round", { type: "choose-major-action", action: "dispatch" });
    const pair = (await actionRead(sockets[0])).options.influence.dispatches[0];
    const beforeDispatch = await new PostgresRoomStore(local.sql).read(id),
      marker = beforeDispatch.state.board.influenceBySlot[pair.sourceSlotId];
    const destination = pair.targetSlotIds[0];
    await actionSend(sockets[0], "influence", {
      type: "dispatch-influence", sourceSlotId: pair.sourceSlotId, targetSlotId: destination,
    });
    dispatchMoves++;
    const afterDispatch = await new PostgresRoomStore(local.sql).read(id);
    assert.equal(afterDispatch.state.board.influenceBySlot[pair.sourceSlotId], null);
    assert.deepEqual(afterDispatch.state.board.influenceBySlot[destination], marker);
    assert.deepEqual(afterDispatch.state.markerSupplyByPlayer, beforeDispatch.state.markerSupplyByPlayer);
    const pendingOptions = await actionRead(sockets[0]);
    assert.equal(pendingOptions.options.influence.operationsCompleted, 1);
    assert.equal(pendingOptions.options.cancelPreparation.legal, false);
    assert.equal(pendingOptions.options.finishTurn.legal, false);
    const own = (await rpc(sockets[0], "room:subscribe", { roomId: id })).view;
    saved.push({ id, view: own, options: pendingOptions, marker, destination, count });
    for (const socket of sockets) socket.disconnect();
  }
  assert.equal(entryWrites, 19);
  assert.equal(autoWrites, 30);
  assert.equal(roundSetupWrites, 12);
  for (const peer of peers) peer.disconnect();
  peers.clear();
  await local.close();
  local = null;
  await open();
  const restored = await connect(tokens[0]);
  for (const s of saved) {
    assert.deepEqual((await rpc(restored, "room:subscribe", { roomId: s.id })).view, s.view);
    const options = await rpc(restored, "room:action-options", { roomId: s.id });
    assert.deepEqual(options, s.options);
    const before = await new PostgresRoomStore(local.sql).read(s.id);
    assert.deepEqual(before.state.board.influenceBySlot[s.destination], s.marker);
    const second = options.options.influence.dispatches.find(p => p.sourceSlotId === s.destination);
    assert.ok(second);
    const command = s.count === 2 ? { type: "finish-dispatch" }
      : { type: "dispatch-influence", sourceSlotId: second.sourceSlotId, targetSlotId: second.targetSlotIds[0] };
    let result = await rpc(restored, "room:command", { roomId: s.id, request: {
      apiVersion: "1.0.0", requestId: randomUUID(), channel: "influence",
      command: { gameId: options.gameId, expectedVersion: options.stateVersion, ...command },
    } });
    assert.equal(result.status, "committed"); majorActionWrites++;
    if (s.count !== 2) dispatchMoves++;
    const after = await new PostgresRoomStore(local.sql).read(s.id);
    assert.deepEqual(after.state.markerSupplyByPlayer, before.state.markerSupplyByPlayer);
    if (s.count !== 2) assert.deepEqual(after.state.board.influenceBySlot[second.targetSlotIds[0]], s.marker);
    assert.equal((await rpc(restored, "room:action-options", { roomId: s.id })).options.finishTurn.legal, true);
    result = await rpc(restored, "room:command", { roomId: s.id, request: {
      apiVersion: "1.0.0", requestId: randomUUID(), channel: "round",
      command: { gameId: options.gameId, expectedVersion: result.view.public.stateVersion, type: "finish-player-turn" },
    } });
    assert.equal(result.status, "committed"); majorActionWrites++;
    assert.equal(result.view.public.round.actorId, "p2");
  }
  assert.equal(majorActionWrites, 45);
  assert.equal(deployments, 9);
  assert.equal(dispatchMoves, 5);
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
      majorActionWrites, deployments, dispatchMoves,
      firstCycleAndRecoveredDispatch: true,
      persistedSessionAndActionRecovery: true,
      browserBundleHasNoServerRuntime: true,
      database: "PGlite test only",
    }),
  );
} finally {
  for (const peer of peers) peer.disconnect();
  if (local) await local.close();
  await rm(directory, { recursive: true, force: true });
}
