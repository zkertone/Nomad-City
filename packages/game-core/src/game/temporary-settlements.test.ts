import { describe, expect, it } from 'vitest';
import * as core from '../index.js';
import type { GameState, GameDefinition, PlayerSetup } from './types.js';

const seats: readonly PlayerSetup[] = [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }, { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' }];
const ordinary = core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id);
const temporary = core.PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.facilityId === 'FAC-017').map(c => c.id);
const projectDeck = [...temporary, ...ordinary];
const env = (s: GameState) => ({ gameId: s.gameId, expectedVersion: s.stateVersion });
const round = (s: GameState, d: GameDefinition, command: Record<string, unknown>) => core.applyRoundCommand(s, d, { authenticatedPlayerId: core.getRoundTurn(s, d).actorId! }, { ...env(s), ...command });
const saved = (s: GameState, d: GameDefinition) => core.parseGameState(JSON.parse(JSON.stringify(s)), d);
function fresh(count = 3, patternId = 'PAT-001') {
  const g = core.createPreEntryGame('temporary-facilities', seats.slice(0, count));
  const ids = (color: string) => core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === color && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
  let s = core.beginEntry(g.state, g.definition, { startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(p => p.id), expectedVersion: 0,
    greenDeckOrder: ['G03', ...ids('green').filter(id => id !== 'G03')] });
  for (let i = 0; i < count; i++) {
    s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: seats[i]!.id }, { ...env(s), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: seats[i]!.id }, { ...env(s), type: 'choose-green-event', choiceId: `${s.entry!.pendingEvent!.cardId}:1` });
  }
  if (count === 2) s = core.applyEntryCommand(s, g.definition, { authenticatedPlayerId: 'p2' }, { ...env(s), type: 'choose-entry-influence', slotId: null });
  s = core.beginRoundFlow(s, g.definition, { expectedVersion: s.stateVersion, facilityDeckOrder: ordinary, deckOrder: { yellow: ids('yellow'), red: ids('red') } });
  for (const upgrade of [core.enableBaseRoleEffects, core.enableLiskarmEffects, core.enableRemainingBaseRoleEffects, core.enableWarehouseEntries, core.enableNestedFacilityEntries]) s = upgrade(s, g.definition, { expectedVersion: s.stateVersion });
  s = core.enableCityPatterns(s, g.definition, { expectedVersion: s.stateVersion, gameplayVersion: 'base', patternOrder: [patternId, ...core.getEligibleCityPatterns('base', count).map(p => p.id).filter(id => id !== patternId)] });
  s = core.enableCityPatternContinuations(s, g.definition, { expectedVersion: s.stateVersion });
  s = core.enableCityPatternMajorActions(s, g.definition, { expectedVersion: s.stateVersion });
  return { state: s, definition: g.definition };
}
function setup(count = 3, patternId = 'PAT-001') {
  const f = fresh(count, patternId); let s = core.enableTemporarySettlements(f.state, f.definition, { expectedVersion: f.state.stateVersion, deckOrder: projectDeck });
  while (s.roundFlow!.stage === 'role-removal') s = round(s, f.definition, { type: 'remove-round-supply-card', cardId: s.facilities!.supply.supply.find(id => !temporary.includes(id)) });
  while (s.roundFlow!.stage === 'role-placement') s = round(s, f.definition, { type: 'place-round-role', roleId: 'ROLE-03' });
  return { ...f, state: s };
}
/** Isolated physical-layout fixture, not evidence of legal construction or earned funds. */
function fixture(count = 3, patternId = 'PAT-001', temporaryCount = 1) {
  const f = setup(count, patternId), raw = core.gameStateSchema.parse(f.state), supply = raw.facilities!.supply, panel = raw.facilities!.panels[0]!;
  const holding = supply.playerHoldings[0]!, used: string[] = [];
  core.getCityPattern(patternId).cells.forEach((cell, i) => {
    const card = i < temporaryCount ? temporary[i]! : core.PROJECT_BASE_FACILITY_STOCK.cards.find(c => c.group === 'ordinary' && c.color === cell.colors[0] && !used.includes(c.id))!.id;
    for (const zone of [supply.supply, supply.drawPile, supply.returnedToBox]) { const at = zone.indexOf(card); if (at >= 0) zone.splice(at, 1); }
    holding.cardIds.push(card); panel.placements.push({ cardId: card, cellId: `CP-${cell.row + 1}-${cell.column + 1}` }); used.push(card);
  });
  while (supply.supply.length < 6) supply.supply.push(supply.drawPile.shift()!);
  raw.players.p1!.balances['columbia-voucher'] = 200;
  return { ...f, state: core.parseGameState(raw, f.definition), used };
}
function announce(f: ReturnType<typeof fixture>, returns?: readonly string[], actor = 'p1', extras: Record<string, unknown> = {}) {
  return core.applyCityPatternCommand(f.state, f.definition, { authenticatedPlayerId: actor }, { ...env(f.state), type: 'declare-city-pattern',
    patternId: f.state.cityPatterns!.publicPatternIds[0], facilityCardIds: f.used,
    ...(returns === undefined ? {} : { returnTemporaryFacilityIds: returns }), ...extras });
}

describe('project-base temporary settlements', () => {
  it('keeps the printing inventory and old immutable catalogs while adding three physical cards', () => {
    expect(core.FOUNDERS_FACILITY_STOCK.cards).toHaveLength(48);
    expect(core.PROJECT_BASE_FACILITY_STOCK.cards).toHaveLength(51);
    expect(core.FOUNDERS_FACILITY_FACES.facilities).toHaveLength(18);
    expect(core.getFacilityCopyCountRecords('infected').find(c => c.id === 'FAC-017')!.copyCountsByColor.rainbow).toBe(3);
    expect(core.getFacilityExecutionFace('FAC-017')).toMatchObject({ edition: 'infected', printedScore: 0, observedColor: 'rainbow', constructionCost: { voucherPayment: 11, resourcePayment: { originium: 1, iron: 2 } }, effect: { entryMarker: false, uniqueMarker: true } });
    expect(core.computeFacilityStockHash(core.PROJECT_BASE_FACILITY_STOCK)).toBe(core.PROJECT_BASE_FACILITY_STOCK.contentHash);
    expect(core.getFacilityConstructionSupport().supportedPhysicalCardIds).toHaveLength(41);
    expect(core.getFacilityConstructionSupport(true).supportedPhysicalCardIds).toHaveLength(44);
  });
  it.each([2, 3, 4])('initializes %i-player fresh games with exact conservation and private deck projection', count => {
    const f = fresh(count), before = JSON.stringify(f.state);
    const s = core.enableTemporarySettlements(f.state, f.definition, { expectedVersion: f.state.stateVersion, deckOrder: projectDeck });
    expect(JSON.stringify(f.state)).toBe(before); expect(s.schemaVersion).toBe('1.16.0');
    expect(s.facilities!.supply.drawPile).toHaveLength(38); expect(s.temporarySettlementReturns).toEqual([]);
    expect(core.validateFacilitySupplyState(s.facilities!.supply).success).toBe(true);
    expect(core.getFacilitySupplyPublicView(s.facilities!.supply)).not.toHaveProperty('drawPile');
    expect(saved(s, f.definition)).toEqual(s);
  });
  it.each(['resources', 'vouchers'] as const)('constructs a real temporary facility using its printed %s alternative', paymentMode => {
    const f = setup(), raw = core.gameStateSchema.parse(f.state);
    raw.players.p1!.balances = { orirock: 0, originium: 1, iron: 2, 'pure-originium': 0, 'columbia-voucher': 11 };
    let s = round(core.parseGameState(raw, f.definition), f.definition, { type: 'choose-major-action', action: 'construct' });
    const granted = s, before = JSON.stringify(s);
    s = core.applyConstructionCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId: temporary[0], cellId: 'CP-1-1', paymentMode });
    expect(JSON.stringify(granted)).toBe(before);
    expect(s.players.p1!.balances).toMatchObject(paymentMode === 'resources' ? { originium: 0, iron: 0, 'columbia-voucher': 11 } : { originium: 1, iron: 2, 'columbia-voucher': 0 });
    expect(s.players.p1!.score).toBe(f.state.players.p1!.score);
    expect(s.temporarySettlementReturns).toEqual([]); expect(core.getRoundTurn(s, f.definition).majorActionStatus).toBe('complete');
    expect(saved(s, f.definition)).toEqual(s);
  });
  it.each(['stale', 'short', 'duplicate', 'foreign', 'extra-option', 'already-playing', 'twice'])('rejects invalid initialization: %s', kind => {
    const f = fresh(), opts = { expectedVersion: f.state.stateVersion, deckOrder: projectDeck };
    let state = f.state, options: unknown = opts;
    if (kind === 'stale') options = { ...opts, expectedVersion: 0 };
    if (kind === 'short') options = { ...opts, deckOrder: ordinary };
    if (kind === 'duplicate') options = { ...opts, deckOrder: projectDeck.map((id, i) => i === 1 ? projectDeck[0] : id) };
    if (kind === 'foreign') options = { ...opts, deckOrder: projectDeck.map((id, i) => i === 1 ? 'FC:FAC-019:red:01' : id) };
    if (kind === 'extra-option') options = { ...opts, free: true };
    if (kind === 'already-playing') { state = round(state, f.definition, { type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply.at(-1) }); options = { ...opts, expectedVersion: state.stateVersion }; }
    if (kind === 'twice') state = core.enableTemporarySettlements(state, f.definition, opts);
    const before = JSON.stringify(state);
    expect(() => core.enableTemporarySettlements(state, f.definition, options as typeof opts)).toThrow(); expect(JSON.stringify(state)).toBe(before);
  });
  it.each([2, 3, 4])('returns exactly selected declaration cards atomically in a %i-player snapshot', count => {
    const f = fixture(count, 'PAT-001', 1), before = JSON.stringify(f.state), s = announce(f, [temporary[0]!]);
    expect(JSON.stringify(f.state)).toBe(before); expect(s.players.p1!.balances['columbia-voucher']).toBe(212);
    expect(s.facilities!.supply.returnedToBox).toContain(temporary[0]);
    expect(s.facilities!.panels[0]!.placements.some(p => p.cardId === temporary[0])).toBe(false);
    expect(s.facilities!.panels[0]!.placements.some(p => p.cardId === f.used[1])).toBe(true);
    expect(s.cityPatterns!.exhaustedFacilityIdsByPlayer.p1).toEqual(f.used);
    expect(s.temporarySettlementReturns).toEqual([{ playerId: 'p1', cardId: temporary[0] }]);
    expect(core.getRoundTurn(s, f.definition).majorActionStatus).toBe('not-started');
    expect(core.getCityPatternDeclarationOptions(saved(s, f.definition), f.definition, 'p1').length).toBe(6);
    expect(() => core.applyCityPatternCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(f.state), type: 'declare-city-pattern', patternId: 'PAT-001', facilityCardIds: f.used, returnTemporaryFacilityIds: [temporary[0]] })).toThrow();
  });
  it.each([undefined, []])('declining the optional return keeps ownership and grants no refund: %j', choice => {
    const f = fixture(), s = announce(f, choice);
    expect(s.players.p1!.balances['columbia-voucher']).toBe(200); expect(s.temporarySettlementReturns).toEqual([]);
    expect(s.facilities!.panels[0]!.placements.some(p => p.cardId === temporary[0])).toBe(true);
    expect(s.cityPatterns!.exhaustedFacilityIdsByPlayer.p1).toContain(temporary[0]);
  });
  it('enforces uniqueness until return and permits another physical copy after return', () => {
    const f = fixture(), granted = round(f.state, f.definition, { type: 'choose-major-action', action: 'construct' }), before = JSON.stringify(granted);
    expect(() => core.applyConstructionCommand(granted, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(granted), type: 'construct-facility', cardId: temporary[1], cellId: 'CP-2-1', paymentMode: 'vouchers' })).toThrow(/unique/);
    expect(JSON.stringify(granted)).toBe(before);
    let s = announce(f, [temporary[0]!]);
    s = round(s, f.definition, { type: 'choose-major-action', action: 'construct' });
    s = core.applyConstructionCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId: temporary[1], cellId: 'CP-1-1', paymentMode: 'vouchers' });
    expect(s.players.p1!.balances['columbia-voucher']).toBe(201);
    expect(s.facilities!.supply.returnedToBox).toContain(temporary[0]);
    expect(s.facilities!.panels[0]!.placements.filter(p => temporary.includes(p.cardId))).toHaveLength(1);
    expect(saved(s, f.definition)).toEqual(s);
  });
  it.each(['duplicate', 'not-used', 'ordinary', 'foreign-actor', 'unknown', 'overflow', 'supply-overflow', 'panel-overflow', 'no-marker', 'layout'])('rejects %s return choices without partial declaration/reward', kind => {
    const f = fixture(), raw = core.gameStateSchema.parse(f.state); let returns = [temporary[0]!], actor = 'p1';
    if (kind === 'duplicate') returns.push(temporary[0]!);
    if (kind === 'not-used') returns = [temporary[2]!];
    if (kind === 'ordinary') returns = [f.used[1]!];
    if (kind === 'unknown') returns = ['FC:FAC-017:rainbow:04'];
    if (kind === 'foreign-actor') actor = 'p2';
    if (kind === 'overflow') raw.players.p1!.balances['columbia-voucher'] = Number.MAX_SAFE_INTEGER;
    if (kind === 'supply-overflow') raw.facilities!.supply.revision = Number.MAX_SAFE_INTEGER;
    if (kind === 'panel-overflow') raw.facilities!.panels[0]!.revision = Number.MAX_SAFE_INTEGER;
    if (kind === 'no-marker') { raw.patternMarkers!.push(...raw.markerSupplyByPlayer.p1!.map(markerId => ({ markerId, ownerPlayerId: 'p1', patternId: 'PAT-001' }))); raw.markerSupplyByPlayer.p1 = []; raw.cityPatterns!.useTracks.push({ playerId: 'p1', patternId: 'PAT-001', remainingUses: 1 }); }
    const state = core.parseGameState(raw, f.definition), bad = { ...f, state, used: kind === 'layout' ? f.used.slice(1) : f.used }, before = JSON.stringify(state);
    expect(() => announce(bad, returns, actor)).toThrow(); expect(JSON.stringify(state)).toBe(before);
  });
  it.each(['wrong-owner', 'duplicate-record', 'ordinary-record', 'missing-record', 'legacy-version', 'legacy-stock', 'unknown-field'])('rejects forged persisted return facts: %s', kind => {
    const f = fixture(), raw = core.gameStateSchema.parse(announce(f, [temporary[0]!]));
    if (kind === 'wrong-owner') raw.temporarySettlementReturns![0]!.playerId = 'p2';
    if (kind === 'duplicate-record') raw.temporarySettlementReturns!.push(raw.temporarySettlementReturns![0]!);
    if (kind === 'ordinary-record') raw.temporarySettlementReturns![0]!.cardId = f.used[1]!;
    if (kind === 'missing-record') raw.temporarySettlementReturns = [];
    if (kind === 'legacy-version') raw.schemaVersion = '1.15.0';
    if (kind === 'legacy-stock') raw.facilities!.supply.stockRef = { ...raw.facilities!.supply.stockRef, definitionId: 'founders-base-facility-stock', contentHash: core.FOUNDERS_FACILITY_STOCK_HASH };
    const payload: unknown = kind === 'unknown-field' ? { ...raw, temporaryReward: 12 } : raw;
    expect(core.validateGameState(payload, f.definition).success).toBe(false);
  });
  it('rejects new return choices on old snapshots while preserving normal old declarations', () => {
    const f = fresh(); let s = f.state;
    while (core.getRoundTurn(s, f.definition).stage === 'role-removal') s = round(s, f.definition, { type: 'remove-round-supply-card', cardId: s.facilities!.supply.supply.at(-1) });
    while (s.roundFlow!.stage === 'role-placement') s = round(s, f.definition, { type: 'place-round-role', roleId: 'ROLE-02' });
    expect(() => core.applyCityPatternCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'declare-city-pattern', patternId: 'PAT-001', facilityCardIds: ['x', 'y'], returnTemporaryFacilityIds: [] })).toThrow(/1.16.0/);
    expect(saved(s, f.definition).schemaVersion).toBe('1.15.0');
  });
  it('supports pending new-build declarations after temporary facilities leave their original cells', () => {
    const f = fixture(3, 'PAT-013', 1), raw = core.gameStateSchema.parse(f.state), supply = raw.facilities!.supply;
    const cardId = ordinary.find(id => id.startsWith('FC:FAC-009:'))!, at = supply.drawPile.indexOf(cardId);
    if (at >= 0) { supply.drawPile.splice(at, 1); supply.drawPile.push(supply.supply.pop()!); supply.supply.push(cardId); }
    raw.players.p1!.balances['columbia-voucher'] = 12;
    const s = announce({ ...f, state: core.parseGameState(raw, f.definition) }, [temporary[0]!]);
    expect(s.players.p1!.balances['columbia-voucher']).toBe(24); expect(s.cityPatternContinuation?.kind).toBe('declaration-build');
    expect(saved(s, f.definition)).toEqual(s);
    const next = core.applyConstructionCommand(s, f.definition, { authenticatedPlayerId: 'p1' }, { ...env(s), type: 'construct-facility', cardId, cellId: 'CP-1-2', paymentMode: 'vouchers' });
    expect(next.players.p1!.balances['columbia-voucher']).toBe(0); expect(next.cityPatternContinuation).toBe(null);
    expect(next.facilities!.panels[0]!.placements.some(p => p.cellId === 'CP-1-2' && p.cardId === cardId)).toBe(true);
    expect(core.getRoundTurn(next, f.definition).majorActionStatus).toBe('not-started'); expect(saved(next, f.definition)).toEqual(next);
  });
});
