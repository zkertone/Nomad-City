import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import * as core from '@nomad-city-online/game-core';
import { createAutomaticBaseRoomSnapshot, PostgresRoomStore, SessionService } from '@nomad-city-online/server';
import { createLocalApplication } from './local-app.mjs';

const directory = await mkdtemp(join(tmpdir(), 'nco-quick-web-')), origin = 'http://nomad.local';
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const games = [], peers = new Set(); let local, base, playerWrites = 0, automaticWrites = 0, restarts = 0, roleUses = 0;
let declarations = 0, specials = 0, constructions = 0, deniedPreviews = 0;
const rpc = (socket, event, body) => socket.timeout(5000).emitWithAck(event, body);
async function open() { local = await createLocalApplication({ dataDirectory: join(directory, 'data'), origin, port: 0 }); await local.app.listen(0, '127.0.0.1'); base = await local.app.getUrl(); }
async function connect(token) {
  const socket = io(`${base}/game`, { autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'], extraHeaders: { Origin: origin }, auth: { protocolVersion: '1.0.0', sessionToken: token } });
  peers.add(socket); await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', () => reject(Error('Quick flow connection failed'))); socket.connect(); }); return socket;
}
async function send(game, actorId, channel, command) {
  const previous = game.view.public.stateVersion;
  const reply = await rpc(game.sockets.get(actorId), 'room:command', { roomId: game.id, request: { apiVersion: '1.0.0', requestId: randomUUID(), channel,
    command: { gameId: game.view.public.gameId, expectedVersion: previous, ...command } } });
  assert.equal(reply.status, 'committed'); playerWrites++; automaticWrites += reply.view.public.stateVersion - previous - 1; game.view = reply.view;
}
async function options(game, actor = game.view.public.round.actorId) {
  const result = await rpc(game.sockets.get(actor), 'room:action-options', { roomId: game.id });
  assert.equal(result.status, 'ready'); assert.equal(result.stateVersion, game.view.public.stateVersion);
  for (const [id, peer] of game.sockets) if (id !== actor) assert.equal((await rpc(peer, 'room:action-options', { roomId: game.id })).options, null);
  return result.options;
}
async function preview(game, channel, command, expected = true, actor = game.view.public.round.actorId) {
  const store = new PostgresRoomStore(local.sql), before = await store.read(game.id);
  const result = await rpc(game.sockets.get(actor), 'room:quick-preview', { roomId: game.id, channel, command: { gameId: game.view.public.gameId, expectedVersion: game.view.public.stateVersion, ...command } });
  assert.equal(result.status, 'ready'); assert.equal(result.options.execution.legal, expected); assert.deepEqual(await store.read(game.id), before);
  assert.doesNotMatch(JSON.stringify(result), /drawPile|DeckOrder|members|placedRoleId/);
  if (!expected) deniedPreviews++;
  return result;
}
async function restart() {
  const saved = [];
  for (const game of games) {
    const views = new Map(); for (const [id, peer] of game.sockets) views.set(id, (await rpc(peer, 'room:subscribe', { roomId: game.id })).view);
    saved.push({ game, views, choices: await options(game) });
  }
  for (const peer of peers) peer.disconnect(); peers.clear(); await local.close(); local = null; await open(); restarts++;
  for (const { game, views, choices } of saved) {
    game.sockets = new Map();
    for (const [id, token] of game.tokens) {
      const socket = await connect(token); game.sockets.set(id, socket);
      const own = (await rpc(socket, 'room:subscribe', { roomId: game.id })).view; assert.deepEqual(own, views.get(id)); assert.equal(own.private.playerId, id);
      for (const player of own.public.players) assert.equal(Object.hasOwn(player.roles, 'placedRoleId'), false);
    }
    game.view = views.get('p1'); assert.deepEqual(await options(game), choices);
    const snapshot = await new PostgresRoomStore(local.sql).read(game.id);
    assert.equal(Object.keys(core.getMarkerLedger(snapshot.state, snapshot.definition)).length, game.count * 30);
  }
}
try {
  await open();
  for (const count of [2, 3, 4]) {
    const id = `quick-${randomUUID()}`, players = seats.slice(0, count), members = players.map(p => ({ playerId: p.id, userId: `${id}-${p.id}` }));
    const events = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
    const ordinary = core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
    const targetId = ordinary.find(id => { const c = core.getFacilityPhysicalCard(id); return c.facilityId === 'FAC-010' && ['blue', 'yellow'].includes(c.color); }); assert.ok(targetId);
    const patternIds = core.getEligibleCityPatterns('base', count).map(p => p.id);
    const room = createAutomaticBaseRoomSnapshot({ roomId: id, gameId: `game-${id}`, players, members, startingPlayerId: 'p1', clockwisePlayerIds: players.map(p => p.id), setupOrders: {
      greenDeckOrder: ['G03', ...events('green').filter(id => id !== 'G03')], yellowDeckOrder: events('yellow'), redDeckOrder: events('red'),
      facilityDeckOrder: [targetId, ...ordinary.filter(id => id !== targetId)], patternOrder: ['PAT-005', ...patternIds.filter(id => id !== 'PAT-005')],
    } });
    assert.equal(await new PostgresRoomStore(local.sql).create(room), true);
    const game = { id, count, targetId, tokens: new Map(), sockets: new Map(), view: null }; games.push(game);
    for (const member of members) { const token = (await local.app.get(SessionService).issue(member.userId)).token; game.tokens.set(member.playerId, token); game.sockets.set(member.playerId, await connect(token)); }
    game.view = (await rpc(game.sockets.get('p1'), 'room:subscribe', { roomId: id })).view;
    for (const [index, player] of players.entries()) {
      await send(game, player.id, 'entry', { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
      const entry = await rpc(game.sockets.get(player.id), 'room:entry-options', { roomId: id });
      await send(game, player.id, 'entry', { type: 'choose-green-event', choiceId: entry.options.event.choices[0].id });
    }
    if (count === 2) await send(game, 'p2', 'entry', { type: 'choose-entry-influence', slotId: null });
    while (['role-removal', 'role-placement'].includes(game.view.public.round.stage)) {
      const actor = game.view.public.round.actorId, choice = (await rpc(game.sockets.get(actor), 'room:round-setup-options', { roomId: id })).options;
      await send(game, actor, 'round', choice.stage === 'role-removal' ? { type: 'remove-round-supply-card', cardId: choice.cards.find(c => c.legal && c.cardId !== targetId).cardId }
        : { type: 'place-round-role', roleId: actor === 'p1' ? 'ROLE-03' : 'ROLE-02' });
    }
    const cycle = { type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: game.view.public.facilities.supply.supply.find(id => id !== targetId) } };
    await preview(game, 'role', cycle); await send(game, 'p1', 'role', cycle); roleUses++;
    assert.equal(game.view.public.players[0].balances['columbia-voucher'], 22); assert.equal(game.view.public.round.majorActionStatus, 'not-started');
    await send(game, 'p1', 'round', { type: 'choose-major-action', action: 'construct' });
    await send(game, 'p1', 'construction', { type: 'construct-facility', cardId: targetId, cellId: 'CP-3-1', paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' } }); constructions++;
    assert.equal(game.view.public.construction.status, 'complete');
    const pattern = (await options(game)).quick.patterns.find(p => p.id === 'PAT-005'), match = pattern.matches[0]; assert.ok(match);
    const declaration = { type: 'declare-city-pattern', patternId: 'PAT-005', facilityCardIds: match.facilityCardIds };
    await preview(game, 'city-pattern', declaration); await send(game, 'p1', 'city-pattern', declaration); declarations++;
    assert.equal(game.view.public.round.majorActionStatus, 'complete'); assert.equal((await options(game)).finishTurn.legal, true);
    assert.equal((await options(game)).quick.patterns.find(p => p.id === 'PAT-005').matches.length, 0);
  }
  await restart(); // real declaration and exhausted facility layouts
  for (const game of games) {
    await send(game, 'p1', 'round', { type: 'finish-player-turn' });
    while (game.view.public.round.actorId !== 'p1') {
      const actor = game.view.public.round.actorId;
      await send(game, actor, 'round', { type: 'choose-major-action', action: 'dispatch' });
      if (game.view.public.influenceAction.status === 'ready') await send(game, actor, 'influence', { type: 'finish-dispatch' });
      await send(game, actor, 'round', { type: 'finish-player-turn' });
    }
    const pattern = (await options(game)).quick.patterns.find(p => p.id === 'PAT-005'); assert.ok(pattern.special);
    const command = { type: 'use-pattern-special', patternId: 'PAT-005', markerId: pattern.special.markerIds[0], effect: { kind: 'military', slotIds: ['route:F-route-01:slot:1'] } };
    await preview(game, 'city-pattern', command); await send(game, 'p1', 'city-pattern', command); specials++;
    assert.equal(game.view.public.board.influenceBySlot['route:F-route-01:slot:1'].ownerPlayerId, 'p1');
    assert.equal((await options(game)).finishTurn.legal, true); await preview(game, 'city-pattern', command, false);
  }
  await restart(); // consumed special charges and public influence
  for (const game of games) {
    await send(game, 'p1', 'round', { type: 'finish-player-turn' });
    const role = (await options(game)).quick.role; assert.equal(role.roleId, 'ROLE-02');
    const both = { type: 'use-base-role', roleId: 'ROLE-02', mode: 'both', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' }, schemeChoice: { kind: 'elysium-city-move', costDecision: 'decline' } };
    const rejected = await preview(game, 'role', both, false); assert.equal(rejected.options.execution.blockedBy, 'STARTING_PLAYER_ONLY');
    const strategy = { type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'orirock' } };
    await preview(game, 'role', strategy); await send(game, 'p2', 'role', strategy); roleUses++;
    assert.equal(game.view.public.round.majorActionStatus, 'not-started'); assert.equal((await options(game)).quick.role, null);
  }
  await restart(); // per-recipient role use/discards with the major action still available
  assert.equal(playerWrites, 67); assert.equal(automaticWrites, 30); assert.equal(declarations, 3); assert.equal(specials, 3); assert.equal(roleUses, 6); assert.equal(constructions, 3); assert.equal(deniedPreviews, 6); assert.equal(restarts, 3);
  console.log(JSON.stringify({ check: 'PASS', games: 3, playerWrites, automaticWrites, constructions, roleUses, declarations, specials, deniedPreviews, restarts,
    restoredGames: 9, restoredIndividualViews: 27, actualConstructionAndIncome: true, trustedDeterministicSetup: true, database: 'PGlite test only' }));
} finally { for (const peer of peers) peer.disconnect(); if (local) await local.close(); await rm(directory, { recursive: true, force: true }); }
