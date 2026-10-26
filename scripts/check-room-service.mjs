import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import * as core from '@nomad-city-online/game-core';
import { migrateRoomStore, PostgresRoomStore, RoomService, RoomModule, parseRoomSnapshot,
  migrateSessionStore, SessionService, RoomGateway, createRoomSocketApplication } from '@nomad-city-online/server';

const realPostgres = process.argv.includes('--postgres');
const socketMode = process.argv.includes('--sockets');
const socketOrigin = 'https://nomad-test.example', socketClients = new Set(), issuedTokens = [];
let socketPushes = 0;
if (realPostgres && !process.env.NCO_TEST_DATABASE_URL) throw new Error('--postgres requires NCO_TEST_DATABASE_URL for a dedicated integration database');
const directory = realPostgres ? null : await mkdtemp(join(tmpdir(), 'nco-room-check-'));
const createdRoomIds = [];
let connection, app;
async function application() {
  if (!socketMode) return NestFactory.createApplicationContext(RoomModule.register(connection.sql), { logger: false });
  const result = await createRoomSocketApplication({ sql: connection.sql, allowedOrigins: [socketOrigin] });
  await result.listen(0, '127.0.0.1'); return result;
}
async function connectMember(token, roomId, playerId) {
  const socket = io(`${await app.getUrl()}/game`, { autoConnect: false, forceNew: true, reconnection: false, timeout: 5000,
    transports: ['websocket'], extraHeaders: { Origin: socketOrigin }, auth: { protocolVersion: '1.0.0', sessionToken: token } });
  socketClients.add(socket);
  let lastVersion = -1;
  socket.on('room:state', event => {
    assert.equal(event.protocolVersion, '1.0.0'); assert.equal(event.roomId, roomId);
    assert.equal(event.view.private.playerId, playerId); assert.ok(event.view.public.stateVersion > lastVersion);
    lastVersion = event.view.public.stateVersion; socketPushes++;
    assert.equal(Object.hasOwn(event.view.public.facilities?.supply ?? {}, 'drawPile'), false);
  });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', () => reject(Error('Socket authentication failed'))); socket.connect(); });
  return socket;
}
const rpc = (socket, name, body) => socket.timeout(5000).emitWithAck(name, body);
async function open() {
  if (realPostgres) {
    const pool = new Pool({ connectionString: process.env.NCO_TEST_DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
    return { sql: pool, close: () => pool.end() };
  }
  const db = new PGlite(join(directory, 'data'));
  return { sql: { query: async (text, values) => { const result = await db.query(text, values); return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }; } }, close: () => db.close() };
}
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
let committedRequests = 0, trustedCommits = 0, viewChecks = 0;
const summaries = [];
try {
  connection = await open(); await migrateRoomStore(connection.sql);
  if (socketMode) await migrateSessionStore(connection.sql);
  const sqlVersion = (await connection.sql.query('SELECT version() AS version')).rows[0].version;
  app = await application();
  let store = new PostgresRoomStore(connection.sql);
  for (const count of [2, 3, 4]) {
    const roomId = `room-${count}-${randomUUID()}`, g = core.createPreEntryGame(`game-${randomUUID()}`, seats.slice(0, count));
    const members = seats.slice(0, count).map((player, index) => ({ playerId: player.id, userId: `account-${count - index}` }));
    assert.equal(await store.create(parseRoomSnapshot({ roomId, definition: g.definition, state: g.state, members })), true);
    createdRoomIds.push(roomId);
    let state = g.state, service = app.get(RoomService), majorActions = 0;
    const memberSockets = new Map(), credentials = new Map();
    if (socketMode) for (const member of members) {
      const session = await app.get(SessionService).issue(member.userId); issuedTokens.push(session.token); credentials.set(member.playerId, session.token);
      memberSockets.set(member.playerId, await connectMember(session.token, roomId, member.playerId));
    }
    const principalFor = playerId => ({ authenticatedUserId: members.find(m => m.playerId === playerId).userId });
    async function send(channel, command, playerId = core.getRoundTurn(state, g.definition).actorId) {
      const payload = { apiVersion: '1.0.0', requestId: `request-${committedRequests}`, channel, command: { gameId: state.gameId, expectedVersion: state.stateVersion, ...command } };
      const result = socketMode ? await rpc(memberSockets.get(playerId), 'room:command', { roomId, request: payload })
        : await service.submit(roomId, principalFor(playerId), payload);
      assert.equal(result.status, 'committed', JSON.stringify(result));
      committedRequests++;
      const stored = await store.read(roomId); state = stored.state;
      assert.equal(result.reply.stateVersion, state.stateVersion);
      assert.deepEqual(result.view, core.getGamePlayerView(state, g.definition, { authenticatedPlayerId: playerId }));
      assert.equal(Object.hasOwn(result, 'state'), false);
      if (command.type === 'choose-major-action') majorActions++;
      return payload;
    }
    async function trusted(transform) {
      const expected = state.stateVersion;
      const runner = socketMode ? app.get(RoomGateway) : service;
      assert.deepEqual(await runner.commitTrustedTransition(roomId, expected, row => transform(row.state)), { status: 'committed', stateVersion: expected + 1 });
      trustedCommits++; state = (await store.read(roomId)).state;
    }
    async function views() {
      for (const member of members) {
        const result = await new RoomService(new PostgresRoomStore(connection.sql)).readView(roomId, { authenticatedUserId: member.userId });
        assert.equal(result.status, 'ready');
        assert.deepEqual(result.view, core.getGamePlayerView(state, g.definition, { authenticatedPlayerId: member.playerId }));
        assert.equal(Object.hasOwn(result.view.public.facilities?.supply ?? {}, 'drawPile'), false);
        if (socketMode) {
          const wire = await rpc(memberSockets.get(member.playerId), 'room:subscribe', { roomId });
          assert.equal(wire.status, 'ready'); assert.deepEqual(wire.view, result.view);
        }
        viewChecks++;
      }
    }
    const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
    await trusted(s => core.beginEntry(s, g.definition, { expectedVersion: s.stateVersion, startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(p => p.id), greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] }));
    for (let i = 0; i < count; i++) {
      await send('entry', { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] }, seats[i].id);
      await send('entry', { type: 'choose-green-event', choiceId: `${state.entry.pendingEvent.cardId}:1` }, seats[i].id);
    }
    if (count === 2) await send('entry', { type: 'choose-entry-influence', slotId: null }, 'p2');
    await trusted(s => core.beginRoundFlow(s, g.definition, { expectedVersion: s.stateVersion, facilityDeckOrder: core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id), deckOrder: { yellow: ids('yellow'), red: ids('red') } }));
    for (const upgrade of [core.enableBaseRoleEffects, core.enableLiskarmEffects, core.enableRemainingBaseRoleEffects, core.enableWarehouseEntries, core.enableNestedFacilityEntries]) await trusted(s => upgrade(s, g.definition, { expectedVersion: s.stateVersion }));
    await trusted(s => core.enableCityPatterns(s, g.definition, { expectedVersion: s.stateVersion, gameplayVersion: 'base', patternOrder: core.getEligibleCityPatterns('base', count).map(p => p.id) }));
    for (const upgrade of [core.enableCityPatternContinuations, core.enableCityPatternMajorActions]) await trusted(s => upgrade(s, g.definition, { expectedVersion: s.stateVersion }));
    await trusted(s => core.enableTemporarySettlements(s, g.definition, { expectedVersion: s.stateVersion, deckOrder: core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id) }));
    for (let round = 1; round <= 8; round++) {
      while (state.roundFlow.stage === 'role-removal') await send('round', { type: 'remove-round-supply-card', cardId: state.facilities.supply.supply[0] });
      while (state.roundFlow.stage === 'role-placement') await send('round', { type: 'place-round-role', roleId: 'ROLE-02' });
      await views();
      while (state.roundFlow.stage === 'player-actions') {
        const actor = core.getRoundTurn(state, g.definition).actorId;
        await send('round', { type: 'choose-major-action', action: 'dispatch' });
        if (state.influenceAction.status === 'ready') await send('influence', { type: 'finish-dispatch' }, actor);
        await send('round', { type: 'finish-player-turn' });
      }
      await trusted(s => core.openHarvestPhase(s, g.definition, { expectedVersion: s.stateVersion, roundNumber: round }));
      for (const player of g.definition.players) await send('harvest', { type: 'set-harvest-plan', plan: { nodeIds: [state.board.cityNodeByPlayer[player.id]], routeIds: [] } }, player.id);
      await trusted(s => core.finishManagedRound(s, g.definition, { expectedVersion: s.stateVersion }));
      // Provider recreation never resets a round, hand or durable game version.
      service = new RoomService(new PostgresRoomStore(connection.sql));
    }
    await trusted(s => core.finalizeBaseGame(s, g.definition, { expectedVersion: s.stateVersion }));
    await views();
    assert.equal(majorActions, count * 16); assert.equal(state.schemaVersion, '1.17.0');
    assert.equal(Object.keys(core.getMarkerLedger(state, g.definition)).length, count * 30);
    const finalResult = core.getFinalScoringResult(state, g.definition);
    const afterGame = { apiVersion: '1.0.0', requestId: 'after-game', channel: 'round', command: { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-major-action', action: 'dispatch' } };
    const rejected = socketMode ? await rpc(memberSockets.get('p1'), 'room:command', { roomId, request: afterGame }) : await service.submit(roomId, principalFor('p1'), afterGame);
    assert.deepEqual(rejected, { status: 'rejected', reply: { apiVersion: '1.0.0', requestId: 'after-game', ok: false, error: { code: 'GAME_FINISHED' } } });
    summaries.push({ roomId, principal: principalFor('p1'), token: credentials.get('p1'), finalResult, version: state.stateVersion, players: count, majorActions });
  }
  for (const socket of socketClients) socket.disconnect(); socketClients.clear();
  await app.close(); app = null;
  const previous = connection; connection = null; await previous.close(); connection = await open();
  if (socketMode) app = await application();
  store = new PostgresRoomStore(connection.sql);
  for (const saved of summaries) {
    const result = await new RoomService(store).readView(saved.roomId, saved.principal);
    assert.equal(result.status, 'ready'); assert.equal(result.view.public.stateVersion, saved.version);
    assert.deepEqual(result.view.public.finalResult, saved.finalResult);
    if (socketMode) {
      const socket = await connectMember(saved.token, saved.roomId, 'p1');
      const resumed = await rpc(socket, 'room:subscribe', { roomId: saved.roomId });
      assert.equal(resumed.status, 'ready'); assert.deepEqual(resumed.view, result.view);
    }
    console.log(JSON.stringify({ players: saved.players, completedRounds: 8, majorActions: saved.majorActions, finalFormat: '1.17.0', databaseReopened: true, noInjectedState: true }));
  }
  console.log(JSON.stringify({ check: 'PASS', engine: realPostgres ? 'PostgreSQL server via pg.Pool' : 'PGlite WASM PostgreSQL (test only)', sqlVersion, committedRequests, trustedCommits, viewChecks, games: 3,
    reopenedDatabase: true, realPostgresNetworkChecked: realPostgres, socketIoLoopbackChecked: socketMode, socketPushes, persistedSessionReconnectChecked: socketMode }));
} finally {
  for (const socket of socketClients) socket.disconnect(); socketClients.clear();
  if (app) await app.close();
  if (connection) {
    if (realPostgres) {
      for (const roomId of createdRoomIds) await connection.sql.query('DELETE FROM nco_rooms WHERE room_id = $1', [roomId]);
      for (const token of issuedTokens) await new SessionService(connection.sql).revoke(token);
    }
    await connection.close();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}
