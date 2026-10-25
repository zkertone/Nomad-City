import { z } from 'zod';
import { returnTemporarySettlements } from './temporary-settlements.js';
import { slotIdSchema } from '../board/schema.js';
import { loadFoundersBoard } from '../board/index.js';
import { deepFreeze } from '../board/hash.js';
import { CITY_PATTERNS_HASH, getCityPattern, selectCityPatterns } from '../patterns/catalog.js';
import { cityPatternIdSchema } from '../patterns/schema.js';
import { findCityPatternMatches, getCityPatternBoard, matchCityPatternSelection } from '../patterns/matching.js';
import { gameEntityIdSchema, gameStateSchema } from './schema.js';
import { getFoundersMapSide, parseGameState } from './state.js';
import { getRoundTurn } from './round.js';
import { getCityPatternActionSupport } from './city-pattern-rules.js';
import { beginPatternCityMoves, beginPatternConstruction } from './city-pattern-continuations.js';
import { patternSpecialAllowed, markPatternSpecialChild, beginPatternMajorActions } from './city-pattern-major-actions.js';
import { availableInfluenceSlots, availableTargetInfluenceSlots, emptyInfluenceSlots, dispatchSourceSlots, replaceBoardInfluence, returnBoardInfluence } from './influence.js';
import type { GameDefinition, GameState, DeepReadonly } from './types.js';

export class CityPatternActionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CityPatternActionError'; }
}
const reject = (code: string, message: string): never => { throw new CityPatternActionError(code, message); };
const version = z.number().int().nonnegative().safe();
const setupSchema = z.strictObject({ expectedVersion: version, gameplayVersion: z.literal('base'), patternOrder: z.array(cityPatternIdSchema).optional() });
/** Trusted initialization on a known-new managed game; never infer missing declaration history. */
export function enableCityPatterns(input: GameState, definition: GameDefinition, options: DeepReadonly<z.infer<typeof setupSchema>>): GameState {
  const state = parseGameState(input, definition), checked = setupSchema.safeParse(options);
  if (!checked.success) return reject('OPTIONS_SCHEMA', checked.error.message);
  if (checked.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected version is stale');
  if (state.schemaVersion !== '1.12.0' || state.phase !== 'round-control' || state.roundFlow?.roundNumber !== 1 || state.roundFlow.rolePlacementCount !== 0 || state.roundFlow.supplyRemovalCount !== 0 || state.facilities!.panels.some(panel => panel.placements.length !== 1)) return reject('PATTERN_INITIALIZATION', 'Initialize exactly once before the first role/removal of a known-new 1.12.0 game');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  let publicPatternIds; try { publicPatternIds = selectCityPatterns('base', definition.players.length, checked.data.patternOrder); } catch (error) { return reject('PATTERN_ORDER', String(error)); }
  return parseGameState({ ...state, schemaVersion: '1.13.0', stateVersion: state.stateVersion + 1, patternMarkers: [],
    cityPatterns: { gameplayVersion: 'base', catalogHash: CITY_PATTERNS_HASH, publicPatternIds,
      exhaustedFacilityIdsByPlayer: Object.fromEntries(definition.players.map(player => [player.id, []])), useTracks: [], usedSpecialActions: [] } }, definition);
}
const envelope = { gameId: gameEntityIdSchema, expectedVersion: version };
const moveSchema = z.strictObject({ sourceSlotId: slotIdSchema, targetSlotId: slotIdSchema });
const tacticalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('replace'), costDecision: z.enum(['pay', 'decline']), slotId: slotIdSchema.optional() }),
  z.strictObject({ kind: z.literal('place'), slotId: slotIdSchema.optional() }),
  z.strictObject({ kind: z.literal('remove'), slotId: slotIdSchema.optional() }),
]);
const effectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('replace'), slotId: slotIdSchema.optional() }),
  z.strictObject({ kind: z.literal('military'), slotIds: z.array(slotIdSchema).max(3) }),
  z.strictObject({ kind: z.literal('security'), choices: z.array(tacticalSchema).length(2) }),
  z.strictObject({ kind: z.literal('outpost'), slotIds: z.array(slotIdSchema).max(2), moves: z.array(moveSchema).max(29) }),
  z.strictObject({ kind: z.literal('composite-move'), orirock: z.number().int().min(0).max(3), iron: z.number().int().min(0).max(3) }),
  z.strictObject({ kind: z.literal('double-move') }),
  z.strictObject({ kind: z.literal('deck-construction') }),
  z.strictObject({ kind: z.literal('industry-actions') }),
  z.strictObject({ kind: z.literal('commercial-action'), reward: z.enum(['columbia-voucher', 'orirock', 'originium', 'iron']) }),
  z.strictObject({ kind: z.literal('command-action') }),
]);
export const cityPatternPlayerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('declare-city-pattern'), patternId: cityPatternIdSchema,
    facilityCardIds: z.array(z.string().min(1)).min(2).max(6), returnTemporaryFacilityIds: z.array(z.string().min(1)).max(1).optional(), returnMarkerId: z.string().min(1).optional() }),
  z.strictObject({ ...envelope, type: z.literal('use-pattern-special'), patternId: cityPatternIdSchema, markerId: z.string().min(1), effect: effectSchema }),
]);
export type CityPatternPlayerCommand = DeepReadonly<z.infer<typeof cityPatternPlayerCommandSchema>>;
function scheduled(input: GameState, definition: GameDefinition, actorId: string) {
  const state = parseGameState(input, definition);
  if (!['1.13.0', '1.14.0', '1.15.0', '1.16.0', '1.17.0'].includes(state.schemaVersion)) return reject('PATTERN_FORMAT', 'Explicitly initialize city patterns');
  const turn = getRoundTurn(state, definition);
  if (turn.stage !== 'player-actions' || turn.actorId !== actorId) return reject('PATTERN_WINDOW', 'Only the scheduled player can act');
  return { state, turn };
}
function retireCompletedAction(next: z.infer<typeof gameStateSchema>): void {
  if (next.phase === 'round-control') return;
  next.roundFlow!.completedMajorAction = next.phase === 'construction' ? 'construct' : next.phase === 'exploration' ? 'explore' : next.phase === 'city-move' ? 'city-move' : next.influenceAction!.kind;
  delete next.construction; delete next.exploration; delete next.cityMove; delete next.influenceAction; next.phase = 'round-control';
}
export function getCityPatternDeclarationOptions(input: GameState, definition: GameDefinition, actorId: string) {
  const { state, turn } = scheduled(input, definition, actorId), panel = state.facilities!.panels.find(row => row.playerId === actorId)!;
  if (turn.majorActionStatus === 'pending') return deepFreeze([]);
  const board = getCityPatternBoard(panel, state.facilities!.supply, state.cityPatterns!.exhaustedFacilityIdsByPlayer[actorId]);
  return deepFreeze(state.cityPatterns!.publicPatternIds.map(patternId => ({ patternId,
    supported: getCityPatternActionSupport(state.schemaVersion).declarationPatternIds.includes(patternId),
    hasAvailableMarker: state.markerSupplyByPlayer[actorId]!.length > 0, matches: findCityPatternMatches(board, patternId) })));
}
/** Advisory first-step choices only; sequential targets are revalidated after every private effect. */
export function getCityPatternSpecialOptions(input: GameState, definition: GameDefinition, actorId: string) {
  const { state, turn } = scheduled(input, definition, actorId);
  if (turn.majorActionStatus !== 'not-started' || !patternSpecialAllowed(state)) return deepFreeze([]);
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  return deepFreeze(state.cityPatterns!.publicPatternIds.filter(patternId => getCityPatternActionSupport(state.schemaVersion).specialActionPatternIds.includes(patternId)).flatMap(patternId => {
    const pattern = getCityPattern(patternId), markers = state.patternMarkers!.filter(row => row.ownerPlayerId === actorId && row.patternId === patternId);
    const track = state.cityPatterns!.useTracks.find(row => row.playerId === actorId && row.patternId === patternId);
    if (!markers.length || !track?.remainingUses || state.cityPatterns!.usedSpecialActions.some(row => row.playerId === actorId && row.patternId === patternId) || (pattern.forbidsRoleInTurn && state.roundFlow!.rolesByPlayer.some(role => role.playerId === actorId && role.used?.turnIndex === state.roundFlow!.turnIndex))) return [];
    return [{ patternId, markerIds: markers.map(row => row.markerId), remainingUses: track.remainingUses,
      markerCount: markers.length, placementSlotIds: availableInfluenceSlots(state, board, actorId),
      cityPlacementSlotIds: availableTargetInfluenceSlots(state, board, actorId, state.board.cityNodeByPlayer[actorId]!),
      moveSourceSlotIds: dispatchSourceSlots(state, board, actorId),
      occupiedSlotIds: Object.entries(state.board.influenceBySlot).filter(([, marker]) => marker !== null).map(([id]) => id) }];
  }));
}
/** Atomic quick declaration or complete special action; clients cannot set actor, score, costs or quotas. */
export function applyCityPatternCommand(input: GameState, definition: GameDefinition, context: { readonly authenticatedPlayerId: string }, payload: unknown): GameState {
  const { state, turn } = scheduled(input, definition, context.authenticatedPlayerId), checked = cityPatternPlayerCommandSchema.safeParse(payload);
  if (!checked.success) return reject('COMMAND_SCHEMA', checked.error.message);
  const command = checked.data, actorId = turn.actorId!;
  if (command.gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong game');
  if (command.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected version is stale');
  if (!state.cityPatterns!.publicPatternIds.includes(command.patternId)) return reject('PATTERN_NOT_PUBLIC', 'Choose one of the public city patterns');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  const pattern = getCityPattern(command.patternId), next = gameStateSchema.parse(state), actor = next.players[actorId]!;
  const gain = (asset: keyof typeof actor.balances, amount: number) => {
    if (!Number.isSafeInteger(actor.balances[asset] + amount)) return reject('BALANCE_OVERFLOW', 'Pattern reward exceeds safe integer range');
    actor.balances[asset] += amount;
  };
  if (command.type === 'declare-city-pattern') {
    if (command.returnTemporaryFacilityIds !== undefined && state.schemaVersion !== '1.16.0') return reject('TEMPORARY_FORMAT', 'Returning temporary facilities requires explicit snapshot 1.16.0');
    if (turn.majorActionStatus === 'pending') return reject('ACTION_PENDING', 'Quick declaration cannot interrupt a major action');
    if (!getCityPatternActionSupport(state.schemaVersion).declarationPatternIds.includes(command.patternId)) return reject('PATTERN_EFFECT_UNSUPPORTED', 'This declaration needs its complete construction continuation');
    if (!next.markerSupplyByPlayer[actorId]!.length) return reject('NO_AVAILABLE_MARKER', 'A declaration requires a supply marker before rewards');
    const panel = state.facilities!.panels.find(row => row.playerId === actorId)!, exhausted = state.cityPatterns!.exhaustedFacilityIdsByPlayer[actorId]!;
    if (!matchCityPatternSelection(getCityPatternBoard(panel, state.facilities!.supply, exhausted), command.patternId, command.facilityCardIds)) return reject('PATTERN_LAYOUT', 'Select exactly one unused, owned, valid facility layout');
    if ((pattern.declarationEffect === 'exchange-pattern-marker') !== (command.returnMarkerId !== undefined)) return reject('PATTERN_CHOICE', 'Provide the marker choice only for the management-center exchange');
    retireCompletedAction(next);
    next.cityPatterns!.exhaustedFacilityIdsByPlayer[actorId]!.push(...command.facilityCardIds);
    const markerId = next.markerSupplyByPlayer[actorId]!.shift()!;
    next.patternMarkers!.push({ markerId, ownerPlayerId: actorId, patternId: pattern.id });
    if (!next.cityPatterns!.useTracks.some(track => track.playerId === actorId && track.patternId === pattern.id)) next.cityPatterns!.useTracks.push({ playerId: actorId, patternId: pattern.id, remainingUses: pattern.useCapacity });
    if (!Number.isSafeInteger(actor.score + pattern.printedScore)) return reject('SCORE_OVERFLOW', 'Pattern score exceeds safe integer range');
    actor.score += pattern.printedScore;
    if (pattern.declarationEffect === 'gain-resources') for (const asset of ['orirock', 'originium', 'iron'] as const) gain(asset, 1);
    if (pattern.declarationEffect === 'exchange-pattern-marker') {
      // The newly placed level-I marker may itself be exchanged; all costs still precede this reward.
      const index = next.patternMarkers!.findIndex(row => row.markerId === command.returnMarkerId && row.ownerPlayerId === actorId && getCityPattern(row.patternId).level === 1);
      if (index < 0) return reject('PATTERN_MARKER_TARGET', 'Return one of your actual level-I pattern markers');
      next.markerSupplyByPlayer[actorId]!.push(next.patternMarkers!.splice(index, 1)[0]!.markerId); gain('pure-originium', 1);
    }
    returnTemporarySettlements(next, actorId, command.facilityCardIds, command.returnTemporaryFacilityIds ?? [], reject);
    if (command.patternId === 'PAT-013') {
      beginPatternConstruction(next, definition, 'declaration-build', actorId);
      if (next.schemaVersion === '1.16.0' && next.cityPatternContinuation?.kind === 'declaration-build') {
        next.cityPatternContinuation.declarationFacilityPlacements = panel.placements.filter(p => command.facilityCardIds.includes(p.cardId)).map(p => ({ ...p }));
      }
    }
  } else {
    if (turn.majorActionStatus !== 'not-started' || state.phase !== 'round-control') return reject('MAJOR_ACTION_USED', 'A special replaces the one normal major action');
    if (!patternSpecialAllowed(state)) return reject('PATTERN_SPECIAL_FORBIDDEN', 'This granted action excludes special actions');
    if (!getCityPatternActionSupport(state.schemaVersion).specialActionPatternIds.includes(command.patternId)) return reject('PATTERN_SPECIAL_UNSUPPORTED', 'This special needs its full nested action implementation');
    const marker = next.patternMarkers!.find(row => row.markerId === command.markerId && row.ownerPlayerId === actorId && row.patternId === command.patternId);
    const track = next.cityPatterns!.useTracks.find(row => row.playerId === actorId && row.patternId === command.patternId);
    if (!marker || !track?.remainingUses) return reject('PATTERN_SPECIAL_LOCKED', 'Use your own marker with remaining charges');
    if (next.cityPatterns!.usedSpecialActions.some(row => row.patternId === command.patternId && row.playerId === actorId)) return reject('PATTERN_ALREADY_USED', 'This player already used this pattern this round');
    const role = state.roundFlow!.rolesByPlayer.find(row => row.playerId === actorId)!;
    if (pattern.forbidsRoleInTurn && role.used?.turnIndex === state.roundFlow!.turnIndex) return reject('ROLE_CONFLICT', 'A role was already used in this action turn');
    const expected = ({ 'PAT-001': 'replace', 'PAT-005': 'military', 'PAT-009': 'security', 'PAT-011': 'outpost', 'PAT-004': 'composite-move', 'PAT-006': 'double-move', 'PAT-012': 'deck-construction', 'PAT-003': 'industry-actions', 'PAT-008': 'commercial-action', 'PAT-010': 'command-action' } as Record<string, string>)[command.patternId];
    if (command.effect.kind !== expected) return reject('PATTERN_CHOICE', 'Effect choice must belong to the selected pattern');
    const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
    const place = (slotId: string | undefined, nodeId?: string) => {
      const slots = nodeId ? availableTargetInfluenceSlots(next, board, actorId, nodeId) : availableInfluenceSlots(next, board, actorId);
      if (!slots.length) { if (slotId !== undefined) return reject('PLACEMENT_TARGET', 'No placement is executable'); return; }
      if (!slotId || !slots.includes(slotId)) return reject('PLACEMENT_REQUIRED', 'Choose each executable placement target');
      next.board.influenceBySlot[slotId] = { markerId: next.markerSupplyByPlayer[actorId]!.shift()!, ownerPlayerId: actorId };
    };
    const effect = command.effect;
    if (effect.kind === 'replace') replaceBoardInfluence(next, board, actorId, effect.slotId, reject);
    else if (effect.kind === 'military') {
      const count = Math.min(3, next.patternMarkers!.filter(row => row.patternId === command.patternId && row.ownerPlayerId === actorId).length);
      if (effect.slotIds.length > count) return reject('PATTERN_CHOICE', 'Too many military placements');
      for (let i = 0; i < count; i++) place(effect.slotIds[i]);
    } else if (effect.kind === 'security') {
      for (const choice of effect.choices) {
        if (choice.kind === 'replace') {
          if (choice.costDecision === 'decline') { if (choice.slotId !== undefined) return reject('PATTERN_CHOICE', 'Declining the conditional cost has no target'); continue; }
          if (actor.balances.orirock < 2 || actor.balances.iron < 1) return reject('CANNOT_PAY', 'Pay two orirock and one iron before replacement');
          actor.balances.orirock -= 2; actor.balances.iron--;
          replaceBoardInfluence(next, board, actorId, choice.slotId, reject);
        } else if (choice.kind === 'place') { place(choice.slotId); gain('originium', 1); }
        else {
          const occupied = Object.entries(next.board.influenceBySlot).filter(([, value]) => value !== null).map(([id]) => id);
          if (occupied.length) {
            if (!choice.slotId || !occupied.includes(choice.slotId)) return reject('REMOVAL_REQUIRED', 'Choose an existing influence to remove');
            returnBoardInfluence(next, choice.slotId);
          } else if (choice.slotId !== undefined) return reject('REMOVAL_TARGET', 'No influence can be removed');
          gain('iron', 2);
        }
      }
    } else if (effect.kind === 'outpost') {
      for (let i = 0; i < 2; i++) place(effect.slotIds[i], next.board.cityNodeByPlayer[actorId]!);
      const count = next.patternMarkers!.filter(row => row.patternId === command.patternId && row.ownerPlayerId === actorId).length;
      if (effect.moves.length > count) return reject('PATTERN_CHOICE', 'Too many outpost movements');
      for (let i = 0; i < count; i++) {
        const sources = dispatchSourceSlots(next, board, actorId), move = effect.moves[i];
        if (!sources.length) { if (move) return reject('MOVE_SOURCE', 'No movement is executable'); continue; }
        if (!move || !sources.includes(move.sourceSlotId)) return reject('MOVE_REQUIRED', 'Choose each executable own influence movement');
        if (!emptyInfluenceSlots(next, board, actorId).includes(move.targetSlotId)) return reject('MOVE_TARGET', 'Move to a legal empty slot');
        const influence = next.board.influenceBySlot[move.sourceSlotId]!;
        next.board.influenceBySlot[move.sourceSlotId] = null; next.board.influenceBySlot[move.targetSlotId] = influence;
      }
    }
    markPatternSpecialChild(next, command.patternId);
    track.remainingUses--;
    next.cityPatterns!.usedSpecialActions.push({ playerId: actorId, patternId: command.patternId, turnIndex: next.roundFlow!.turnIndex });
    next.roundFlow!.majorActionOpened = true; next.roundFlow!.completedMajorAction = 'special';
    if (effect.kind === 'composite-move') {
      if (effect.orirock + effect.iron !== 3) return reject('PATTERN_CHOICE', 'Pay a combined three orirock/iron');
      if (actor.balances.originium < 1 || actor.balances.orirock < effect.orirock || actor.balances.iron < effect.iron) return reject('CANNOT_PAY', 'Pay the complete special cost before moving');
      actor.balances.originium--; actor.balances.orirock -= effect.orirock; actor.balances.iron -= effect.iron;
      beginPatternCityMoves(next, definition, 'PAT-004', actorId);
    } else if (effect.kind === 'double-move') {
      if (actor.balances.originium < 3) return reject('CANNOT_PAY', 'Pay three originium before either free movement');
      actor.balances.originium -= 3; beginPatternCityMoves(next, definition, 'PAT-006', actorId);
    } else if (effect.kind === 'deck-construction') {
      if (!Number.isSafeInteger(actor.score - 1)) return reject('SCORE_OVERFLOW', 'Cannot lose one point safely');
      actor.score--; beginPatternConstruction(next, definition, 'deck-build', actorId);
    } else if (effect.kind === 'industry-actions') {
      if (actor.balances['columbia-voucher'] < 6) return reject('CANNOT_PAY', 'Pay six vouchers before granting either extra action');
      actor.balances['columbia-voucher'] -= 6; beginPatternMajorActions(next, 'PAT-003');
    } else if (effect.kind === 'commercial-action') {
      gain(effect.reward, effect.reward === 'columbia-voucher' ? 4 : 1); beginPatternMajorActions(next, 'PAT-008');
    } else if (effect.kind === 'command-action') {
      beginPatternMajorActions(next, 'PAT-010');
    }
  }
  next.stateVersion++;
  return parseGameState(next, definition);
}
export function getCityPatternPublicView(input: GameState, definition: GameDefinition) {
  const state = parseGameState(input, definition);
  if (!state.cityPatterns) return reject('PATTERN_FORMAT', 'No city patterns have been initialized');
  return deepFreeze({ catalogHash: state.cityPatterns.catalogHash, gameplayVersion: state.cityPatterns.gameplayVersion,
    publicPatternIds: state.cityPatterns.publicPatternIds, markers: state.patternMarkers!,
    exhaustedFacilityIdsByPlayer: state.cityPatterns.exhaustedFacilityIdsByPlayer, useTracks: state.cityPatterns.useTracks, usedSpecialActions: state.cityPatterns.usedSpecialActions });
}
