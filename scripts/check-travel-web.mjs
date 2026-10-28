import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import * as core from '@nomad-city-online/game-core';
import { createAutomaticBaseRoomSnapshot, PostgresRoomStore, SessionService } from '@nomad-city-online/server';
import { createLocalApplication } from './local-app.mjs';

// Trusted deterministic test provisioning only; no fixture or socket accepts client deck orders.
const directory = await mkdtemp(join(tmpdir(), 'nco-travel-web-')), origin = 'http://nomad.local';
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const games = [], peers = new Set();
let local, base, entryWrites = 0, preparationWrites = 0, automaticWrites = 0, actionWrites = 0, restarts = 0;
let eventChoices = 0, finalPlacements = 0, conditionalPayments = 0;
const rpc = (socket, event, payload) => socket.timeout(5000).emitWithAck(event, payload);
async function open() {
  local = await createLocalApplication({ dataDirectory: join(directory, 'data'), origin, port: 0 });
  await local.app.listen(0, '127.0.0.1'); base = await local.app.getUrl();
}
async function connect(token) {
  const socket = io(`${base}/game`, { autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
    extraHeaders: { Origin: origin }, auth: { protocolVersion: '1.0.0', sessionToken: token } });
  peers.add(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', () => reject(Error('Travel connection failed'))); socket.connect(); });
  return socket;
}
async function send(game, actorId, channel, command, category = 'action') {
  const previous = game.view.public.stateVersion;
  const result = await rpc(game.sockets.get(actorId), 'room:command', { roomId: game.id, request: {
    apiVersion: '1.0.0', requestId: randomUUID(), channel,
    command: { gameId: game.view.public.gameId, expectedVersion: previous, ...command },
  } });
  assert.equal(result.status, 'committed');
  automaticWrites += result.view.public.stateVersion - previous - 1;
  game.view = result.view;
  if (category === 'entry') entryWrites++;
  else if (category === 'preparation') preparationWrites++;
  else { actionWrites++; assert.equal(result.view.public.stateVersion, previous + 1); }
  return result;
}
async function options(game, actorId = 'p1') {
  const result = await rpc(game.sockets.get(actorId), 'room:action-options', { roomId: game.id });
  assert.equal(result.status, 'ready'); assert.equal(result.stateVersion, game.view.public.stateVersion);
  for (const [other, socket] of game.sockets) if (other !== actorId)
    assert.equal((await rpc(socket, 'room:action-options', { roomId: game.id })).options, null);
  return result.options;
}
async function restartAt(status, kind) {
  const saved = [];
  for (const game of games) {
    const choice = await options(game);
    assert.equal(choice.travel.status, status); assert.equal(choice.travel.kind, kind);
    const views = new Map();
    for (const [id, socket] of game.sockets) views.set(id, (await rpc(socket, 'room:subscribe', { roomId: game.id })).view);
    saved.push({ game, views, choice });
  }
  for (const socket of peers) socket.disconnect(); peers.clear();
  await local.close(); local = null; await open(); restarts++;
  for (const { game, views, choice } of saved) {
    game.sockets = new Map();
    for (const [id, token] of game.tokens) {
      const socket = await connect(token); game.sockets.set(id, socket);
      const own = (await rpc(socket, 'room:subscribe', { roomId: game.id })).view;
      assert.deepEqual(own, views.get(id)); assert.equal(own.private.playerId, id);
      for (const player of own.public.players) assert.equal(Object.hasOwn(player.roles, 'placedRoleId'), false);
    }
    game.view = views.get('p1'); assert.deepEqual(await options(game), choice);
    const snapshot = await new PostgresRoomStore(local.sql).read(game.id);
    assert.equal(Object.keys(core.getMarkerLedger(snapshot.state, snapshot.definition)).length, game.count * 30);
  }
}
try {
  await open();
  for (const count of [2, 3, 4]) {
    const id = `travel-${randomUUID()}`, players = seats.slice(0, count), members = players.map(p => ({ playerId: p.id, userId: `${id}-${p.id}` }));
    const ids = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
    const room = createAutomaticBaseRoomSnapshot({ roomId: id, gameId: `game-${id}`, players, members,
      startingPlayerId: 'p1', clockwisePlayerIds: players.map(p => p.id), setupOrders: {
        greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')],
        yellowDeckOrder: ['Y05', 'Y06', ...ids('yellow').filter(id => !['Y05', 'Y06'].includes(id))],
        redDeckOrder: ids('red'), facilityDeckOrder: core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id),
        patternOrder: core.getEligibleCityPatterns('base', count).map(p => p.id),
      } });
    assert.equal(await new PostgresRoomStore(local.sql).create(room), true);
    const game = { id, count, tokens: new Map(), sockets: new Map(), view: null }; games.push(game);
    for (const member of members) {
      const session = await local.app.get(SessionService).issue(member.userId);
      game.tokens.set(member.playerId, session.token); game.sockets.set(member.playerId, await connect(session.token));
    }
    game.view = (await rpc(game.sockets.get('p1'), 'room:subscribe', { roomId: id })).view;
    for (const [index, player] of players.entries()) {
      await send(game, player.id, 'entry', { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] }, 'entry');
      const entry = await rpc(game.sockets.get(player.id), 'room:entry-options', { roomId: id });
      await send(game, player.id, 'entry', { type: 'choose-green-event', choiceId: entry.options.event.choices[0].id }, 'entry');
    }
    if (count === 2) await send(game, 'p2', 'entry', { type: 'choose-entry-influence', slotId: null }, 'entry');
    while (['role-removal', 'role-placement'].includes(game.view.public.round.stage)) {
      const actor = game.view.public.round.actorId;
      const setup = (await rpc(game.sockets.get(actor), 'room:round-setup-options', { roomId: id })).options;
      await send(game, actor, 'round', setup.stage === 'role-removal'
        ? { type: 'remove-round-supply-card', cardId: setup.cards.find(c => c.legal).cardId }
        : { type: 'place-round-role', roleId: 'ROLE-03' }, 'preparation');
    }
    await send(game, 'p1', 'round', { type: 'choose-major-action', action: 'explore' });
    const path = [{ routeId: 'R-route-01', toNodeId: 'D-01' }, { routeId: 'D-route-01', toNodeId: 'D-02' }];
    const previous = await new PostgresRoomStore(local.sql).read(id);
    const preview = await rpc(game.sockets.get('p1'), 'room:exploration-route', {
      roomId: id, gameId: game.view.public.gameId, expectedVersion: game.view.public.stateVersion, path,
    });
    assert.equal(preview.options.execution.legal, true); assert.equal(preview.options.quote.total, 4);
    assert.doesNotMatch(JSON.stringify(preview), /cardId|drawPile|DeckOrder|members|placedRole/);
    assert.deepEqual(await new PostgresRoomStore(local.sql).read(id), previous);
    await send(game, 'p1', 'exploration', { type: 'explore', nodeId: 'D-02', path });
    assert.equal(game.view.public.board.resourceMarkerByNode['D-01'], null);
    assert.equal(game.view.public.board.cityNodeByPlayer.p1, 'A-01');
    assert.equal((await options(game)).travel.event.cardId, 'Y05');
  }
  await restartAt('event-choice', 'explore');
  for (const game of games) {
    const choice = (await options(game)).travel.event.choices.find(c => c.id === 'Y05:1');
    const variant = choice.variants.find(v => v.legal && v.choice.costDecision === 'pay' && v.choice.influenceSlotId === 'node:D-02:slot:1');
    assert.ok(variant);
    const oldFunds = game.view.public.players[0].balances['columbia-voucher'];
    await send(game, 'p1', 'exploration', { type: 'choose-exploration-event', choice: variant.choice });
    eventChoices++; conditionalPayments++;
    assert.equal(game.view.public.players[0].balances['columbia-voucher'], oldFunds - 4);
    assert.equal(game.view.public.board.influenceBySlot['node:D-02:slot:1'].ownerPlayerId, 'p1');
    assert.deepEqual((await options(game)).travel.finalSlotIds, ['node:D-02:slot:2']);
  }
  await restartAt('final-influence', 'explore');
  for (const game of games) {
    await send(game, 'p1', 'exploration', { type: 'place-exploration-influence', slotId: (await options(game)).travel.finalSlotIds[0] }); finalPlacements++;
    await send(game, 'p1', 'round', { type: 'finish-player-turn' });
    for (const id of [...game.sockets.keys()].slice(1)) {
      await send(game, id, 'round', { type: 'choose-major-action', action: 'deploy' });
      const slots = (await options(game, id)).influence.deploymentSlotIds;
      const slotId = slots.find(s => s.startsWith('route:R-route-01:')) ?? slots[0];
      await send(game, id, 'influence', { type: 'deploy-influence', slotId });
      await send(game, id, 'round', { type: 'finish-player-turn' });
    }
    assert.equal(game.view.public.round.cycle, 2);
    await send(game, 'p1', 'round', { type: 'choose-major-action', action: 'city-move' });
    const move = (await options(game)).travel.moves.find(m => m.legal && m.nodeId === 'D-01' && m.routeId === 'R-route-01');
    assert.ok(move);
    const old = await new PostgresRoomStore(local.sql).read(game.id);
    await send(game, 'p1', 'city-move', { type: 'move-city', nodeId: move.nodeId, routeId: move.routeId });
    assert.equal(game.view.public.board.cityNodeByPlayer.p1, 'D-01');
    assert.equal(game.view.public.players[0].balances.originium, 0);
    for (const slot of core.loadFoundersBoard(core.getFoundersMapSide(game.count)).routes[move.routeId].influenceSlotIds) {
      const marker = old.state.board.influenceBySlot[slot];
      if (marker?.ownerPlayerId !== 'p1') assert.equal(game.view.public.board.influenceBySlot[slot], null);
    }
    assert.equal((await options(game)).travel.event.cardId, 'Y06');
  }
  await restartAt('event-choice', 'city-move');
  for (const game of games) {
    const choice = (await options(game)).travel.event.choices.find(c => c.id === 'Y06:2'), variant = choice.variants.find(v => v.legal);
    assert.ok(variant);
    const oldPlayers = game.view.public.players;
    await send(game, 'p1', 'city-move', { type: 'choose-city-move-event', choice: variant.choice }); eventChoices++;
    for (const effect of choice.effects) {
      assert.equal(effect.kind, 'gain');
      for (const player of game.view.public.players.filter(p => effect.recipient === 'actor' ? p.playerId === 'p1' : p.playerId !== 'p1')) {
        const previous = oldPlayers.find(p => p.playerId === player.playerId);
        assert.equal(player.balances[effect.asset], previous.balances[effect.asset] + effect.amount);
      }
    }
  }
  await restartAt('final-influence', 'city-move');
  for (const game of games) {
    await send(game, 'p1', 'city-move', { type: 'place-city-move-influence', slotId: (await options(game)).travel.finalSlotIds[0] }); finalPlacements++;
    assert.equal((await options(game)).finishTurn.legal, true);
    await send(game, 'p1', 'round', { type: 'finish-player-turn' });
    assert.equal(game.view.public.round.actorId, 'p2');
    const saved = await new PostgresRoomStore(local.sql).read(game.id);
    assert.equal(Object.keys(core.getMarkerLedger(saved.state, saved.definition)).length, game.count * 30);
    assert.equal(saved.state.board.resourceMarkerByNode['D-02'].markerDefinitionId, 'Y05');
    assert.equal(saved.state.board.resourceMarkerByNode['D-01'].markerDefinitionId, 'Y06');
  }
  assert.equal(entryWrites, 19); assert.equal(preparationWrites, 11); assert.equal(automaticWrites, 30); assert.equal(actionWrites, 48);
  assert.equal(restarts, 4); assert.equal(eventChoices, 6); assert.equal(finalPlacements, 6); assert.equal(conditionalPayments, 3);
  console.log(JSON.stringify({ check: 'PASS', games: 3, entryWrites, preparationWrites, automaticWrites, actionWrites,
    explorations: 3, cityMoves: 3, eventChoices, conditionalPayments, finalPlacements, restarts,
    recoveredEventAndFinalPlacementStages: 12, trustedDeterministicSetup: true, database: 'PGlite test only' }));
} finally {
  for (const socket of peers) socket.disconnect();
  if (local) await local.close();
  await rm(directory, { recursive: true, force: true });
}
