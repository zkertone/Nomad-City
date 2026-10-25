import { describe, expect, it } from 'vitest';
import * as core from '../index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const oldDeck = core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
const projectDeck = core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
const env = (s: GameState) => ({ gameId: s.gameId, expectedVersion: s.stateVersion });
const round = (s: GameState, d: GameDefinition, command: Record<string, unknown>) => core.applyRoundCommand(s, d, { authenticatedPlayerId: core.getRoundTurn(s, d).actorId! }, { ...env(s), ...command });
const saved = (s: GameState, d: GameDefinition) => core.parseGameState(JSON.parse(JSON.stringify(s)), d);
function create(count = 3, legacy = false, players = seats.slice(0, count)) {
  const g = core.createPreEntryGame('final-scoring', players), ids = (color: string) => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
  let s = core.beginEntry(g.state, g.definition, { expectedVersion: 0, startingPlayerId: players[0]!.id, clockwisePlayerIds: players.map(p => p.id), greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: players[i]!.id }, { ...env(s), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: players[i]!.id }, { ...env(s), type: 'choose-green-event', choiceId: `${s.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: players[1]!.id }, { ...env(s), type: 'choose-entry-influence', slotId: null });
  s = core.beginRoundFlow(s, g.definition, { expectedVersion: s.stateVersion, facilityDeckOrder: oldDeck, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [core.enableBaseRoleEffects, core.enableLiskarmEffects, core.enableRemainingBaseRoleEffects, core.enableWarehouseEntries, core.enableNestedFacilityEntries]) s = upgrade(s, g.definition, { expectedVersion: s.stateVersion });
  s = core.enableCityPatterns(s, g.definition, { expectedVersion: s.stateVersion, gameplayVersion: 'base', patternOrder: core.getEligibleCityPatterns('base', count).map(p => p.id) });
  s = core.enableCityPatternContinuations(s, g.definition, { expectedVersion: s.stateVersion });
  s = core.enableCityPatternMajorActions(s, g.definition, { expectedVersion: s.stateVersion });
  if (!legacy) s = core.enableTemporarySettlements(s, g.definition, { expectedVersion: s.stateVersion, deckOrder: projectDeck });
  return { state: s, definition: g.definition };
}
function finalRoundFixture(count = 3, delayed = false, legacy = false, players = seats.slice(0, count)) {
  const f = create(count, legacy, players); let s = f.state, beforeLastHarvest = s, afterLastHarvest = s;
  // Isolated final-round state fixture. The separate compiled check plays all eight real rounds.
  const raw = core.gameStateSchema.parse(s); raw.roundFlow!.roundNumber = 8; s = core.parseGameState(raw, f.definition);
  for (let n = 8; n <= 8; n++) {
    while (s.roundFlow!.stage === 'role-removal') s = round(s, f.definition, { type: 'remove-round-supply-card', cardId: s.facilities!.supply.supply[0] });
    while (s.roundFlow!.stage === 'role-placement') s = round(s, f.definition, { type: 'place-round-role', roleId: delayed && n === 8 ? 'ROLE-01' : 'ROLE-02' });
    while (s.roundFlow!.stage === 'player-actions') {
      const actor = core.getRoundTurn(s, f.definition).actorId!;
      if (delayed && n === 8 && actor === players[0]!.id && !s.roundFlow!.rolesByPlayer.find(p => p.playerId === actor)!.used) {
        s = core.applyBaseRoleCommand(s, f.definition, { authenticatedPlayerId: actor }, { ...env(s), type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: ['route:A-route-01:slot:1', 'route:B-route-02:slot:1'] } });
      }
      s = round(s, f.definition, { type: 'choose-major-action', action: 'dispatch' });
      if (s.influenceAction!.status === 'ready') s = core.applyInfluenceCommand(s, f.definition, { authenticatedPlayerId: actor }, { ...env(s), type: 'finish-dispatch' });
      s = round(s, f.definition, { type: 'finish-player-turn' });
    }
    if (n === 8) beforeLastHarvest = s;
    s = core.openHarvestPhase(s, f.definition, { expectedVersion: s.stateVersion, roundNumber: n });
    for (const player of f.definition.players) s = core.applyHarvestCommand(s, f.definition, { authenticatedPlayerId: player.id }, { ...env(s), type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } });
    if (n === 8) { afterLastHarvest = s; if (delayed) break; }
    s = saved(core.finishManagedRound(s, f.definition, { expectedVersion: s.stateVersion }), f.definition);
  }
  return { ...f, initial: f.state, state: s, beforeLastHarvest, afterLastHarvest };
}
const cache = new Map<number, ReturnType<typeof finalRoundFixture>>();
function terminal(count = 3) { let f = cache.get(count); if (!f) { f = finalRoundFixture(count); cache.set(count, f); } return f; }
const finish = (s: GameState, d: GameDefinition) => core.finalizeBaseGame(s, d, { expectedVersion: s.stateVersion });
const zero = { orirock: 0, originium: 0, iron: 0, 'columbia-voucher': 0, 'pure-originium': 0 };
/** Isolated score fixtures on an actually completed game; not a claim of earned income. */
function scores() {
  const f = terminal(), raw = core.gameStateSchema.parse(f.state);
  for (const p of Object.values(raw.players)) { p.balances = { ...zero }; p.score = 0; }
  return { ...f, raw };
}

describe('one-time final scoring after complete cleanup', () => {
  it.each([2, 3, 4])('commits a completed %i-player final-round fixture exactly once', count => {
    const f = terminal(count), before = JSON.stringify(f.state), preview = core.getBaseScoringPreview(core.getGamePosition(f.state, f.definition), f.definition);
    const s = finish(f.state, f.definition), result = core.getFinalScoringResult(s, f.definition);
    expect(JSON.stringify(f.state)).toBe(before); expect(s.schemaVersion).toBe('1.17.0'); expect(s.stateVersion).toBe(f.state.stateVersion + 1);
    expect(result.winnerPlayerIds).toEqual(preview.leadingPlayerIds); expect(result.completedRounds).toBe(8);
    for (const p of f.definition.players) {
      expect(s.players[p.id]!.score).toBe(preview.players[p.id]!.totalPoints);
      expect(s.finalScoring!.scoreBeforeByPlayer[p.id]).toBe(f.state.players[p.id]!.score);
      expect(s.players[p.id]!.balances).toEqual(f.state.players[p.id]!.balances);
    }
    expect(s.board).toEqual(f.state.board); expect(s.facilities).toEqual(f.state.facilities); expect(s.cityPatterns).toEqual(f.state.cityPatterns);
    expect(s.temporarySettlementReturns).toEqual(f.state.temporarySettlementReturns); expect(s.eventDecks).toEqual(f.state.eventDecks);
    expect(Object.keys(core.getMarkerLedger(s, f.definition))).toHaveLength(count * 30);
    expect(saved(s, f.definition)).toEqual(s); expect(core.getFinalScoringResult(saved(s, f.definition), f.definition)).toEqual(result);
    expect(() => core.finalizeBaseGame(s, f.definition, { expectedVersion: f.state.stateVersion })).toThrow(/stale/);
    expect(() => finish(s, f.definition)).toThrow(/already/); expect(s.players).toEqual(saved(s, f.definition).players);
    if (count === 2) expect(result.players.p2!.existingPoints).toBe(3);
  });
  it('computes exact whole resource groups without spending the tie-break assets', () => {
    const f = scores(); f.raw.players.p1!.score = 7;
    f.raw.players.p1!.balances = { orirock: 19, originium: 17, iron: 13, 'pure-originium': 3, 'columbia-voucher': 5 };
    const s = finish(core.parseGameState(f.raw, f.definition), f.definition), result = core.getFinalScoringResult(s, f.definition);
    expect(s.players.p1!.score).toBe(16); expect(s.players.p3!.score).toBe(3);
    expect(result.players.p1!.resources).toMatchObject({ totalPoints: 9, unscoredRemainders: { orirock: 1, originium: 1, iron: 1, 'pure-originium': 0 } });
    expect(s.players.p1!.balances).toEqual(f.raw.players.p1!.balances); expect(result.winnerPlayerIds).toEqual(['p1']);
    expect(result.rankingGroups).toEqual([['p1'], ['p3'], ['p2']]);
  });
  it.each(['score', 'columbia-voucher', 'pure-originium', 'shared'] as const)('uses the official %s comparison and preserves tied groups', by => {
    const f = scores(); f.raw.players.p1!.score = 10; f.raw.players.p2!.score = by === 'score' ? 9 : 10;
    if (by === 'columbia-voucher') f.raw.players.p1!.balances['columbia-voucher'] = 1;
    if (by === 'pure-originium') { f.raw.players.p1!.balances['pure-originium'] = 1; f.raw.players.p1!.score--; }
    const result = core.getFinalScoringResult(finish(core.parseGameState(f.raw, f.definition), f.definition), f.definition);
    expect(result.resolvedBy).toBe(by); expect(result.winnerPlayerIds).toEqual(by === 'shared' ? ['p1', 'p2'] : ['p1']);
    expect(result.rankingGroups[0]).toEqual(result.winnerPlayerIds);
  });
  it('keeps all leaders tied and does not use seat order or resource remainders to split them', () => {
    const f = scores(); f.raw.players.p1!.score = 10; f.raw.players.p2!.score = 10; f.raw.players.p3!.score = 7;
    f.raw.players.p2!.balances.orirock = 8; f.raw.players.p1!.balances.iron = 5;
    const result = core.getFinalScoringResult(finish(core.parseGameState(f.raw, f.definition), f.definition), f.definition);
    expect(result.winnerPlayerIds).toEqual(['p1', 'p2', 'p3']); expect(result.rankingGroups).toEqual([['p1', 'p2', 'p3']]); expect(result.resolvedBy).toBe('shared');
  });
  it('checks negative existing scores and safe-integer boundaries exactly', () => {
    const f = scores(); f.raw.players.p1!.score = Number.MIN_SAFE_INTEGER;
    f.raw.players.p1!.balances['pure-originium'] = Number.MAX_SAFE_INTEGER;
    const s = finish(core.parseGameState(f.raw, f.definition), f.definition); expect(s.players.p1!.score).toBe(0);
  });
  it.each(['score', 'version'])('rejects %s overflow atomically', kind => {
    const f = scores();
    if (kind === 'score') { f.raw.players.p1!.score = Number.MAX_SAFE_INTEGER; f.raw.players.p1!.balances['pure-originium'] = 1; }
    else f.raw.stateVersion = Number.MAX_SAFE_INTEGER;
    const s = core.parseGameState(f.raw, f.definition), before = JSON.stringify(s);
    expect(() => finish(s, f.definition)).toThrow(/safe integer|version exhausted/i); expect(JSON.stringify(s)).toBe(before);
  });
  it.each(['initial', 'beforeLastHarvest', 'afterLastHarvest'] as const)('does not score before completed cleanup: %s', field => {
    const f = terminal(), s = f[field], before = JSON.stringify(s);
    expect(() => finish(s, f.definition)).toThrow(/Finish all eight/); expect(JSON.stringify(s)).toBe(before);
    expect(() => core.getFinalScoringResult(s, f.definition)).toThrow(/not been committed/);
  });
  it('waits for actual Liskarm cleanup and scores the board after the removal', () => {
    const f = finalRoundFixture(3, true); let s = f.state;
    expect(core.getRegionControl(core.getGamePosition(s, f.definition), f.definition).A!.controllerPlayerId).toBe('p1');
    expect(() => finish(s, f.definition)).toThrow(/Finish all eight/);
    expect(() => core.finishManagedRound(s, f.definition, { expectedVersion: s.stateVersion })).toThrow(/delayed removal/);
    s = core.openManagedCleanup(s, f.definition, { expectedVersion: s.stateVersion });
    expect(() => finish(s, f.definition)).toThrow(/Finish all eight/);
    s = core.applyRoleCleanupCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'resolve-role-cleanup', slotId: 'route:A-route-01:slot:1' });
    s = core.finishManagedRound(s, f.definition, { expectedVersion: s.stateVersion }); s = finish(s, f.definition);
    const result = core.getFinalScoringResult(s, f.definition);
    expect(result.regions.A!.controllerPlayerId).toBeNull(); expect(result.players.p1!.regionPoints).toBe(0);
  });
  it('requires real level-I reset and preserves level-II lifetime charges', () => {
    const f = scores(), ids = f.raw.cityPatterns!.publicPatternIds, one = ids.find(id => core.getCityPattern(id).level === 1)!, two = ids.find(id => core.getCityPattern(id).level === 2)!;
    f.raw.cityPatterns!.useTracks = [{ playerId: 'p1', patternId: one, remainingUses: 0 }, { playerId: 'p1', patternId: two, remainingUses: 0 }];
    expect(() => finish(core.parseGameState(f.raw, f.definition), f.definition)).toThrow(/Finish all eight/);
    f.raw.cityPatterns!.useTracks[0]!.remainingUses = core.getCityPattern(one).useCapacity;
    const s = finish(core.parseGameState(f.raw, f.definition), f.definition);
    expect(s.cityPatterns!.useTracks[1]!.remainingUses).toBe(0);
  });
  it.each(['stale', 'missing', 'points', 'winners', 'gameId'])('rejects client-supplied/invalid finalization options: %s', kind => {
    const f = terminal(), base = { expectedVersion: f.state.stateVersion };
    const payload: unknown = kind === 'stale' ? { expectedVersion: 0 } : kind === 'missing' ? {} : { ...base, [kind]: kind === 'gameId' ? 'wrong-game' : [] };
    expect(() => core.finalizeBaseGame(f.state, f.definition, payload as typeof base)).toThrow();
  });
  it.each(['missing-receipt', 'missing-player', 'extra-player', 'before-score', 'committed-score', 'source-version', 'source-format', 'legacy-format', 'premature', 'winner-injection', 'unknown-pattern', 'overflow'])('rejects forged persisted scoring data: %s', kind => {
    const f = terminal(), raw = core.gameStateSchema.parse(finish(f.state, f.definition));
    if (kind === 'missing-receipt') delete raw.finalScoring;
    if (kind === 'missing-player') delete raw.finalScoring!.scoreBeforeByPlayer.p1;
    if (kind === 'extra-player') raw.finalScoring!.scoreBeforeByPlayer.other = 0;
    if (kind === 'before-score') raw.finalScoring!.scoreBeforeByPlayer.p1!++;
    if (kind === 'committed-score') raw.players.p1!.score++;
    if (kind === 'source-version') raw.finalScoring!.sourceStateVersion--;
    if (kind === 'source-format') (raw.finalScoring as unknown as { sourceSnapshotVersion: string }).sourceSnapshotVersion = '1.15.0';
    if (kind === 'legacy-format') raw.schemaVersion = '1.16.0';
    if (kind === 'premature') raw.roundFlow!.roundNumber = 7;
    if (kind === 'unknown-pattern') raw.cityPatterns!.useTracks.push({ playerId: 'p1', patternId: 'PAT-999', remainingUses: 0 });
    if (kind === 'overflow') { raw.finalScoring!.scoreBeforeByPlayer.p1 = Number.MAX_SAFE_INTEGER; raw.players.p1!.balances['pure-originium'] = 1; }
    const payload: unknown = kind === 'winner-injection' ? { ...raw, winners: ['p2'] } : raw;
    expect(() => core.validateGameState(payload, f.definition)).not.toThrow(); expect(core.validateGameState(payload, f.definition).success).toBe(false);
  });
  it.each(['round', 'role', 'pattern', 'harvest', 'construction', 'cleanup', 'cleanup-finish'])('blocks %s mutations after finalized recovery', kind => {
    const f = terminal(), s = saved(finish(f.state, f.definition), f.definition), before = JSON.stringify(s), ctx = { authenticatedPlayerId: 'p1' };
    const call = () => {
      if (kind === 'round') return round(s, f.definition, { type: 'choose-major-action', action: 'dispatch' });
      if (kind === 'role') return core.applyBaseRoleCommand(s, f.definition, ctx, { ...env(s), type: 'use-base-role', roleId: 'ROLE-02', mode: 'strategy', strategyChoice: { kind: 'minimum-resource', asset: 'iron' } });
      if (kind === 'pattern') return core.applyCityPatternCommand(s, f.definition, ctx, { ...env(s), type: 'declare-city-pattern', patternId: s.cityPatterns!.publicPatternIds[0], facilityCardIds: ['a', 'b'] });
      if (kind === 'harvest') return core.openHarvestPhase(s, f.definition, { expectedVersion: s.stateVersion, roundNumber: 8 });
      if (kind === 'construction') return core.openConstructionWindow(s, f.definition, { actorId: 'p1', expectedVersion: s.stateVersion, roundNumber: 8 });
      if (kind === 'cleanup') return core.openManagedCleanup(s, f.definition, { expectedVersion: s.stateVersion });
      return core.finishManagedRound(s, f.definition, { expectedVersion: s.stateVersion });
    };
    expect(call).toThrow(); expect(JSON.stringify(s)).toBe(before);
  });
  it('preserves legacy finished games without inventing the newer setup/history', () => {
    const f = finalRoundFixture(3, false, true); expect(saved(f.state, f.definition).schemaVersion).toBe('1.15.0');
    expect(() => finish(f.state, f.definition)).toThrow(/1.16.0/); expect(() => core.getFinalScoringResult(f.state, f.definition)).toThrow(/not been committed/);
  });
  it('keeps prototype-like registered IDs safe in before-score receipts and ranking', () => {
    const players: PlayerSetup[] = [{ id: 'constructor', color: 'red' }, { id: 'toString', color: 'blue' }], f = finalRoundFixture(2, false, false, players);
    const s = finish(f.state, f.definition), result = core.getFinalScoringResult(s, f.definition);
    expect(Object.keys(s.finalScoring!.scoreBeforeByPlayer)).toEqual(['constructor', 'toString']); expect(Object.keys(result.players)).toEqual(['constructor', 'toString']);
    expect(core.validateGameState(JSON.parse(JSON.stringify(s)), f.definition).success).toBe(true);
  });
  it('returns a deeply frozen public result without private cards or double-awarded preview totals', () => {
    const f = terminal(), s = finish(f.state, f.definition), before = JSON.stringify(s), result = core.getFinalScoringResult(s, f.definition);
    expect(core.getFinalScoringResult(s, f.definition)).toEqual(result); expect(JSON.stringify(s)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.rankingGroups[0])).toBe(true);
    for (const key of ['eventDecks', 'drawPile', 'rolesByPlayer', 'markerSupplyByPlayer', 'scoreMarkerId']) expect(JSON.stringify(result)).not.toContain(`"${key}"`);
    expect(core.getRoundPublicView(s, f.definition, 'p1').finalResult).toEqual(result);
    expect(() => core.getRoundPublicView(s, f.definition, 'outsider')).toThrow();
    expect(() => core.getFinalScoringResult(s, core.createPreEntryGame('other-game', seats.slice(0, 3)).definition)).toThrow();
  });
});
