import { deepFreeze } from '../board/hash.js';
import { loadFoundersBoard, createEmptyBoardState, validateBoardState, validateDefinitionRef } from '../board/index.js';
import type { MapSide, ValidationIssue, ValidationResult } from '../board/types.js';
import { FOUNDERS_EVENT_CATALOG, FOUNDERS_EVENT_CATALOG_HASH } from '../events/index.js';
import { gameDefinitionSchema, gameStateSchema, gamePositionSchema, playerSetupsSchema } from './schema.js';
import type { GameDefinition, GameState, GamePosition, MarkerLedgerEntry, PlayerSetup } from './types.js';
import { entryProgressIssues } from './entry-invariants.js';
import { explorationProgressIssues } from './exploration-invariants.js';
import { actionPositionIssues } from './action-invariants.js';
import { cityMoveProgressIssues } from './city-move-invariants.js';
import { harvestIssues } from './harvest-invariants.js';
import { influenceActionIssues } from './influence-action-invariants.js';
import { constructionIssues } from './construction-invariants.js';
import { roundFlowIssues } from './round-invariants.js';

/** Player-count setup rule; it is deliberately outside BoardDefinition. */
export function getFoundersMapSide(playerCount: number): MapSide {
  if (playerCount === 2 || playerCount === 3) return 'three-player';
  if (playerCount === 4) return 'four-player';
  throw new RangeError('Founders base requires 2, 3 or 4 players');
}

function schemaIssues(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): ValidationIssue[] {
  return error.issues.map(issue => ({ code: 'SCHEMA', path: issue.path.map(String).join('.'), message: issue.message }));
}

export function validateGameDefinition(input: unknown): ValidationResult<GameDefinition> {
  const parsed = gameDefinitionSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: schemaIssues(parsed.error) };
  const definition = parsed.data;
  const issues: ValidationIssue[] = [];
  const report = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
  const playerIds = new Set(definition.players.map(player => player.id));
  if (playerIds.size !== definition.players.length) report('PLAYER_DUPLICATE', 'players', 'Player IDs must be unique');
  if (new Set(definition.players.map(player => player.color)).size !== definition.players.length) {
    report('COLOR_DUPLICATE', 'players', 'Player colors must be unique');
  }
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const ref = validateDefinitionRef(definition.boardDefinitionRef, board);
  if (!ref.success) issues.push(...ref.issues);
  if (definition.rulesetId !== `founders-base-${definition.players.length}p`) {
    report('RULESET', 'rulesetId', 'Player-count ruleset mismatch');
  }
  if (definition.eventCatalogRef.contentHash !== FOUNDERS_EVENT_CATALOG_HASH) {
    report('EVENT_CATALOG_REF', 'eventCatalogRef', 'Event catalog is not the confirmed version');
  }
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  for (const marker of definition.markerDefinitions) {
    if (ids.has(marker.id)) report('MARKER_DUPLICATE', marker.id, 'Duplicate inventory marker ID');
    ids.add(marker.id);
    if (!playerIds.has(marker.ownerPlayerId)) report('PLAYER_REFERENCE', marker.id, 'Unknown inventory owner');
    counts.set(marker.ownerPlayerId, (counts.get(marker.ownerPlayerId) ?? 0) + 1);
  }
  for (const id of playerIds) {
    if (counts.get(id) !== 30) report('MARKER_COUNT', id, 'Every player owns exactly 30 markers');
  }
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(definition) };
}

export function parseGameDefinition(input: unknown): GameDefinition {
  const result = validateGameDefinition(input);
  if (!result.success) throw new Error(result.issues.map(issue => `${issue.code}: ${issue.message}`).join('; '));
  return result.data;
}

/** Single authoritative usage facts: supply arrays, score refs, and existing board slots. */
function markerUsages(state: GamePosition): MarkerLedgerEntry[] {
  const result: MarkerLedgerEntry[] = [];
  for (const [playerId, markerIds] of Object.entries(state.markerSupplyByPlayer)) {
    for (const markerId of markerIds) result.push({ markerId, ownerPlayerId: playerId, location: { kind: 'supply', playerId } });
  }
  for (const [playerId, player] of Object.entries(state.players)) {
    result.push({ markerId: player.scoreMarkerId, ownerPlayerId: playerId, location: { kind: 'score', playerId } });
  }
  for (const [slotId, marker] of Object.entries(state.board.influenceBySlot)) {
    if (marker) result.push({ markerId: marker.markerId, ownerPlayerId: marker.ownerPlayerId, location: { kind: 'board-slot', slotId } });
  }
  return result;
}

/** Phase-independent shared facts; never an authorization to perform an action. */
export function validateGamePosition(input: unknown, inputDefinition: GameDefinition): ValidationResult<GamePosition> {
  const setup = validateGameDefinition(inputDefinition);
  if (!setup.success) return setup;
  const definition = setup.data;
  const parsed = gamePositionSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: schemaIssues(parsed.error) };
  const state = parsed.data;
  const issues: ValidationIssue[] = [];
  const report = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
  if (state.gameId !== definition.gameId) report('GAME_REFERENCE', 'gameId', 'Wrong game definition');
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const checkedBoard = validateBoardState(state.board, board);
  if (!checkedBoard.success) issues.push(...checkedBoard.issues);
  const playerIds = definition.players.map(player => player.id).sort();
  for (const [record, path] of [
    [state.players, 'players'], [state.markerSupplyByPlayer, 'markerSupplyByPlayer'],
    [state.board.cityNodeByPlayer, 'board.cityNodeByPlayer'],
  ] as const) {
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(playerIds)) {
      report('PLAYER_KEYS', path, 'Snapshot must cover exactly the registered players');
    }
  }
  const inventory = new Map(definition.markerDefinitions.map(marker => [marker.id, marker.ownerPlayerId]));
  const used = new Set<string>();
  for (const usage of markerUsages(state)) {
    const owner = inventory.get(usage.markerId);
    if (owner === undefined) report('MARKER_REFERENCE', usage.markerId, 'Unregistered marker');
    else if (owner !== usage.ownerPlayerId) report('MARKER_OWNER', usage.markerId, 'Marker belongs to another player');
    if (used.has(usage.markerId)) report('MARKER_REUSED', usage.markerId, 'A marker has multiple locations');
    used.add(usage.markerId);
  }
  for (const id of inventory.keys()) {
    if (!used.has(id)) report('MARKER_MISSING', id, 'Marker has no location');
  }
  const revealed = new Set<string>();
  for (const [nodeId, marker] of Object.entries(state.board.resourceMarkerByNode)) {
    if (marker === null) continue;
    const card = FOUNDERS_EVENT_CATALOG.cards.find(item => item.id === marker.markerDefinitionId);
    if (!card) { report('RESOURCE_MARKER_REFERENCE', nodeId, 'Unknown base event resource marker'); continue; }
    if (revealed.has(card.id)) report('RESOURCE_MARKER_REUSED', nodeId, 'One event marker is at multiple nodes');
    revealed.add(card.id);
    const node = Object.hasOwn(board.resourceNodes, nodeId) ? board.resourceNodes[nodeId] : undefined;
    if (node && node.eventDeckColor !== card.color) report('RESOURCE_MARKER_COLOR', nodeId, 'Marker has the wrong event color');
    if (definition.players.length < 4 && card.hasFourPlayerMark) {
      report('RESOURCE_MARKER_PLAYERS', nodeId, 'Four-player card excluded by three-player setup and two-player appendix');
    }
    if (marker.resourceKind !== card.resourceMarker.resource || marker.harvestAmount !== card.resourceMarker.harvestAmount) {
      report('RESOURCE_MARKER_DATA', nodeId, 'Resource kind/amount must match the approved card');
    }
  }
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(state) };
}

export function parseGamePosition(input: unknown, definition: GameDefinition): GamePosition {
  const result = validateGamePosition(input, definition);
  if (!result.success) throw new Error(result.issues.map(issue => `${issue.code}: ${issue.message}`).join('; '));
  return result.data;
}

function positionFields(state: GamePosition): GamePosition {
  return { gameId: state.gameId, board: state.board, players: state.players, markerSupplyByPlayer: state.markerSupplyByPlayer };
}

/** Cross-object snapshot checks. This is not the complete turn/action legality validator. */
export function validateGameState(input: unknown, definition: GameDefinition): ValidationResult<GameState> {
  const parsed = gameStateSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: schemaIssues(parsed.error) };
  const position = validateGamePosition(positionFields(parsed.data), definition);
  if (!position.success) return position;
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const issues = [...actionPositionIssues(parsed.data, definition), ...entryProgressIssues(parsed.data, definition, board), ...explorationProgressIssues(parsed.data, definition, board), ...cityMoveProgressIssues(parsed.data, definition, board), ...influenceActionIssues(parsed.data, definition, board), ...harvestIssues(parsed.data, definition, board), ...constructionIssues(parsed.data, definition)];
  issues.push(...roundFlowIssues(parsed.data, definition));
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(parsed.data) };
}

/** Extract a validated working view; callers must not persist it alongside GameState. */
export function getGamePosition(input: GameState, definition: GameDefinition): GamePosition {
  return parseGamePosition(positionFields(parseGameState(input, definition)), definition);
}

export function parseGameState(input: unknown, definition: GameDefinition): GameState {
  const result = validateGameState(input, definition);
  if (!result.success) throw new Error(result.issues.map(issue => `${issue.code}: ${issue.message}`).join('; '));
  return result.data;
}

/** Setup snapshot BEFORE selecting first player/cities/events and granting initial funds. */
export function createPreEntryGame(gameId: string, inputPlayers: readonly PlayerSetup[]): {
  readonly definition: GameDefinition; readonly state: GameState;
} {
  const players = playerSetupsSchema.parse(inputPlayers);
  const board = loadFoundersBoard(getFoundersMapSide(players.length));
  const markerDefinitions = players.flatMap((player, seat) => Array.from({ length: 30 }, (_, index) => ({
    id: `marker:${seat + 1}:${String(index + 1).padStart(2, '0')}`, ownerPlayerId: player.id,
  })));
  const definition = parseGameDefinition({
    schemaVersion: '1.0.0', gameId, rulesetId: `founders-base-${players.length}p`, players,
    boardDefinitionRef: { definitionId: board.definitionId, definitionVersion: board.definitionVersion, contentHash: board.contentHash },
    eventCatalogRef: { catalogId: FOUNDERS_EVENT_CATALOG.catalogId, definitionVersion: FOUNDERS_EVENT_CATALOG.definitionVersion,
      contentHash: FOUNDERS_EVENT_CATALOG.contentHash }, markerDefinitions,
  });
  const state = parseGameState({
    schemaVersion: '1.0.0', gameId, stateVersion: 0, phase: 'entry',
    board: createEmptyBoardState(board, players.map(player => player.id)),
    players: Object.fromEntries(players.map(player => {
      const markers = markerDefinitions.filter(marker => marker.ownerPlayerId === player.id);
      return [player.id, { balances: { orirock: 0, originium: 0, iron: 0, 'columbia-voucher': 0, 'pure-originium': 0 },
        score: 0, scoreMarkerId: markers[0]!.id }];
    })),
    markerSupplyByPlayer: Object.fromEntries(players.map(player => [player.id,
      markerDefinitions.filter(marker => marker.ownerPlayerId === player.id).slice(1).map(marker => marker.id)])),
  }, definition);
  return Object.freeze({ definition, state });
}

/** Derived view, never a second persisted set of authoritative marker locations. */
export function getMarkerLedger(input: GameState, definition: GameDefinition): Readonly<Record<string, MarkerLedgerEntry>> {
  const state = parseGameState(input, definition);
  return deepFreeze(Object.fromEntries(markerUsages(state).map(entry => [entry.markerId, entry])));
}
