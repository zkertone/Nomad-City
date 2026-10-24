import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { getFoundersPhysicalFacilityCard } from '../facilities/stock.js';
import { getEmptyFacilityPanelCells } from '../facilities/panel-state.js';
import { getFacilityConstructionQuote } from '../facilities/construction.js';
import { gameStateSchema, cityMoveProgressSchema, gameEntityIdSchema } from './schema.js';
import { parseGameState, getGamePosition } from './state.js';
import { cityMoveOptionsFor } from './city-move.js';
import { boardFor } from './facility-entry-rules.js';
import { availableInfluenceSlots } from './influence.js';
import { getEventChoiceRequirements } from './settlement.js';
import { slotIdSchema } from '../board/schema.js';
import type { GameDefinition, GameState } from './types.js';

type Mutable = z.infer<typeof gameStateSchema>;
export class CityPatternContinuationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CityPatternContinuationError'; }
}
const reject = (code: string, message: string): never => { throw new CityPatternContinuationError(code, message); };
/** Additive capability upgrade; no declarations, charges or active action history are inferred. */
export function enableCityPatternContinuations(input: GameState, definition: GameDefinition, options: { readonly expectedVersion: number }): GameState {
  const state = parseGameState(input, definition), checked = z.strictObject({ expectedVersion: z.number().int().nonnegative().safe() }).safeParse(options);
  if (!checked.success) return reject('OPTIONS_SCHEMA', checked.error.message);
  if (checked.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.schemaVersion !== '1.13.0') return reject('PATTERN_FORMAT', 'Upgrade an existing validated 1.13.0 snapshot exactly once');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return parseGameState({ ...state, schemaVersion: '1.14.0', stateVersion: state.stateVersion + 1, cityPatternContinuation: null }, definition);
}
export function patternConstructionOptions(state: GameState, definition: GameDefinition, actorId: string, source: 'supply' | 'draw-pile') {
  const panel = state.facilities!.panels.find(p => p.playerId === actorId)!;
  const cells = getEmptyFacilityPanelCells(panel, state.facilities!.supply);
  const choices: { cardId: string; paymentMode: 'resources' | 'vouchers' }[] = [];
  if (!cells.length) return { choices, cellIds: [] as string[] };
  const ids = source === 'draw-pile' ? state.facilities!.supply.drawPile : state.facilities!.supply.supply;
  for (const cardId of ids) {
    if (source === 'supply' && getFoundersPhysicalFacilityCard(cardId).color === 'rainbow') continue;
    for (const paymentMode of ['resources', 'vouchers'] as const) {
      try {
        const quote = getFacilityConstructionQuote({ position: { gameId: state.gameId, board: state.board, players: state.players, markerSupplyByPlayer: state.markerSupplyByPlayer, patternMarkers: state.patternMarkers! }, ...state.facilities! }, definition,
          { gameId: state.gameId, actorId, expectedSupplyRevision: state.facilities!.supply.revision, expectedPanelRevision: panel.revision, source },
          { cardId, cellId: cells[0]!.id, paymentMode });
        if (quote.canPay) choices.push({ cardId, paymentMode });
      } catch (error) {
        // Every current physical ordinary face is supported; only these are legal impossibilities.
        if (!(error instanceof Error && 'code' in error && error.code === 'UNIQUE_FACILITY')) throw error;
      }
    }
  }
  return { choices, cellIds: cells.map(c => c.id) };
}
function readyMove(next: Mutable, actorId: string): void {
  next.phase = 'city-move';
  next.cityMove = cityMoveProgressSchema.parse({ actorId, roundNumber: next.roundFlow!.roundNumber, status: 'ready', sourceNodeId: null, targetNodeId: null, routeId: null, cardId: null, resolvedChoiceId: null });
}
export function patternRouteSlots(state: GameState, definition: GameDefinition): string[] {
  const move = state.cityMove;
  if (!move?.routeId) return [];
  const board = boardFor(definition);
  const route = board.routes[move.routeId];
  if (!route) return [];
  return availableInfluenceSlots(state, board, move.actorId).filter(id => route.influenceSlotIds.includes(id));
}
/** Only deterministic continuation steps are drained. Player choices persist in the existing action. */
export function advanceCityPatternContinuation(next: Mutable, definition: GameDefinition): void {
  const pending = next.cityPatternContinuation;
  if (!pending) return;
  const actorId = next.playerOrder![next.roundFlow!.turnIndex % definition.players.length]!;
  if (pending.kind === 'city-move') {
    if (next.cityMove!.status !== 'complete') return;
    if (pending.patternId === 'PAT-004' && patternRouteSlots(next, definition).length) return;
    pending.remainingMoves--;
    if (pending.remainingMoves > 0 && cityMoveOptionsFor(next, definition, actorId, next.roundFlow!.roundNumber).length) { readyMove(next, actorId); return; }
    delete next.cityMove;
  } else {
    if (next.construction!.status !== 'complete') return;
    if (pending.kind === 'deck-build') shufflePatternDeck(next);
    delete next.construction;
  }
  if (pending.kind !== 'declaration-build') next.roundFlow!.completedMajorAction = 'special';
  next.cityPatternContinuation = null; next.phase = 'round-control';
}
function shufflePatternDeck(next: Mutable): void {
  const supply = next.facilities!.supply;
  if (supply.revision === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'Cannot record the required deck shuffle');
  for (let i = supply.drawPile.length - 1; i > 0; i--) { const j = randomInt(i + 1); [supply.drawPile[i], supply.drawPile[j]] = [supply.drawPile[j]!, supply.drawPile[i]!]; }
  supply.revision++;
}
export function beginPatternCityMoves(next: Mutable, definition: GameDefinition, patternId: 'PAT-004' | 'PAT-006', actorId: string): void {
  next.roundFlow!.completedMajorAction = null;
  if (!cityMoveOptionsFor(next, definition, actorId, next.roundFlow!.roundNumber).length) { next.roundFlow!.completedMajorAction = 'special'; return; }
  next.cityPatternContinuation = { kind: 'city-move', patternId, remainingMoves: patternId === 'PAT-004' ? 1 : 2 };
  readyMove(next, actorId);
}
export function beginPatternConstruction(next: Mutable, definition: GameDefinition, kind: 'declaration-build' | 'deck-build', actorId: string): void {
  const source = kind === 'deck-build' ? 'draw-pile' : 'supply';
  if (!patternConstructionOptions(next, definition, actorId, source).choices.length) {
    if (kind === 'deck-build') { shufflePatternDeck(next); next.roundFlow!.completedMajorAction = 'special'; }
    return;
  }
  if (kind === 'deck-build') next.roundFlow!.completedMajorAction = null;
  next.cityPatternContinuation = kind === 'declaration-build' ? { kind, patternId: 'PAT-013' } : { kind, patternId: 'PAT-012' };
  next.phase = 'construction';
  next.construction = { actorId, roundNumber: next.roundFlow!.roundNumber, status: 'ready', constructionsCompleted: 0, builtCardId: null };
}
function pendingFor(input: GameState, definition: GameDefinition, actorId: string) {
  const state = parseGameState(input, definition), pending = state.cityPatternContinuation;
  if (!pending) return reject('PATTERN_CONTINUATION', 'No pending pattern continuation');
  if (state.playerOrder![state.roundFlow!.turnIndex % definition.players.length] !== actorId) return reject('WRONG_ACTOR', 'Only the scheduled owner can resolve this continuation');
  return { state, pending };
}
/** Private deck choices are visible only to the player currently entitled to search that deck. */
export function getCityPatternContinuationOptions(input: GameState, definition: GameDefinition, actorId: string) {
  const { state, pending } = pendingFor(input, definition, actorId);
  if (pending.kind !== 'city-move') return deepFreeze({ kind: pending.kind, patternId: pending.patternId, status: state.construction!.status,
    constructionOptions: state.construction!.status === 'ready' ? patternConstructionOptions(state, definition, actorId, pending.kind === 'deck-build' ? 'draw-pile' : 'supply') : null });
  const move = state.cityMove!, board = boardFor(definition);
  return deepFreeze({ kind: pending.kind, patternId: pending.patternId, status: move.status, remainingMoves: pending.remainingMoves,
    moveOptions: move.status === 'ready' ? cityMoveOptionsFor(state, definition, actorId, move.roundNumber) : [],
    finalSlotIds: move.status === 'final-influence' ? board.resourceNodes[move.targetNodeId!]!.influenceSlotIds.filter(id => state.board.influenceBySlot[id] === null && state.markerSupplyByPlayer[actorId]!.length) : [],
    routeSlotIds: move.status === 'complete' && pending.patternId === 'PAT-004' ? patternRouteSlots(state, definition) : [] });
}
export function getPendingPatternCityMoveRequirements(input: GameState, definition: GameDefinition, actorId: string, choiceId: string) {
  const { state, pending } = pendingFor(input, definition, actorId), move = state.cityMove;
  if (pending.kind !== 'city-move' || move?.status !== 'event-choice') return reject('PATTERN_CONTINUATION', 'No pending pattern movement event');
  return getEventChoiceRequirements(getGamePosition(state, definition), definition, { gameId: state.gameId, actorId, nodeId: move.targetNodeId!, cardId: move.cardId! }, choiceId);
}
const routeCommandSchema = z.strictObject({ gameId: gameEntityIdSchema, expectedVersion: z.number().int().nonnegative().safe(), type: z.literal('place-pattern-route-influence'), slotId: slotIdSchema });
/** Movement/event/final placement use the ordinary city-move endpoint; only this final route step is new. */
export function applyCityPatternContinuationCommand(input: GameState, definition: GameDefinition, context: { readonly authenticatedPlayerId: string }, payload: unknown): GameState {
  const { state, pending } = pendingFor(input, definition, context.authenticatedPlayerId), checked = routeCommandSchema.safeParse(payload);
  if (!checked.success) return reject('COMMAND_SCHEMA', checked.error.message);
  const command = checked.data;
  if (command.gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong game');
  if (command.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected version is stale');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  if (pending.kind !== 'city-move' || pending.patternId !== 'PAT-004' || state.cityMove!.status !== 'complete' || !patternRouteSlots(state, definition).includes(command.slotId)) return reject('ROUTE_SLOT', 'Complete movement first, then place on the actual traversed route');
  const next = gameStateSchema.parse(state), actorId = context.authenticatedPlayerId;
  next.board.influenceBySlot[command.slotId] = { markerId: next.markerSupplyByPlayer[actorId]!.shift()!, ownerPlayerId: actorId };
  // Consume exactly this additional placement, irrespective of other empty slots on that route.
  next.cityPatternContinuation = null; delete next.cityMove; next.phase = 'round-control'; next.roundFlow!.completedMajorAction = 'special';
  next.stateVersion++; return parseGameState(next, definition);
}
