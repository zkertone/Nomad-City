import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import * as core from '@nomad-city-online/game-core';
import { PostgresRoomStore, migrateRoomStore, migrateSessionStore, SessionService,
  createRoomSocketApplication, createAutomaticBaseRoomSnapshot } from '@nomad-city-online/server';

const native = process.argv.includes('--postgres');
const useLobbies = process.argv.includes('--lobbies');
if (native && !process.env.NCO_TEST_DATABASE_URL) throw Error('--postgres requires a dedicated NCO_TEST_DATABASE_URL');
const directory = native ? null : await mkdtemp(join(tmpdir(), 'nco-auto-check-'));
const roomIds = [], lobbyIds = [], tokens = [], sockets = new Set(), expectedRooms = new Map(), origin = 'https://automatic-test.example';
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
let connection, app, playerWrites = 0, automaticWrites = 0, pushes = 0, cleanupChoices = 0, entryChecks = 0;
let lobbyWrites = 0, lobbyPushes = 0, waitingRestarts = 0;
const finals = [];
async function open() {
  if (native) { const pool = new Pool({ connectionString: process.env.NCO_TEST_DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 }); return { sql: pool, close: () => pool.end() }; }
  const db = new PGlite(join(directory, 'data'));
  return { sql: { query: async (text, values) => { const r = await db.query(text, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } }, close: () => db.close() };
}
async function listen() { app = await createRoomSocketApplication({ sql: connection.sql, allowedOrigins: [origin] }); await app.listen(0, '127.0.0.1'); }
async function client(token, roomId, playerId) {
  const socket = io(`${await app.getUrl()}/game`, { autoConnect: false, forceNew: true, reconnection: false, timeout: 5000,
    transports: ['websocket'], extraHeaders: { Origin: origin }, auth: { protocolVersion: '1.0.0', sessionToken: token } });
  sockets.add(socket); expectedRooms.set(socket, roomId); let last = -1, lastLobby = -1;
  socket.on('room:state', event => {
    assert.equal(event.roomId, expectedRooms.get(socket)); assert.equal(event.view.private.playerId, playerId);
    assert.ok(event.view.public.stateVersion > last); last = event.view.public.stateVersion; pushes++;
    assert.equal(event.automatic.stateVersion, last);
    assert.equal(Object.hasOwn(event.view.public.facilities?.supply ?? {}, 'drawPile'), false);
    assert.equal(JSON.stringify(event).includes('facilityDeckOrder'), false);
  });
  socket.on('lobby:state', event => {
    assert.equal(event.lobbyId, expectedRooms.get(socket)); assert.equal(event.view.selfPlayerId, playerId);
    assert.ok(event.view.version > lastLobby); lastLobby = event.view.version; lobbyPushes++;
    assert.equal(/userId|ownerId|inviteToken|invite_hash|DeckOrder/.test(JSON.stringify(event)), false);
  });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', () => reject(Error('Connection refused'))); socket.connect(); });
  return socket;
}
const rpc = (socket, event, body) => socket.timeout(5000).emitWithAck(event, body);
try {
  connection = await open(); await migrateRoomStore(connection.sql); await migrateSessionStore(connection.sql); await listen();
  let store = new PostgresRoomStore(connection.sql);
  for (const count of [2, 3, 4]) {
    let id = `automatic-${randomUUID()}`;
    const players = seats.slice(0, count);
    const members = players.map((p, index) => ({ playerId: p.id, userId: `${id}-account-${count - index}` }));
    const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
    let room;
    const peers = new Map(), credentials = new Map();
    for (const member of members) {
      const issued = await app.get(SessionService).issue(member.userId); tokens.push(issued.token); credentials.set(member.playerId, issued.token);
      peers.set(member.playerId, await client(issued.token, id, member.playerId));
    }
    if (useLobbies) {
      let result = await rpc(peers.get('p1'), 'lobby:create', { requestId: `local-${randomUUID()}`, playerCount: count });
      assert.equal(result.status, 'created'); id = result.view.lobbyId; lobbyIds.push(id); roomIds.push(id); lobbyWrites++;
      const inviteToken = result.inviteToken;
      for (const peer of peers.values()) expectedRooms.set(peer, id);
      await rpc(peers.get('p1'), 'lobby:subscribe', { lobbyId: id });
      for (const p of players.slice(1)) {
        result = await rpc(peers.get(p.id), 'lobby:join', { lobbyId: id, inviteToken });
        assert.equal(result.status, 'joined'); lobbyWrites++;
        await rpc(peers.get(p.id), 'lobby:subscribe', { lobbyId: id });
      }
      result = await rpc(peers.get('p1'), 'lobby:command', { lobbyId: id, expectedVersion: result.view.version,
        type: 'configure', startingPlayerId: 'p1', clockwisePlayerIds: players.map(p => p.id) });
      assert.equal(result.status, 'updated'); lobbyWrites++;
      for (const p of players) {
        result = await rpc(peers.get(p.id), 'lobby:command', { lobbyId: id, expectedVersion: result.view.version, type: 'set-ready', ready: true });
        assert.equal(result.status, 'updated'); lobbyWrites++;
      }
      const waitingVersion = result.view.version, waitingViews = new Map();
      assert.equal(await store.read(id), null);
      for (const p of players) waitingViews.set(p.id, (await rpc(peers.get(p.id), 'lobby:subscribe', { lobbyId: id })).view);
      for (const s of sockets) s.disconnect(); sockets.clear(); expectedRooms.clear(); await app.close(); app = null;
      const waitingConnection = connection; connection = null; await waitingConnection.close(); connection = await open(); await listen(); store = new PostgresRoomStore(connection.sql); waitingRestarts++;
      for (const p of players) {
        const peer = await client(credentials.get(p.id), id, p.id); peers.set(p.id, peer);
        assert.deepEqual((await rpc(peer, 'lobby:subscribe', { lobbyId: id })).view, waitingViews.get(p.id));
      }
      result = await rpc(peers.get('p1'), 'lobby:command', { lobbyId: id, expectedVersion: waitingVersion, type: 'start' });
      assert.equal(result.status, 'updated'); assert.equal(result.view.status, 'started'); lobbyWrites++;
      const repeated = await rpc(peers.get('p1'), 'lobby:command', { lobbyId: id, expectedVersion: waitingVersion, type: 'start' });
      assert.equal(repeated.error.code, 'STALE_VERSION'); room = await store.read(id);
      assert.equal(room.state.stateVersion, 1);
    } else {
      room = createAutomaticBaseRoomSnapshot({ roomId: id, gameId: `game-${randomUUID()}`, players, members,
      startingPlayerId: 'p1', clockwisePlayerIds: players.map(p => p.id), setupOrders: {
        greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')],
        yellowDeckOrder: ids('yellow'), redDeckOrder: ids('red'),
        facilityDeckOrder: core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id),
        patternOrder: core.getEligibleCityPatterns('base', count).map(p => p.id),
      } });
      assert.equal(await store.create(room), true); roomIds.push(id);
    }
    let state = room.state, major = 0, gameAutomatic = 0;
    for (const member of members) {
      const peer = peers.get(member.playerId);
      const current = await rpc(peer, 'session:current', {});
      assert.equal(current.status, 'authenticated'); assert.equal(current.userId, member.userId);
      assert.equal(current.expiresAt, (await app.get(SessionService).resolve(credentials.get(member.playerId))).expiresAt);
      const listed = await rpc(peer, 'room:list', { limit: 50 });
      assert.equal(listed.status, 'listed');
      assert.deepEqual(listed.rooms.find(r => r.roomId === id), { roomId: id, gameId: room.state.gameId, playerId: member.playerId,
        playerCount: count, stateVersion: 1, phase: 'entry', roundNumber: null, scored: false });
      assert.equal(/facilityDeckOrder|drawPile|members|token_hash/.test(JSON.stringify(listed)), false); entryChecks++;
      const subscribed = await rpc(peers.get(member.playerId), 'room:subscribe', { roomId: id });
      assert.equal(subscribed.status, 'ready'); assert.equal(subscribed.automatic.status, 'waiting-for-player');
    }
    async function send(channel, command, playerId = core.getRoundTurn(state, room.definition).actorId) {
      const version = state.stateVersion;
      const request = { apiVersion: '1.0.0', requestId: `auto-request-${playerWrites}`, channel, command: { gameId: state.gameId, expectedVersion: version, ...command } };
      const result = await rpc(peers.get(playerId), 'room:command', { roomId: id, request });
      assert.equal(result.status, 'committed', JSON.stringify(result)); assert.equal(result.reply.stateVersion, version + 1);
      assert.ok(['waiting-for-player', 'finished'].includes(result.automatic.status));
      const row = await store.read(id); state = row.state;
      assert.deepEqual(row.lifecycle, room.lifecycle); assert.equal(result.automatic.stateVersion, state.stateVersion);
      assert.deepEqual(result.view, core.getGamePlayerView(state, room.definition, { authenticatedPlayerId: playerId }));
      const automatic = state.stateVersion - version - 1; automaticWrites += automatic; gameAutomatic += automatic; playerWrites++;
      if (command.type === 'choose-major-action') major++;
      return result;
    }
    for (let i = 0; i < count; i++) {
      await send('entry', { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] }, players[i].id);
      await send('entry', { type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` }, players[i].id);
    }
    if (count === 2) await send('entry', { type: 'choose-entry-influence', slotId: null }, 'p2');
    assert.equal(state.schemaVersion, '1.16.0'); assert.equal(gameAutomatic, 10);
    for (let round = 1; round <= 8; round++) {
      assert.equal(state.roundFlow.roundNumber, round);
      while (state.roundFlow.stage === 'role-removal') await send('round', { type: 'remove-round-supply-card', cardId: state.facilities.supply.supply[0] });
      while (state.roundFlow.stage === 'role-placement') {
        const actor = core.getRoundTurn(state, room.definition).actorId;
        await send('round', { type: 'place-round-role', roleId: round === 8 && actor === 'p1' ? 'ROLE-01' : 'ROLE-02' });
      }
      while (state.roundFlow.stage === 'player-actions') {
        const actor = core.getRoundTurn(state, room.definition).actorId;
        if (round === 8 && actor === 'p1' && !state.roundFlow.rolesByPlayer.find(p => p.playerId === 'p1').used) {
          await send('role', { type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: ['route:A-route-01:slot:1', 'route:B-route-02:slot:1'] } });
        }
        await send('round', { type: 'choose-major-action', action: 'dispatch' });
        if (state.influenceAction.status === 'ready') await send('influence', { type: 'finish-dispatch' });
        await send('round', { type: 'finish-player-turn' });
      }
      assert.equal(state.phase, 'harvest'); assert.equal(state.harvest.status, 'planning');
      for (const p of players) await send('harvest', { type: 'set-harvest-plan', plan: { nodeIds: [state.board.cityNodeByPlayer[p.id]], routeIds: [] } }, p.id);
      if (round < 8) { assert.equal(state.roundFlow.roundNumber, round + 1); continue; }
      assert.equal(state.roundFlow.stage, 'cleanup'); assert.equal(core.getRoundTurn(state, room.definition).actorId, 'p1');
      const before = core.getBaseScoringPreview(core.getGamePosition(state, room.definition), room.definition);
      const denied = await rpc(peers.get('p2'), 'room:command', { roomId: id, request: { apiVersion: '1.0.0', requestId: 'wrong-cleanup', channel: 'role-cleanup',
        command: { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'resolve-role-cleanup', slotId: 'route:A-route-01:slot:1' } } });
      assert.equal(denied.status, 'rejected'); assert.equal(denied.reply.error.ruleCode, 'WRONG_ACTOR');
      await send('role-cleanup', { type: 'resolve-role-cleanup', slotId: 'route:A-route-01:slot:1' }); cleanupChoices++;
      assert.equal(state.schemaVersion, '1.17.0');
      assert.equal(core.getFinalScoringResult(state, room.definition).players.p1.regionPoints, before.players.p1.regionPoints - 3);
    }
    assert.equal(major, count * 16); assert.equal(gameAutomatic, 35);
    assert.equal(Object.keys(core.getMarkerLedger(state, room.definition)).length, count * 30);
    assert.equal(core.validateFacilitySupplyState(state.facilities.supply).success, true);
    const view = await rpc(peers.get('p1'), 'room:subscribe', { roomId: id });
    assert.equal(view.automatic.status, 'finished'); assert.equal(view.view.public.stateVersion, state.stateVersion);
    finals.push({ roomId: id, token: credentials.get('p1'), view: view.view, count, major, version: state.stateVersion });
  }
  for (const s of sockets) s.disconnect(); sockets.clear(); await app.close(); app = null;
  const previous = connection; connection = null; await previous.close(); connection = await open(); await listen();
  store = new PostgresRoomStore(connection.sql);
  for (const saved of finals) {
    const peer = await client(saved.token, saved.roomId, 'p1');
    const restored = await rpc(peer, 'room:subscribe', { roomId: saved.roomId });
    assert.deepEqual(restored.view, saved.view); assert.equal(restored.automatic.status, 'finished');
    assert.equal((await store.read(saved.roomId)).state.stateVersion, saved.version);
    const listed = await rpc(peer, 'room:list', { limit: 50 });
    assert.equal(listed.status, 'listed');
    assert.deepEqual(listed.rooms.find(r => r.roomId === saved.roomId), { roomId: saved.roomId, gameId: restored.view.public.gameId, playerId: 'p1',
      playerCount: saved.count, stateVersion: saved.version, phase: 'round-control', roundNumber: 8, scored: true }); entryChecks++;
    assert.deepEqual(await rpc(peer, 'session:logout', {}), { status: 'logged-out', protocolVersion: '1.0.0' });
    assert.equal(await app.get(SessionService).resolve(saved.token), null);
    console.log(JSON.stringify({ players: saved.count, rounds: 8, majorActions: saved.major, automaticTransitions: 35, delayedCleanupChosenByPlayer: true, restoredWithoutRescoring: true, noInjectedState: true }));
  }
  for (const s of sockets) s.disconnect(); sockets.clear(); await app.close(); app = null;
  const beforeLogoutRestart = connection; connection = null; await beforeLogoutRestart.close(); connection = await open(); await listen();
  for (const saved of finals) {
    assert.equal(await app.get(SessionService).resolve(saved.token), null);
    await assert.rejects(() => client(saved.token, saved.roomId, 'p1'), /Connection refused/);
    const persisted = await new PostgresRoomStore(connection.sql).read(saved.roomId);
    assert.equal(persisted.state.stateVersion, saved.version); entryChecks++;
  }
  console.log(JSON.stringify({ check: 'PASS', games: 3, playerWrites, automaticWrites, cleanupChoices, pushes,
    manualStageCalls: 0, realSocketIo: true, persistedPlanAndSessionRecovery: true, entryChecks, logoutSurvivesRestart: true,
    viaLobbies: useLobbies, lobbyWrites, lobbyPushes, waitingRestarts,
    database: native ? 'PostgreSQL via pg.Pool' : 'PGlite test only', nativePostgresChecked: native }));
} finally {
  for (const s of sockets) s.disconnect(); if (app) await app.close();
  if (connection) {
    if (native) {
      for (const id of roomIds) await connection.sql.query('DELETE FROM nco_rooms WHERE room_id = $1', [id]);
      for (const id of lobbyIds) await connection.sql.query('DELETE FROM nco_lobbies WHERE lobby_id = $1', [id]);
      for (const token of tokens) await new SessionService(connection.sql).revoke(token);
    }
    await connection.close();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}
