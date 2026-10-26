import { describe, expect, it } from 'vitest';
import * as core from '../index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const oldDeck = core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
const projectDeck = core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
const env = (s: GameState) => ({ gameId: s.gameId, expectedVersion: s.stateVersion });
const round = (s: GameState, d: GameDefinition, command: Record<string, unknown>) => core.applyRoundCommand(s, d, { authenticatedPlayerId: core.getRoundTurn(s, d).actorId! }, { ...env(s), ...command });
function create(count = 3, legacy = false, players = seats.slice(0, count)) {
  const g = core.createPreEntryGame('player-contract', players), ids = (color: string) => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
  let s = core.beginEntry(g.state, g.definition, { expectedVersion: 0, startingPlayerId: players[0]!.id, clockwisePlayerIds: players.map(p => p.id), greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: players[i]!.id }, { ...env(s), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: players[i]!.id }, { ...env(s), type: 'choose-green-event', choiceId: `${s.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: players[1]!.id }, { ...env(s), type: 'choose-entry-influence', slotId: null });
  s = core.beginRoundFlow(s, g.definition, { expectedVersion: s.stateVersion, facilityDeckOrder: oldDeck, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [core.enableBaseRoleEffects, core.enableLiskarmEffects, core.enableRemainingBaseRoleEffects, core.enableWarehouseEntries, core.enableNestedFacilityEntries]) s = upgrade(s, g.definition, { expectedVersion: s.stateVersion });
  s = core.enableCityPatterns(s, g.definition, { expectedVersion: s.stateVersion, gameplayVersion: 'base', patternOrder: ['PAT-012', ...core.getEligibleCityPatterns('base', count).map(p => p.id).filter(id => id !== 'PAT-012')] });
  s = core.enableCityPatternContinuations(s, g.definition, { expectedVersion: s.stateVersion });
  s = core.enableCityPatternMajorActions(s, g.definition, { expectedVersion: s.stateVersion });
  if (!legacy) s = core.enableTemporarySettlements(s, g.definition, { expectedVersion: s.stateVersion, deckOrder: projectDeck });
  return { state: s, definition: g.definition };
}

const request = (s: GameState, channel: string, command: Record<string, unknown>) => ({ apiVersion: '1.0.0', requestId: 'request-1', channel, command: { ...env(s), ...command } });
const execute = (s: GameState, d: GameDefinition, channel: string, command: Record<string, unknown>, playerId = 'p1') => core.executeGamePlayerRequest(s, d, { authenticatedPlayerId: playerId }, request(s, channel, command));
function accepted(result: core.GamePlayerExecution) { expect(result.status).toBe('accepted'); if (result.status !== 'accepted') throw Error(JSON.stringify(result.reply)); return result.state; }
function placed(f = create()) {
  let s = f.state;
  while (s.roundFlow!.stage === 'role-removal') s = round(s, f.definition, { type: 'remove-round-supply-card', cardId: s.facilities!.supply.supply.at(-1) });
  while (s.roundFlow!.stage === 'role-placement') s = round(s, f.definition, { type: 'place-round-role', roleId: 'ROLE-03' });
  return { ...f, state: s };
}
function harvestFixture() {
  const f = placed(); let s = f.state;
  while (s.roundFlow!.stage === 'player-actions') {
    const actor = core.getRoundTurn(s, f.definition).actorId!;
    s = round(s, f.definition, { type: 'choose-major-action', action: 'dispatch' });
    if (s.influenceAction!.status === 'ready') s = core.applyInfluenceCommand(s, f.definition, { authenticatedPlayerId: actor }, { ...env(s), type: 'finish-dispatch' });
    s = round(s, f.definition, { type: 'finish-player-turn' });
  }
  return { ...f, state: core.openHarvestPhase(s, f.definition, { expectedVersion: s.stateVersion, roundNumber: 1 }) };
}
function searchedDeck() {
  const f = placed(), raw = core.gameStateSchema.parse(f.state);
  // Isolated declared-layout fixture, not a claim of earned resources or real construction.
  raw.players.p1!.balances['columbia-voucher'] = 200;
  const panel = raw.facilities!.panels[0]!, supply = raw.facilities!.supply;
  const cards = core.getCityPattern('PAT-012').cells.map(cell => {
    const cellId = `CP-${cell.row + 1}-${cell.column + 1}`;
    const existing = panel.placements.find(p => p.cellId === cellId);
    if (existing) return existing.cardId;
    const card = core.PROJECT_BASE_FACILITY_STOCK.cards.find(c => c.group === 'ordinary' && cell.colors.includes(c.color as never)
      && !core.getFacilityExecutionFace(c.facilityId).effect.uniqueMarker && !supply.playerHoldings.some(h => h.cardIds.includes(c.id)))!;
    for (const zone of [supply.supply, supply.drawPile, supply.returnedToBox]) { const i = zone.indexOf(card.id); if (i >= 0) zone.splice(i, 1); }
    while (supply.supply.length < 6) supply.supply.push(supply.drawPile.shift()!);
    supply.playerHoldings[0]!.cardIds.push(card.id); panel.placements.push({ cellId, cardId: card.id }); return card.id;
  });
  let s = core.parseGameState(raw, f.definition);
  s = core.applyCityPatternCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'declare-city-pattern', patternId: 'PAT-012', facilityCardIds: cards });
  s = core.applyCityPatternCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'use-pattern-special', patternId: 'PAT-012', markerId: s.patternMarkers!.find(m => m.ownerPlayerId === 'p1')!.markerId, effect: { kind: 'deck-construction' } });
  return { ...f, state: s };
}
const cached = placed(), harvest = harvestFixture(), search = searchedDeck();
const view = (s: GameState, d: GameDefinition, playerId = 'p1') => core.getGamePlayerView(s, d, { authenticatedPlayerId: playerId });
function frozen(value: unknown): void { if (value && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); } }

describe('complete allowlisted public and authenticated player projections', () => {
  it.each([2, 3, 4])('projects %i-player setup and managed play without upgrading snapshots', count => {
    const g = core.createPreEntryGame('before-entry', seats.slice(0, count));
    const pre = core.getGamePublicView(g.state, g.definition);
    expect(pre.round).toBeNull(); expect(pre.entry).toBeNull(); expect(pre.facilities).toBeNull(); expect(pre.snapshotVersion).toBe('1.0.0');
    const f = create(count), publicView = core.getGamePublicView(f.state, f.definition);
    expect(publicView.players).toHaveLength(count); expect(publicView.facilities!.supply.drawPileCount).toBe(38);
    expect(publicView.snapshotVersion).toBe('1.16.0'); expect(f.state.schemaVersion).toBe('1.16.0');
    for (const player of f.definition.players) expect(view(f.state, f.definition, player.id).public).toEqual(publicView);
    expect(publicView.facilities!.panels.map(p => p.playerId)).toEqual(f.definition.players.map(p => p.id));
  });
  it('exposes current entry event but only a count for the unrevealed green deck', () => {
    const g = core.createPreEntryGame('entry-privacy', seats.slice(0, 3));
    const s = core.beginEntry(g.state, g.definition, { startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2', 'p3'], expectedVersion: 0, greenDeckOrder: ['G03', 'G02', 'G04', 'G05', 'G06'] });
    const raw = core.gameStateSchema.parse(s); raw.entry!.remainingGreenEventIds.reverse();
    expect(core.getGamePublicView(s, g.definition)).toEqual(core.getGamePublicView(raw, g.definition));
    const next = accepted(execute(s, g.definition, 'entry', { type: 'select-initial-node', nodeId: 'A-01' }));
    expect(core.getGamePublicView(next, g.definition).entry!.pendingEvent!.cardId).toBe('G03');
    expect(core.getGamePublicView(next, g.definition).eventDeckCounts!.green).toBe(4);
  });
  it('keeps opponent hands and placed role identity unobservable across equivalent snapshots', () => {
    const f = cached, raw = core.gameStateSchema.parse(f.state), role = raw.roundFlow!.rolesByPlayer[1]!;
    const replacement = role.hand[0]!; role.hand[0] = role.placed!; role.placed = replacement;
    const alternate = core.parseGameState(raw, f.definition);
    expect(core.getGamePublicView(f.state, f.definition)).toEqual(core.getGamePublicView(alternate, f.definition));
    expect(view(f.state, f.definition)).toEqual(view(alternate, f.definition));
    expect(view(f.state, f.definition, 'p2').private.placedRoleId).not.toBe(view(alternate, f.definition, 'p2').private.placedRoleId);
    const publicRole = core.getGamePublicView(f.state, f.definition).players[1]!.roles!;
    expect(Object.keys(publicRole).sort()).toEqual(['discardedRoleIds', 'handCount', 'hasPlacedRole', 'usedRole']);
  });
  it('hides all unrevealed event and facility deck permutations', () => {
    const f = cached, raw = core.gameStateSchema.parse(f.state);
    raw.eventDecks!.yellow.reverse(); raw.eventDecks!.red.reverse(); raw.facilities!.supply.drawPile.reverse();
    expect(view(f.state, f.definition)).toEqual(view(raw, f.definition));
    const pub = core.getGamePublicView(raw, f.definition);
    expect(Object.hasOwn(pub.facilities!.supply, 'drawPile')).toBe(false);
    expect(Object.hasOwn(pub, 'eventDecks')).toBe(false); expect(Object.hasOwn(pub, 'finalScoring')).toBe(false);
  });
  it('reveals a role only after the existing role command actually uses it', () => {
    const f = cached;
    const s = accepted(execute(f.state, f.definition, 'role', { type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: f.state.facilities!.supply.supply[0] } }));
    const role = view(s, f.definition, 'p2').public.players[0]!.roles!;
    expect(role.usedRole!.roleId).toBe('ROLE-03'); expect(role.discardedRoleIds).toContain('ROLE-03'); expect(role.hasPlacedRole).toBe(false);
  });
  it('includes actual pattern tracks, panel positions, balances and marker counts', () => {
    const f = search, v = view(f.state, f.definition);
    expect(v.public.cityPatterns!.publicPatternIds).toEqual(f.state.cityPatterns!.publicPatternIds);
    expect(v.public.cityPatterns!.exhaustedFacilityIdsByPlayer.p1).toEqual(f.state.cityPatterns!.exhaustedFacilityIdsByPlayer.p1);
    expect(v.public.patternContinuation).toEqual({ kind: 'deck-build', patternId: 'PAT-012' });
    expect(v.private.patternMarkers).toHaveLength(1);
    expect(v.public.players[0]!.markerSupplyCount).toBe(f.state.markerSupplyByPlayer.p1!.length);
    expect(v.public.players[0]!.balances).toEqual(f.state.players.p1!.balances);
    expect(v.public.facilities!.panels[0]!.placements).toEqual(f.state.facilities!.panels[0]!.placements);
  });
  it('shows deck search only to its entitled actor and removes hidden deck order even there', () => {
    const f = search, raw = core.gameStateSchema.parse(f.state); raw.facilities!.supply.drawPile.reverse();
    const owner = view(f.state, f.definition), opponent = view(f.state, f.definition, 'p2');
    expect(owner.private.continuationOptions).not.toBeNull(); expect(opponent.private.continuationOptions).toBeNull();
    expect(owner).toEqual(view(raw, f.definition));
    const options = owner.private.continuationOptions!;
    expect('constructionOptions' in options && options.constructionOptions!.choices.length).toBeGreaterThan(0);
  });
  it('keeps own pending harvest plan private and publishes submission progress only', () => {
    const f = harvest, s = accepted(execute(f.state, f.definition, 'harvest', { type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } }));
    expect(view(s, f.definition).private.harvestPlan).toEqual({ nodeIds: [], routeIds: [] });
    expect(view(s, f.definition, 'p2').private.harvestPlan).toBeNull();
    expect(core.getGamePublicView(s, f.definition).harvest).toEqual({ roundNumber: 1, status: 'planning', submittedPlayerIds: ['p1'] });
    expect(Object.hasOwn(core.getGamePublicView(s, f.definition).harvest!, 'plansByPlayer')).toBe(false);
  });
  it('is deeply frozen, detached from mutable input and stable after JSON recovery', () => {
    const f = cached, mutable = core.gameStateSchema.parse(f.state), before = JSON.stringify(mutable), v = view(mutable, f.definition);
    frozen(v); expect(JSON.stringify(mutable)).toBe(before);
    expect(view(core.parseGameState(JSON.parse(before), f.definition), f.definition)).toEqual(v);
    mutable.players.p1!.score += 9; expect(v.public.players[0]!.score).toBe(f.state.players.p1!.score);
    expect(() => { (v.private.roleHand as string[]).push('ROLE-01'); }).toThrow();
  });
  it.each(['outsider', '__proto__', 'constructor'])('rejects unknown viewer %s', playerId => {
    expect(() => view(cached.state, cached.definition, playerId)).toThrow(core.GameViewError);
  });
  it('also detaches definition references without freezing caller-owned metadata', () => {
    const definition: GameDefinition = JSON.parse(JSON.stringify(cached.definition));
    const pub = core.getGamePublicView(cached.state, definition);
    expect(pub.boardDefinitionRef).toEqual(definition.boardDefinitionRef);
    expect(pub.boardDefinitionRef).not.toBe(definition.boardDefinitionRef);
    expect(pub.eventCatalogRef).not.toBe(definition.eventCatalogRef);
    expect(Object.isFrozen(definition.boardDefinitionRef)).toBe(false);
    expect(Object.isFrozen(definition.eventCatalogRef)).toBe(false);
    frozen(pub);
  });
  it('rejects viewer spoofing and damaged snapshots instead of producing partial output', () => {
    expect(() => core.getGamePlayerView(cached.state, cached.definition, { authenticatedPlayerId: 'p1', playerId: 'p2' } as never)).toThrow();
    const raw = core.gameStateSchema.parse(cached.state); raw.players.p1!.score = NaN;
    expect(() => core.getGamePublicView(raw, cached.definition)).toThrow();
  });
  it('keeps the original legacy round-view contract and 1.15 storage readable', () => {
    const f = create(3, true);
    expect(core.getRoundPublicView(f.state, f.definition, 'p1').roles[0]!.hand).toHaveLength(5);
    expect(view(f.state, f.definition).public.snapshotVersion).toBe('1.15.0');
    expect(view(f.state, f.definition).public.facilities!.supply.drawPileCount).toBe(35);
  });
});

describe('strict player request execution and transport-only replies', () => {
  it('matches the existing direct rule result, preserves input, increments once and returns a safe acknowledgement', () => {
    const f = cached, command = { type: 'choose-major-action', action: 'deploy' }, before = JSON.stringify(f.state);
    const result = execute(f.state, f.definition, 'round', command), s = accepted(result);
    expect(s).toEqual(core.applyRoundCommand(f.state, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(f.state), ...command }));
    expect(result.reply).toEqual({ apiVersion: '1.0.0', requestId: 'request-1', ok: true, gameId: s.gameId, stateVersion: s.stateVersion });
    expect(JSON.stringify(result.reply)).not.toContain('eventDeck'); expect(JSON.stringify(f.state)).toBe(before); frozen(result);
  });
  it('rejects replay and conflicting requests after the first accepted version', () => {
    const f = cached, payload = request(f.state, 'round', { type: 'choose-major-action', action: 'dispatch' });
    const s = accepted(core.executeGamePlayerRequest(f.state, f.definition, { authenticatedPlayerId: 'p1' }, payload));
    const result = core.executeGamePlayerRequest(s, f.definition, { authenticatedPlayerId: 'p1' }, payload);
    expect(result.reply).toMatchObject({ ok: false, error: { code: 'STALE_VERSION' } }); expect(Object.hasOwn(result, 'state')).toBe(false);
  });
  it('rejects another member acting out of turn with no raw rule message or state', () => {
    const r = execute(cached.state, cached.definition, 'round', { type: 'choose-major-action', action: 'deploy' }, 'p2');
    expect(r.reply).toMatchObject({ ok: false, error: { code: 'RULE_REJECTED', ruleCode: 'WRONG_ACTOR' } });
    expect(Object.hasOwn(r, 'state')).toBe(false); expect(Object.hasOwn(r.reply, 'message')).toBe(false);
  });
  it.each(['outsider', '__proto__', 'constructor'])('checks membership before reading %s requests', playerId => {
    const r = core.executeGamePlayerRequest(cached.state, cached.definition, { authenticatedPlayerId: playerId }, null);
    expect(r.reply).toMatchObject({ ok: false, requestId: null, error: { code: 'NOT_A_MEMBER' } });
  });
  it.each(['actorId', 'authenticatedPlayerId', 'score', 'balances', 'roundNumber', 'deckOrder', 'winnerPlayerIds'])('rejects injected command field %s', key => {
    const r = execute(cached.state, cached.definition, 'round', { type: 'choose-major-action', action: 'deploy', [key]: 'spoofed' });
    expect(r.reply).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });
  it.each(['finalize-base-game', 'begin-round-flow', 'open-harvest-phase', 'enable-temporary-settlements'])('has no player endpoint for trusted transition %s', type => {
    const r = execute(cached.state, cached.definition, 'round', { type });
    expect(r.reply).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });
  it.each([null, {}, { apiVersion: '0.0.0' }, { channel: '__proto__' }])('rejects malformed request %#', payload => {
    expect(core.executeGamePlayerRequest(cached.state, cached.definition, { authenticatedPlayerId: 'p1' }, payload).reply).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });
  it('rejects extra envelope fields, wrong game and unsafe expected versions', () => {
    const p = request(cached.state, 'round', { type: 'choose-major-action', action: 'deploy' });
    for (const payload of [{ ...p, actorId: 'p2' }, { ...p, command: { ...p.command, expectedVersion: -1 } }, { ...p, command: { ...p.command, expectedVersion: Number.MAX_SAFE_INTEGER + 1 } }]) expect(core.executeGamePlayerRequest(cached.state, cached.definition, { authenticatedPlayerId: 'p1' }, payload).reply).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(execute(cached.state, cached.definition, 'round', { type: 'choose-major-action', action: 'deploy', gameId: 'other' }).reply).toMatchObject({ ok: false, error: { code: 'WRONG_GAME' } });
  });
  it('treats corrupt authoritative state as a server fault, not a successful or player-error reply', () => {
    const raw = core.gameStateSchema.parse(cached.state); raw.stateVersion = -1;
    expect(() => core.executeGamePlayerRequest(raw, cached.definition, { authenticatedPlayerId: 'p1' }, request(cached.state, 'round', { type: 'finish-player-turn' }))).toThrow();
  });
});

const examples: readonly [string, Record<string, unknown>][] = [
  ['entry', { type: 'select-initial-node', nodeId: 'A-01' }],
  ['round', { type: 'choose-major-action', action: 'deploy' }],
  ['exploration', { type: 'explore', nodeId: 'D-01', path: [{ routeId: 'R-route-01', toNodeId: 'D-01' }] }],
  ['city-move', { type: 'move-city', nodeId: 'D-01', routeId: 'R-route-01' }],
  ['influence', { type: 'finish-dispatch' }],
  ['harvest', { type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } }],
  ['construction', { type: 'construct-facility', cardId: 'FC:FAC-006:green:1', cellId: 'CP-1-1', paymentMode: 'vouchers' }],
  ['role', { type: 'use-base-role', roleId: 'ROLE-03', mode: 'strategy', strategyChoice: { kind: 'cycle-facility', cardId: 'example-card' } }],
  ['role-cleanup', { type: 'resolve-role-cleanup', slotId: 'route:A-route-01:slot:1' }],
  ['warehouse-entry', { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-influence' } }],
  ['facility-entry', { type: 'copy-facility-entry', targetCardId: 'example-card' }],
  ['city-pattern', { type: 'declare-city-pattern', patternId: 'PAT-001', facilityCardIds: ['one', 'two'] }],
  ['pattern-continuation', { type: 'place-pattern-route-influence', slotId: 'route:A-route-01:slot:1' }],
];
describe('all channel contracts and routed action progress', () => {
  it.each(examples)('reuses the existing strict %s command schema', (channel, command) => {
    const payload = request(cached.state, channel, command);
    expect(core.gamePlayerRequestSchema.safeParse(payload).success).toBe(true);
    expect(core.gamePlayerRequestSchema.safeParse({ ...payload, command: { ...payload.command, actorId: 'p2' } }).success).toBe(false);
  });
  it.each(examples.filter(([channel]) => ['exploration', 'city-move', 'warehouse-entry', 'facility-entry', 'pattern-continuation'].includes(channel)))('retains %s parent/stage authorization through the router', (channel, command) => {
    const result = execute(cached.state, cached.definition, channel, command);
    expect(result.reply).toMatchObject({ ok: false, error: { code: 'RULE_REJECTED' } });
    expect(core.gamePlayerReplySchema.safeParse(result.reply).success).toBe(true);
    expect(JSON.stringify(result.reply)).not.toContain('example-card');
  });
  it.each(['exploration', 'city-move'])('routes a real %s to the revealed event without exposing unrevealed decks', channel => {
    const f = cached;
    let s = accepted(execute(f.state, f.definition, 'round', { type: 'choose-major-action', action: channel === 'exploration' ? 'explore' : 'city-move' }));
    const command = channel === 'exploration' ? examples[2]![1] : examples[3]![1];
    s = accepted(execute(s, f.definition, channel, command));
    const pub = core.getGamePublicView(s, f.definition), progress = channel === 'exploration' ? pub.exploration : pub.cityMove;
    expect(progress!.status).toBe('event-choice'); expect(progress!.cardId).toBe('Y01');
    expect(JSON.stringify(pub)).not.toContain('remainingGreenEventIds');
    expect(progress!.targetNodeId).toBe('D-01');
  });
  it('validates acknowledgement and failure replies and rejects accidental state serialization', () => {
    const result = execute(cached.state, cached.definition, 'round', { type: 'choose-major-action', action: 'deploy' });
    expect(core.gamePlayerReplySchema.parse(result.reply)).toEqual(result.reply);
    expect(core.gamePlayerReplySchema.safeParse(result).success).toBe(false);
    expect(core.gamePlayerReplySchema.safeParse({ ...result.reply, state: cached.state }).success).toBe(false);
  });
});
