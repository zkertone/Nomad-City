import type { RouteTollLeg } from './route-tolls.js';
import { loadFoundersBoard } from '../board/index.js';
import { gameStateSchema } from './schema.js';
import { getFoundersMapSide, getGamePosition, parseGameState } from './state.js';
import { finalExplorationSlots } from './exploration-rules.js';
import { getEventChoiceRequirements } from './settlement.js';
import type { GameDefinition, GameState } from './types.js';
import { explorationPlayerCommandSchema, quoteExplorationStep, resolveExplorationStep } from './exploration-engine.js';
import type { ExplorationPathStep } from './exploration-engine.js';
import { prepareActionWindow } from './action-window.js';
import type { OpenActionWindowOptions } from './action-window.js';

export class ExplorationCommandError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ExplorationCommandError'; }
}
const reject = (code: string, message: string): never => { throw new ExplorationCommandError(code, message); };
export type OpenExplorationWindowOptions = OpenActionWindowOptions;
export { explorationPathStepSchema, explorationPlayerCommandSchema } from './exploration-engine.js';
export type { ExplorationPathStep, ExplorationPlayerCommand } from './exploration-engine.js';
export interface ExplorationActorContext { readonly authenticatedPlayerId: string }
export type ExplorationTollLeg = RouteTollLeg;
export interface ExplorationTollQuote { readonly total: number; readonly legs: readonly ExplorationTollLeg[] }

function nextVersion(version: number): number {
  if (version === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return version + 1;
}
/**
 * TRUSTED orchestration boundary granting exactly one exploration. The future round owner must
 * authorize the actor/round/major-action slot before calling. This is not a player command or
 * an implementation of role placement, clockwise turns, quick actions or two action cycles.
 */
export function openExplorationWindow(input: GameState, definition: GameDefinition, rawOptions: OpenExplorationWindowOptions): GameState {
  const prepared = prepareActionWindow(input, definition, rawOptions, reject);
  return parseGameState({ ...prepared.position, ...prepared.facilityFields, ...prepared.roundFields, schemaVersion: prepared.previousFormat === '1.12.0' ? '1.12.0' : prepared.previousFormat === '1.11.0' ? '1.11.0' : prepared.previousFormat === '1.10.0' ? '1.10.0' : prepared.previousFormat === '1.9.0' ? '1.9.0' : prepared.previousFormat === '1.8.0' ? '1.8.0' : prepared.previousFormat === '1.7.0' ? '1.7.0' : prepared.previousFormat === '1.6.0' ? '1.6.0' : prepared.previousFormat === '1.5.0' ? '1.5.0' : prepared.previousFormat === '1.4.0' ? '1.4.0' : prepared.previousFormat === '1.3.0' ? '1.3.0' : '1.2.0',
    stateVersion: prepared.stateVersion, phase: 'exploration', eventDecks: prepared.eventDecks, playerOrder: prepared.playerOrder,
    exploration: { actorId: prepared.options.actorId, roundNumber: prepared.options.roundNumber, status: 'ready',
      targetNodeId: null, cardId: null, resolvedChoiceId: null } }, definition);
}

function readyState(input: GameState, definition: GameDefinition, actorId: string) {
  const state = parseGameState(input, definition);
  if (state.phase !== 'exploration' || !state.exploration || state.exploration.status !== 'ready') return reject('ACTION_STAGE', 'No granted exploration is ready');
  if (state.exploration.actorId !== actorId) return reject('WRONG_ACTOR', 'Only the granted actor may explore');
  return state;
}

/** Ordered node/route walk from the actual city; coordinates and intermediate discovery never gate travel. */
export function getExplorationTollQuote(input: GameState, definition: GameDefinition, actorId: string, nodeId: string, rawPath: readonly ExplorationPathStep[]): ExplorationTollQuote {
  const state = readyState(input, definition, actorId);
  return quoteExplorationStep(state, definition, state.exploration!, nodeId, rawPath, reject);
}

export function getExplorationFinalSlotIds(input: GameState, definition: GameDefinition, actorId: string): readonly string[] {
  const state = parseGameState(input, definition); const progress = state.exploration;
  if (state.phase !== 'exploration' || progress?.status !== 'final-influence' || progress.actorId !== actorId) return Object.freeze([]);
  return Object.freeze(finalExplorationSlots(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, progress.targetNodeId!));
}
export function getPendingExplorationChoiceRequirements(input: GameState, definition: GameDefinition, actorId: string, choiceId: string) {
  const state = parseGameState(input, definition); const progress = state.exploration;
  if (state.phase !== 'exploration' || progress?.status !== 'event-choice') return reject('ACTION_STAGE', 'No exploration event choice is pending');
  if (progress.actorId !== actorId) return reject('WRONG_ACTOR', 'Only the event actor may query this choice');
  return getEventChoiceRequirements(getGamePosition(state, definition), definition,
    { gameId: state.gameId, actorId, nodeId: progress.targetNodeId!, cardId: progress.cardId! }, choiceId);
}

/** Identity is supplied by a trusted adapter; payload never selects actor, round, deck or reward. */
export function applyExplorationCommand(input: GameState, definition: GameDefinition, context: ExplorationActorContext, payload: unknown): GameState {
  const current = parseGameState(input, definition);
  const parsed = explorationPlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data;
  if (command.gameId !== current.gameId) return reject('GAME_REFERENCE', 'Wrong game');
  if (command.expectedVersion !== current.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const progress = current.exploration;
  if (current.phase !== 'exploration' || !progress || progress.status === 'complete') return reject('ACTION_STAGE', 'No unfinished exploration grant');
  if (progress.actorId !== context.authenticatedPlayerId) return reject('WRONG_ACTOR', 'Only the granted actor may act');
  const next = gameStateSchema.parse(current);
  resolveExplorationStep(next, definition, next.exploration!, command, reject);
  next.stateVersion = nextVersion(current.stateVersion);
  return parseGameState(next, definition);
}
