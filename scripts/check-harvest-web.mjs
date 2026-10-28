import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import * as core from '@nomad-city-online/game-core';
import { createAutomaticBaseRoomSnapshot, PostgresRoomStore, SessionService } from '@nomad-city-online/server';
import { createLocalApplication } from './local-app.mjs';
const directory = await mkdtemp(join(tmpdir(), 'nco-harvest-web-')), origin = 'http://nomad.local';
const seats = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const games = [], peers = new Set(); let local, base, playerWrites = 0, automaticWrites = 0, restarts = 0, harvestWrites = 0, replacements = 0, rejectedWrites = 0, cleanupChoices = 0;
const rpc = (socket, event, body) => socket.timeout(5000).emitWithAck(event, body);
async function open() { local = await createLocalApplication({ dataDirectory: join(directory, 'data'), origin, port: 0 }); await local.app.listen(0, '127.0.0.1'); base = await local.app.getUrl(); }
async function connect(token) {
  const socket = io(`${base}/game`, { autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'], extraHeaders: { Origin: origin }, auth: { protocolVersion: '1.0.0', sessionToken: token } });
  peers.add(socket); await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', () => reject(Error('Harvest flow connection failed'))); socket.connect(); }); return socket;
}
function request(game, channel, command, version = game.view.public.stateVersion) {
  return { roomId: game.id, request: { apiVersion: '1.0.0', requestId: randomUUID(), channel, command: { gameId: game.view.public.gameId, expectedVersion: version, ...command } } };
}
async function send(game, channel, command, actor = game.view.public.round.actorId) {
  const before = game.view.public.stateVersion, result = await rpc(game.sockets.get(actor), 'room:command', request(game, channel, command));
  assert.equal(result.status, 'committed'); assert.equal(result.reply.stateVersion, before + 1);
  playerWrites++; automaticWrites += result.view.public.stateVersion - before - 1; if (channel === 'harvest') harvestWrites++;
  game.view = result.view; const snapshot = await new PostgresRoomStore(local.sql).read(game.id);
  assert.deepEqual(game.view, core.getGamePlayerView(snapshot.state, snapshot.definition, { authenticatedPlayerId: actor }));
}
async function harvestOptions(game, actor) {
  const result = await rpc(game.sockets.get(actor), 'room:harvest-options', { roomId: game.id });
  assert.equal(result.status, 'ready'); assert.equal(result.stateVersion, game.view.public.stateVersion);
  assert.doesNotMatch(JSON.stringify(result), /drawPile|DeckOrder|plansByPlayer|members|placedRoleId|markerId/); return result;
}
async function preview(game, actor, plan) {
  const store = new PostgresRoomStore(local.sql), before = await store.read(game.id);
  const result = await rpc(game.sockets.get(actor), 'room:harvest-preview', { roomId: game.id, command: { type: 'set-harvest-plan', gameId: game.view.public.gameId, expectedVersion: game.view.public.stateVersion, plan } });
  assert.equal(result.status, 'ready'); assert.equal(result.options.execution.legal, true);
  assert.equal(result.options.quote.total, 0); assert.deepEqual(await store.read(game.id), before); return result;
}
async function restart() {
  const saved = [];
  for (const game of games) {
    const views = new Map(), options = new Map();
    for (const [id, peer] of game.sockets) { views.set(id, (await rpc(peer, 'room:subscribe', { roomId: game.id })).view); options.set(id, await harvestOptions(game, id)); }
    saved.push({ game, views, options });
  }
  for (const peer of peers) peer.disconnect(); peers.clear(); await local.close(); local = null; await open(); restarts++;
  for (const { game, views, options } of saved) {
    game.sockets = new Map();
    for (const [id, token] of game.tokens) {
      const peer = await connect(token); game.sockets.set(id, peer);
      const restored = await rpc(peer, 'room:subscribe', { roomId: game.id }); assert.deepEqual(restored.view, views.get(id));
      assert.deepEqual(await harvestOptions(game, id), options.get(id));
    }
    game.view = views.get('p1'); const snapshot = await new PostgresRoomStore(local.sql).read(game.id);
    assert.equal(Object.keys(core.getMarkerLedger(snapshot.state, snapshot.definition)).length, game.count * 30);
  }
}
async function actions(game, round) {
  assert.equal(game.view.public.round.roundNumber, round);
  while (['role-removal', 'role-placement'].includes(game.view.public.round.stage)) {
    const actor = game.view.public.round.actorId, options = (await rpc(game.sockets.get(actor), 'room:round-setup-options', { roomId: game.id })).options;
    await send(game, 'round', options.stage === 'role-removal' ? { type: 'remove-round-supply-card', cardId: options.cards.find(c => c.legal).cardId }
      : { type: 'place-round-role', roleId: round === 8 && actor === 'p1' ? 'ROLE-01' : 'ROLE-02' });
  }
  while (game.view.public.round.stage === 'player-actions') {
    const actor = game.view.public.round.actorId, own = game.view.public.players.find(p => p.playerId === actor);
    if (round === 8 && actor === 'p1' && !own.roles.usedRole) await send(game, 'role', { type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: ['route:A-route-01:slot:1', 'route:B-route-02:slot:1'] } });
    await send(game, 'round', { type: 'choose-major-action', action: 'dispatch' });
    if (game.view.public.influenceAction.status === 'ready') await send(game, 'influence', { type: 'finish-dispatch' });
    await send(game, 'round', { type: 'finish-player-turn' });
  }
  assert.equal(game.view.public.phase, 'harvest'); assert.equal(game.view.public.harvest.status, 'planning');
}
const cityPlan = (game, actor) => ({ nodeIds: [game.view.public.board.cityNodeByPlayer[actor]], routeIds: [] });
async function collect(game, actors) {
  for (const actor of actors) {
    const before = game.view.public.players, advice = await harvestOptions(game, actor), plan = cityPlan(game, actor);
    assert.ok(advice.options.nodeChoices.some(n => n.nodeId === plan.nodeIds[0])); await preview(game, actor, plan);
    await send(game, 'harvest', { type: 'set-harvest-plan', plan }, actor);
    if (game.view.public.harvest?.status === 'planning') assert.deepEqual(game.view.public.players, before);
  }
}
try {
  await open();
  for (const count of [2, 3, 4]) {
    const id = `harvest-${randomUUID()}`, players = seats.slice(0, count), members = players.map(p => ({ playerId: p.id, userId: `${id}-${p.id}` }));
    const events = color => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
    const room = createAutomaticBaseRoomSnapshot({ roomId: id, gameId: `game-${id}`, players, members, startingPlayerId: 'p1', clockwisePlayerIds: players.map(p => p.id), setupOrders: {
      greenDeckOrder: ['G03', ...events('green').filter(id => id !== 'G03')], yellowDeckOrder: events('yellow'), redDeckOrder: events('red'),
      facilityDeckOrder: core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id), patternOrder: core.getEligibleCityPatterns('base', count).map(p => p.id),
    } });
    assert.equal(await new PostgresRoomStore(local.sql).create(room), true);
    const game = { id, count, tokens: new Map(), sockets: new Map(), view: null }; games.push(game);
    for (const member of members) { const token = (await local.app.get(SessionService).issue(member.userId)).token; game.tokens.set(member.playerId, token); game.sockets.set(member.playerId, await connect(token)); }
    game.view = (await rpc(game.sockets.get('p1'), 'room:subscribe', { roomId: id })).view;
    for (const [index, p] of players.entries()) {
      await send(game, 'entry', { type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][index] }, p.id);
      const entry = await rpc(game.sockets.get(p.id), 'room:entry-options', { roomId: id });
      await send(game, 'entry', { type: 'choose-green-event', choiceId: entry.options.event.choices[0].id }, p.id);
    }
    if (count === 2) await send(game, 'entry', { type: 'choose-entry-influence', slotId: null }, 'p2');
    await actions(game, 1); const originalVersion = game.view.public.stateVersion;
    await collect(game, ['p1']);
    assert.deepEqual((await harvestOptions(game, 'p1')).options.plan, cityPlan(game, 'p1'));
    for (const actor of [...game.sockets.keys()].filter(id => id !== 'p1')) assert.equal((await harvestOptions(game, actor)).options.plan, null);
    const stale = await rpc(game.sockets.get('p2'), 'room:command', request(game, 'harvest', { type: 'set-harvest-plan', plan: cityPlan(game, 'p2') }, originalVersion));
    assert.equal(stale.status, 'rejected'); assert.equal(stale.reply.error.code, 'STALE_VERSION'); rejectedWrites++;
  }
  await restart(); // own submitted plan and other members' unsubmitted state
  for (const game of games) {
    await preview(game, 'p1', { nodeIds: [], routeIds: [] }); await send(game, 'harvest', { type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } }, 'p1'); replacements++;
    await preview(game, 'p1', cityPlan(game, 'p1')); await send(game, 'harvest', { type: 'set-harvest-plan', plan: cityPlan(game, 'p1') }, 'p1'); replacements++;
    await collect(game, [...game.sockets.keys()].filter(id => id !== 'p1'));
    for (let round = 2; round <= 8; round++) { await actions(game, round); await collect(game, [...game.sockets.keys()]); }
    assert.equal(game.view.public.round.stage, 'cleanup'); assert.equal(game.view.public.finalResult, null);
    const options = (await rpc(game.sockets.get('p1'), 'room:action-options', { roomId: game.id })).options; assert.equal(options.quick.cleanupSlotIds.length, 2);
  }
  await restart(); // final cleanup still requires an actual player decision
  for (const game of games) {
    const options = (await rpc(game.sockets.get('p1'), 'room:action-options', { roomId: game.id })).options;
    const command = { type: 'resolve-role-cleanup', slotId: options.quick.cleanupSlotIds[0] };
    const allowed = await rpc(game.sockets.get('p1'), 'room:quick-preview', { roomId: game.id, channel: 'role-cleanup', command: { gameId: game.view.public.gameId, expectedVersion: game.view.public.stateVersion, ...command } });
    assert.equal(allowed.options.execution.legal, true);
    const wrong = await rpc(game.sockets.get('p2'), 'room:command', request(game, 'role-cleanup', command)); assert.equal(wrong.status, 'rejected'); assert.equal(wrong.reply.error.ruleCode, 'WRONG_ACTOR'); rejectedWrites++;
    await send(game, 'role-cleanup', command, 'p1'); cleanupChoices++;
    assert.equal(game.view.public.snapshotVersion, '1.17.0'); const final = game.view.public.finalResult;
    assert.equal(final.completedRounds, 8); assert.equal(final.sourceStateVersion, game.view.public.stateVersion - 1);
    for (const [id, peer] of game.sockets) {
      const view = (await rpc(peer, 'room:subscribe', { roomId: game.id })).view;
      assert.deepEqual(view.public.finalResult, final); assert.equal(view.private.playerId, id);
      assert.equal(final.players[id].totalPoints, view.public.players.find(p => p.playerId === id).score); assert.equal((await harvestOptions(game, id)).options, null);
    }
    const snapshot = await new PostgresRoomStore(local.sql).read(game.id); assert.equal(core.validateFacilitySupplyState(snapshot.state.facilities.supply).success, true);
  }
  await restart(); // committed results restore without paying or scoring twice
  assert.equal(playerWrites, 493); assert.equal(automaticWrites, 105); assert.equal(harvestWrites, 78); assert.equal(replacements, 6); assert.equal(rejectedWrites, 6); assert.equal(restarts, 3); assert.equal(cleanupChoices, 3);
  console.log(JSON.stringify({ check: 'PASS', games: 3, roundsPerGame: 8, playerWrites, automaticWrites, harvestWrites, replacements, rejectedWrites, cleanupChoices, restarts,
    restoredGames: 9, restoredIndividualViews: 27, originalPlansAndCommittedResults: true, manualStageCalls: 0, noInjectedState: true, trustedDeterministicSetup: true, database: 'PGlite test only' }));
} finally { for (const peer of peers) peer.disconnect(); if (local) await local.close(); await rm(directory, { recursive: true, force: true }); }
