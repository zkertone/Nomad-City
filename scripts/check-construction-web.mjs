import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import * as core from '@nomad-city-online/game-core';
import { createAutomaticBaseRoomSnapshot, PostgresRoomStore, SessionService } from '@nomad-city-online/server';
import { createLocalApplication } from './local-app.mjs';

const directory = await mkdtemp(join(tmpdir(), 'nco-construction-web-')), origin = 'http://nomad.local';
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const games = [], sockets = new Set();
let local, base, playerWrites = 0, automaticWrites = 0, constructions = 0, roleUses = 0, restarts = 0;
let events = 0, finalPlacements = 0, routePlacements = 0;
const rpc = (socket, event, body) => socket.timeout(5000).emitWithAck(event, body);
async function open() {
  local = await createLocalApplication({ dataDirectory: join(directory, 'data'), origin, port: 0 });
  await local.app.listen(0, '127.0.0.1'); base = await local.app.getUrl();
}
async function connect(token) {
  const socket = io(`${base}/game`, { autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
    extraHeaders: { Origin: origin }, auth: { protocolVersion: '1.0.0', sessionToken: token } });
  sockets.add(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', () => reject(Error('Construction connection failed'))); socket.connect(); });
  return socket;
}
async function send(game, actorId, channel, command) {
  const before = game.view.public.stateVersion;
  const result = await rpc(game.peers.get(actorId), 'room:command', { roomId: game.id, request: {
    apiVersion: '1.0.0', requestId: randomUUID(), channel,
    command: { gameId: game.view.public.gameId, expectedVersion: before, ...command },
  } });
  assert.equal(result.status, 'committed'); playerWrites++;
  automaticWrites += result.view.public.stateVersion - before - 1;
  game.view = result.view;
}
async function options(game) {
  const current = await rpc(game.peers.get('p1'), 'room:action-options', { roomId: game.id });
  assert.equal(current.status, 'ready'); assert.equal(current.stateVersion, game.view.public.stateVersion);
  for (const [id, peer] of game.peers) if (id !== 'p1') assert.equal((await rpc(peer, 'room:action-options', { roomId: game.id })).options, null);
  return current.options;
}
async function preview(game, channel, command) {
  const store = new PostgresRoomStore(local.sql), before = await store.read(game.id);
  const result = await rpc(game.peers.get('p1'), 'room:construction-preview', { roomId: game.id, channel,
    command: { gameId: game.view.public.gameId, expectedVersion: game.view.public.stateVersion, ...command } });
  assert.equal(result.status, 'ready'); assert.equal(result.options.execution.legal, true);
  assert.deepEqual(await store.read(game.id), before);
  assert.doesNotMatch(JSON.stringify(result), /drawPile|DeckOrder|members|markerId|refilledCardIds/);
  return result.options;
}
async function restart() {
  const saved = [];
  for (const game of games) {
    const views = new Map();
    for (const [id, peer] of game.peers) views.set(id, (await rpc(peer, 'room:subscribe', { roomId: game.id })).view);
    saved.push({ game, views, choices: await options(game) });
  }
  for (const socket of sockets) socket.disconnect(); sockets.clear();
  await local.close(); local = null; await open(); restarts++;
  for (const { game, views, choices } of saved) {
    game.peers = new Map();
    for (const [id, token] of game.tokens) {
      const socket = await connect(token); game.peers.set(id, socket);
      const actual = (await rpc(socket, 'room:subscribe', { roomId: game.id })).view;
      assert.deepEqual(actual, views.get(id)); assert.equal(actual.private.playerId, id);
      for (const player of actual.public.players) assert.equal(Object.hasOwn(player.roles, 'placedRoleId'), false);
    }
    game.view = views.get('p1'); assert.deepEqual(await options(game), choices);
    const snapshot = await new PostgresRoomStore(local.sql).read(game.id);
    assert.equal(Object.keys(core.getMarkerLedger(snapshot.state, snapshot.definition)).length, game.count * 30);
  }
}
try {
  await open();
  for (const facilityId of ['FAC-001', 'FAC-007']) for (const count of [2, 3, 4]) {
    const id = `construction-${randomUUID()}`, players = seats.slice(0, count), members = players.map(p => ({ playerId: p.id, userId: `${id}-${p.id}` }));
    const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
    const ordinary = core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
    const targetId = ordinary.find(id => core.getFacilityPhysicalCard(id).facilityId === facilityId);
    const room = createAutomaticBaseRoomSnapshot({ roomId: id, gameId: `game-${id}`, players, members, startingPlayerId: 'p1', clockwisePlayerIds: players.map(p => p.id), setupOrders: {
      greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')], yellowDeckOrder: ids('yellow'), redDeckOrder: ids('red'),
      facilityDeckOrder: [targetId, ...ordinary.filter(id => id !== targetId)], patternOrder: core.getEligibleCityPatterns('base', count).map(p => p.id),
    } });
    assert.equal(await new PostgresRoomStore(local.sql).create(room), true);
    const game = { id, count, facilityId, targetId, tokens: new Map(), peers: new Map(), view: null }; games.push(game);
    for (const member of members) {
      const token = (await local.app.get(SessionService).issue(member.userId)).token;
      game.tokens.set(member.playerId, token); game.peers.set(member.playerId, await connect(token));
    }
    game.view = (await rpc(game.peers.get('p1'), 'room:subscribe', { roomId: id })).view;
    for (const [index, player] of players.entries()) {
      await send(game, player.id, 'entry', { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] });
      const entry = await rpc(game.peers.get(player.id), 'room:entry-options', { roomId: id });
      await send(game, player.id, 'entry', { type: 'choose-green-event', choiceId: entry.options.event.choices[0].id });
    }
    if (count === 2) await send(game, 'p2', 'entry', { type: 'choose-entry-influence', slotId: null });
    while (['role-removal', 'role-placement'].includes(game.view.public.round.stage)) {
      const actorId = game.view.public.round.actorId;
      const setup = (await rpc(game.peers.get(actorId), 'room:round-setup-options', { roomId: id })).options;
      await send(game, actorId, 'round', setup.stage === 'role-removal'
        ? { type: 'remove-round-supply-card', cardId: setup.cards.find(c => c.legal && c.cardId !== targetId).cardId }
        : { type: 'place-round-role', roleId: actorId === 'p1' ? 'ROLE-03' : 'ROLE-02' });
    }
    // Real original Texas strategy funds the construction. No injected money or fabricated history.
    const filler = (await options(game)).construction?.supply?.find(c => c.cardId !== targetId)?.cardId
      ?? game.view.public.facilities.supply.supply.find(id => id !== targetId);
    await send(game, 'p1', 'role', { type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: filler } }); roleUses++;
    assert.equal(game.view.public.players[0].balances['columbia-voucher'], 22);
    await send(game, 'p1', 'round', { type: 'choose-major-action', action: 'construct' });
    const body = { type: 'construct-facility', cardId: targetId, cellId: 'CP-2-2', paymentMode: 'vouchers', entryChoice: { kind: 'deferred-entry' } };
    const quotation = await preview(game, 'construction', body);
    assert.deepEqual(quotation.quote.costs, [{ asset: 'columbia-voucher', amount: facilityId === 'FAC-001' ? 9 : 20 }]);
    const oldScore = game.view.public.players[0].score;
    await send(game, 'p1', 'construction', body); constructions++;
    assert.equal(game.view.public.facilities.supply.supply.length, 6);
    assert.equal(game.view.public.facilities.supply.supply.includes(targetId), false);
    assert.equal(game.view.public.players[0].score, oldScore + quotation.quote.printedPoints);
    assert.equal(game.view.public.construction.status, 'entry-pending');
  }
  await restart(); // warehouse branch-choice / free city ready
  for (const game of games) {
    if (game.facilityId === 'FAC-001') {
      const body = { type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-explore' } };
      await preview(game, 'facility-entry', body); await send(game, 'p1', 'facility-entry', body);
      const path = [{ routeId: 'R-route-01', toNodeId: 'D-01' }];
      const result = await rpc(game.peers.get('p1'), 'room:exploration-route', { roomId: game.id, gameId: game.view.public.gameId, expectedVersion: game.view.public.stateVersion, path });
      assert.equal(result.options.execution.legal, true); assert.equal(result.options.quote.total, 2);
      await send(game, 'p1', 'facility-entry', { type: 'explore', nodeId: 'D-01', path });
      assert.equal(game.view.public.board.cityNodeByPlayer.p1, 'A-01');
    } else {
      const choice = (await options(game)).travel; assert.equal(choice.cityMoveCost, 0);
      const move = choice.moves.find(m => m.legal && m.nodeId === 'D-01'); assert.ok(move);
      const originium = game.view.public.players[0].balances.originium;
      await send(game, 'p1', 'facility-entry', { type: 'move-city', nodeId: move.nodeId, routeId: move.routeId });
      assert.equal(game.view.public.players[0].balances.originium, originium);
      assert.equal(game.view.public.board.cityNodeByPlayer.p1, 'D-01');
    }
    assert.equal((await options(game)).travel.status, 'event-choice');
  }
  await restart(); // all six pending events
  for (const game of games) {
    const travel = (await options(game)).travel, variant = travel.event.choices.flatMap(c => c.variants).find(v => v.legal);
    await send(game, 'p1', 'facility-entry', { type: game.facilityId === 'FAC-001' ? 'choose-exploration-event' : 'choose-city-move-event', choice: variant.choice }); events++;
    assert.equal((await options(game)).travel.status, 'final-influence');
  }
  await restart(); // all six pending final node placements
  for (const game of games) {
    const slotId = (await options(game)).travel.finalSlotIds[0];
    await send(game, 'p1', 'facility-entry', { type: game.facilityId === 'FAC-001' ? 'place-exploration-influence' : 'place-city-move-influence', slotId }); finalPlacements++;
    assert.equal((await options(game)).finishTurn.legal, game.facilityId === 'FAC-001');
  }
  await restart(); // three completed warehouses / three pending extra route placements
  for (const game of games) {
    if (game.facilityId === 'FAC-007') {
      const slotId = (await options(game)).construction.entry.routeSlotIds[0]; assert.ok(slotId);
      await send(game, 'p1', 'facility-entry', { type: 'place-entry-route-influence', slotId }); routePlacements++;
    }
    assert.equal((await options(game)).finishTurn.legal, true);
    assert.equal(game.view.public.construction.constructionsCompleted, 1);
    const panel = game.view.public.facilities.panels.find(p => p.playerId === 'p1');
    assert.equal(panel.placements.length, 2);
    await send(game, 'p1', 'round', { type: 'finish-player-turn' }); assert.equal(game.view.public.round.actorId, 'p2');
    const saved = await new PostgresRoomStore(local.sql).read(game.id);
    assert.equal(Object.keys(core.getMarkerLedger(saved.state, saved.definition)).length, game.count * 30);
  }
  assert.equal(playerWrites, 110); assert.equal(automaticWrites, 60); assert.equal(constructions, 6); assert.equal(roleUses, 6);
  assert.equal(events, 6); assert.equal(finalPlacements, 6); assert.equal(routePlacements, 3); assert.equal(restarts, 4);
  console.log(JSON.stringify({ check: 'PASS', games: 6, playerWrites, automaticWrites, constructions, roleUses, warehouseExplorations: 3,
    freeCityMoves: 3, events, finalPlacements, routePlacements, restarts, restoredSnapshots: 24,
    actualRoleIncome: true, trustedDeterministicSetup: true, database: 'PGlite test only' }));
} finally {
  for (const socket of sockets) socket.disconnect();
  if (local) await local.close();
  await rm(directory, { recursive: true, force: true });
}
