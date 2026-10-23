import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { gameEntityIdSchema, gameStateSchema } from './schema.js';
import { parseGameState } from './state.js';
import { preparePhaseWindow } from './action-window.js';
import { openDeploymentWindow, openDispatchWindow } from './influence-actions.js';
import { openExplorationWindow } from './exploration.js';
import { openCityMoveWindow } from './city-move.js';
import { openConstructionWindow } from './construction.js';
import { createFoundersFacilitySupply, replenishFacilitySupply, facilitySupplyStateSchema, getFacilitySupplyPublicView } from '../facilities/supply.js';
import { createInitialFacilityPanels } from '../facilities/panel-state.js';
import { baseRoleIdSchema, FOUNDERS_BASE_ROLES } from './round-schema.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';

export class RoundFlowError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'RoundFlowError'; }
}
const reject = (code: string, message: string): never => { throw new RoundFlowError(code, message); };
const version = z.number().int().nonnegative().safe();
const beginOptionsSchema = z.strictObject({ expectedVersion: version, facilityDeckOrder: z.array(z.string().min(1)).length(41),
  deckOrder: z.strictObject({ yellow: z.array(z.string().regex(/^Y\d{2}$/)).max(10), red: z.array(z.string().regex(/^R\d{2}$/)).max(6) }).optional(),
});
export type BeginRoundFlowOptions = DeepReadonly<z.infer<typeof beginOptionsSchema>>;
export interface RoundActorContext { readonly authenticatedPlayerId: string }
const envelope = { gameId: gameEntityIdSchema, expectedVersion: version };
export const roundPlayerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('remove-round-supply-card'), cardId: z.string().min(1) }),
  z.strictObject({ ...envelope, type: z.literal('place-round-role'), roleId: baseRoleIdSchema }),
  z.strictObject({ ...envelope, type: z.literal('choose-major-action'), action: z.enum(['deploy', 'dispatch', 'explore', 'city-move', 'construct']) }),
  z.strictObject({ ...envelope, type: z.literal('cancel-major-preparation') }),
  z.strictObject({ ...envelope, type: z.literal('finish-player-turn') }),
]);
export type RoundPlayerCommand = DeepReadonly<z.infer<typeof roundPlayerCommandSchema>>;

/** Start a known-new managed game only after real entry. Does not infer any legacy round history. */
export function beginRoundFlow(input: GameState, definition: GameDefinition, rawOptions: BeginRoundFlowOptions): GameState {
  const state = parseGameState(input, definition), checked = beginOptionsSchema.safeParse(rawOptions);
  if (!checked.success) return reject('OPTIONS_SCHEMA', checked.error.message);
  const options = checked.data;
  if (options.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.phase !== 'entry' || state.entry?.status !== 'complete') return reject('ROUND_START', 'Managed rounds start once, immediately after completed entry');
  const prepared = preparePhaseWindow(state, definition, { roundNumber: 1, expectedVersion: options.expectedVersion,
    ...(options.deckOrder ? { deckOrder: options.deckOrder } : {}) }, reject);
  let supply;
  try { supply = createFoundersFacilitySupply({ gameId: state.gameId, playerIds: definition.players.map(player => player.id), deckOrder: options.facilityDeckOrder }); }
  catch (error) { return reject('FACILITY_SETUP', error instanceof Error ? error.message : String(error)); }
  return parseGameState({ ...prepared.position, schemaVersion: '1.7.0', phase: 'round-control', stateVersion: prepared.stateVersion,
    playerOrder: prepared.playerOrder, eventDecks: prepared.eventDecks, facilities: { supply, panels: createInitialFacilityPanels(supply) },
    roundFlow: { roundNumber: 1, stage: definition.players.length === 2 ? 'role-removal' : 'role-placement', supplyRemovalCount: 0,
      rolePlacementCount: 0, turnIndex: 0, majorActionOpened: false,
      rolesByPlayer: definition.players.map(player => ({ playerId: player.id, hand: FOUNDERS_BASE_ROLES.map(role => role.id), discarded: [], placed: null })) },
  }, definition);
}

function checkedRound(input: GameState, definition: GameDefinition) {
  const state = parseGameState(input, definition);
  if (!state.roundFlow) return reject('ROUND_REQUIRED', 'This snapshot has no managed round schedule');
  return state;
}
function currentActor(state: GameState, playerCount: number): string | null {
  const flow = state.roundFlow!;
  if (flow.stage === 'role-removal') return state.playerOrder![flow.supplyRemovalCount]!;
  if (flow.stage === 'role-placement') return state.playerOrder![flow.rolePlacementCount]!;
  return flow.stage === 'player-actions' ? state.playerOrder![flow.turnIndex % playerCount]! : null;
}
function actionComplete(state: GameState): boolean {
  const action = state.phase === 'exploration' ? state.exploration : state.phase === 'city-move' ? state.cityMove
    : state.phase === 'influence-action' ? state.influenceAction : state.phase === 'construction' ? state.construction : undefined;
  return action?.status === 'complete';
}
function actionUnstarted(state: GameState): boolean {
  if (state.phase === 'exploration') return state.exploration?.status === 'ready';
  if (state.phase === 'city-move') return state.cityMove?.status === 'ready';
  if (state.phase === 'construction') return state.construction?.status === 'ready';
  return state.phase === 'influence-action' && state.influenceAction?.status === 'ready' && state.influenceAction.operationsCompleted === 0;
}
/** Returns current scheduling facts only. Unsupported quick actions are not treated as executed. */
export function getRoundTurn(input: GameState, definition: GameDefinition) {
  const state = checkedRound(input, definition), flow = state.roundFlow!;
  return deepFreeze({ roundNumber: flow.roundNumber, stage: flow.stage, actorId: currentActor(state, definition.players.length),
    cycle: flow.stage === 'player-actions' ? Math.floor(flow.turnIndex / definition.players.length) + 1 : null,
    majorActionStatus: flow.stage !== 'player-actions' ? null : !flow.majorActionOpened ? 'not-started' : actionComplete(state) ? 'complete' : 'pending',
  });
}

/** No actor, round, quota, role effects or economic outcomes can be supplied by the player. */
export function applyRoundCommand(input: GameState, definition: GameDefinition, context: RoundActorContext, payload: unknown): GameState {
  const state = checkedRound(input, definition), parsed = roundPlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data, flow = state.roundFlow!;
  if (command.gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong round game');
  if (command.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const actorId = currentActor(state, definition.players.length);
  if (actorId === null || context.authenticatedPlayerId !== actorId) return reject('WRONG_ACTOR', 'Only the scheduled player may act');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  if (command.type === 'choose-major-action') {
    if (flow.stage !== 'player-actions' || state.phase !== 'round-control' || flow.majorActionOpened) return reject('MAJOR_ACTION_USED', 'One major action per turn, after every role is placed');
    const options = { actorId, roundNumber: flow.roundNumber, expectedVersion: state.stateVersion };
    switch (command.action) {
      case 'deploy': return openDeploymentWindow(state, definition, options);
      case 'dispatch': return openDispatchWindow(state, definition, options);
      case 'explore': return openExplorationWindow(state, definition, options);
      case 'city-move': return openCityMoveWindow(state, definition, options);
      case 'construct': return openConstructionWindow(state, definition, options);
    }
  }
  const next = gameStateSchema.parse(state), progress = next.roundFlow!;
  if (command.type === 'remove-round-supply-card') {
    if (flow.stage !== 'role-removal' || state.phase !== 'round-control') return reject('ROUND_STAGE', 'Only two-player pre-placement removal accepts this command');
    const supply = next.facilities!.supply, index = supply.supply.indexOf(command.cardId);
    if (index < 0) return reject('CARD_SOURCE', 'Choose a current supply card');
    if (supply.supply.length !== 6 || !supply.drawPile.length) return reject('REFILL_UNRESOLVED', 'Cannot complete the required immediate refill');
    if (supply.revision === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'Supply version exhausted');
    supply.supply.splice(index, 1); supply.returnedToBox.push(command.cardId);
    const refill = replenishFacilitySupply(supply, supply.revision);
    if (refill.status !== 'replenished') return reject('REFILL_UNRESOLVED', 'Required immediate refill did not finish');
    next.facilities!.supply = facilitySupplyStateSchema.parse(refill.state);
    progress.supplyRemovalCount++;
    if (progress.supplyRemovalCount === 2) progress.stage = 'role-placement';
  } else if (command.type === 'place-round-role') {
    if (flow.stage !== 'role-placement' || state.phase !== 'round-control') return reject('ROUND_STAGE', 'Place one facedown role during placement');
    const roles = progress.rolesByPlayer.find(row => row.playerId === actorId)!;
    // p05/p11: recover the discard only when the hand is empty, before choosing this round's role.
    if (!roles.hand.length) roles.hand.push(...roles.discarded.splice(0));
    const index = roles.hand.indexOf(command.roleId);
    if (index < 0) return reject('ROLE_NOT_IN_HAND', 'Selected role must be in the current hand');
    roles.placed = roles.hand.splice(index, 1)[0]!;
    progress.rolePlacementCount++;
    if (progress.rolePlacementCount === definition.players.length) progress.stage = 'player-actions';
  } else {
    if (command.type === 'cancel-major-preparation') {
      if (flow.stage !== 'player-actions' || !flow.majorActionOpened || !actionUnstarted(state)) return reject('ACTION_STARTED', 'Only preparation with zero performed operations can be canceled');
    } else {
      if (flow.stage !== 'player-actions' || !flow.majorActionOpened || !actionComplete(state)) return reject('ACTION_PENDING', 'Finish exactly one major action before ending this turn');
      progress.turnIndex++;
      if (progress.turnIndex === definition.players.length * 2) progress.stage = 'harvest';
    }
    progress.majorActionOpened = false;
    delete next.exploration; delete next.cityMove; delete next.influenceAction; delete next.construction;
    next.phase = 'round-control';
  }
  next.stateVersion++;
  return parseGameState(next, definition);
}

const finishOptionsSchema = z.strictObject({ expectedVersion: version });
/** Trusted automatic cleanup for currently supported effects only. No client may assert cleanup finished. */
export function finishManagedRound(input: GameState, definition: GameDefinition, rawOptions: DeepReadonly<z.infer<typeof finishOptionsSchema>>): GameState {
  const state = checkedRound(input, definition), checked = finishOptionsSchema.safeParse(rawOptions);
  if (!checked.success) return reject('OPTIONS_SCHEMA', checked.error.message);
  if (checked.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.roundFlow!.stage !== 'harvest' || state.phase !== 'harvest' || state.harvest?.status !== 'complete') return reject('HARVEST_PENDING', 'Every player must finish harvest before cleanup');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  // Implemented role modes have no delayed effect; validation rejects unsupported modes/facilities.
  const next = gameStateSchema.parse(state), flow = next.roundFlow!;
  for (const role of flow.rolesByPlayer) {
    if (role.placed !== null) role.hand.push(role.placed);
    role.placed = null;
    if (role.used !== undefined) role.used = null;
  }
  next.playerOrder!.push(next.playerOrder!.shift()!);
  next.phase = 'round-control'; delete next.harvest;
  flow.supplyRemovalCount = 0; flow.rolePlacementCount = 0; flow.turnIndex = 0; flow.majorActionOpened = false;
  if (flow.roundNumber === 8) flow.stage = 'finished';
  else { flow.roundNumber++; flow.stage = definition.players.length === 2 ? 'role-removal' : 'role-placement'; }
  next.stateVersion++;
  return parseGameState(next, definition);
}

/** Role-only/public-supply allowlist; never expose private hands, facedown opponents or draw order. */
export function getRoundPublicView(input: GameState, definition: GameDefinition, viewerPlayerId: string) {
  const state = checkedRound(input, definition);
  if (!definition.players.some(player => player.id === viewerPlayerId)) return reject('VIEWER_REFERENCE', 'Viewer must be a registered player');
  return deepFreeze({ gameId: state.gameId, stateVersion: state.stateVersion, ...getRoundTurn(state, definition), playerOrder: state.playerOrder!,
    roles: state.roundFlow!.rolesByPlayer.map(role => ({ playerId: role.playerId, handCount: role.hand.length, discarded: role.discarded,
      hasPlacedRole: role.placed !== null, ...(role.used !== undefined ? { usedRole: role.used } : {}),
      ...(role.playerId === viewerPlayerId ? { hand: role.hand, placedRoleId: role.placed } : {}) })),
    facilitySupply: getFacilitySupplyPublicView(state.facilities!.supply),
  });
}
