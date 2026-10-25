import { boardFor, panelFor, facilityEntrySpec, copyEntryTargets, extraConstructionOptions } from './facility-entry-rules.js';
import { getEmptyFacilityPanelCells, getOrthogonallyAdjacentPanelFacilities } from '../facilities/panel-state.js';
import { z } from 'zod';
import { advanceCityPatternContinuation } from './city-pattern-continuations.js';
import { deepFreeze } from '../board/hash.js';
import { slotIdSchema } from '../board/schema.js';
import { getFacilityPhysicalCard } from '../facilities/stock.js';
import { getFacilityExecutionFace } from '../facilities/faces.js';
import { beginFacilityConstruction, facilityConstructionCommandSchema, facilityConstructionPositionSchema } from '../facilities/construction.js';
import { facilityEntryChoiceSchema, settleFacilityBoardOrSaleEntry } from '../facilities/entry-effects.js';
import { FOUNDERS_FACILITY_PANEL } from '../facilities/panel-definition.js';
import { gameEntityIdSchema, gameStateSchema, cityMoveProgressSchema, explorationProgressSchema } from './schema.js';
import { getGamePosition, parseGameState } from './state.js';
import { explorationPlayerCommandSchema, resolveExplorationStep } from './exploration-engine.js';
import { affordableWarehouseTargets } from './warehouse-rules.js';
import { cityMoveOptionsFor, cityMovePlayerCommandSchema, resolveCityMoveStep } from './city-move.js';
import { availableInfluenceSlots, availableTargetInfluenceSlots } from './influence.js';
import { finalExplorationSlots } from './exploration-rules.js';
import { getEventChoiceRequirements } from './settlement.js';
import type { GameDefinition, GameState, DeepReadonly } from './types.js';

type MutableState = z.infer<typeof gameStateSchema>;
type Frame = NonNullable<NonNullable<MutableState['construction']>['entryStack']>[number];
type Choice = z.infer<typeof facilityEntryChoiceSchema>;
export class FacilityEntryError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'FacilityEntryError'; }
}
const reject = (code: string, message: string): never => { throw new FacilityEntryError(code, message); };
const optionsSchema = z.strictObject({ expectedVersion: z.number().int().nonnegative().safe() });
/** Explicit additive upgrade, including an in-flight 1.11 warehouse without replaying its effects. */
export function enableNestedFacilityEntries(input: GameState, definition: GameDefinition, options: DeepReadonly<z.infer<typeof optionsSchema>>): GameState {
  const state = parseGameState(input, definition), parsed = optionsSchema.safeParse(options);
  if (!parsed.success) return reject('OPTIONS_SCHEMA', parsed.error.message);
  if (parsed.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.schemaVersion !== '1.11.0') return reject('FACILITY_FORMAT', 'Upgrade a validated 1.11.0 snapshot exactly once');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return parseGameState({ ...state, schemaVersion: '1.12.0', stateVersion: state.stateVersion + 1,
    roundFlow: { ...state.roundFlow!, startingPlayerOverride: null } }, definition);
}
const entryFrame = (sourceCardId: string): Frame => ({ kind: 'entry', sourceCardId, status: 'choice' });
const gain = (state: MutableState, actor: string, asset: 'orirock' | 'originium' | 'iron' | 'columbia-voucher', amount: number) => {
  const balances = state.players[actor]!.balances;
  if (!Number.isSafeInteger(balances[asset] + amount)) return reject('BALANCE_OVERFLOW', 'Entry gain exceeds safe integer range');
  balances[asset] += amount;
};
function routeSlots(state: GameState, definition: GameDefinition, actor: string, routeId: string): string[] {
  const board = boardFor(definition);
  return availableInfluenceSlots(state, board, actor).filter(id => board.routes[routeId]!.influenceSlotIds.includes(id));
}
/** Drain deterministic effects only; every unresolved player decision remains persisted after refill. */
export function advanceFacilityEntries(next: MutableState, definition: GameDefinition): void {
  const action = next.construction!, stack = action.entryStack!, actor = action.actorId;
  while (stack.length) {
    const frame = stack.at(-1)!;
    if (frame.kind === 'exploration') {
      if (frame.progress.status !== 'complete') break;
      stack.pop(); continue;
    }
    if (frame.kind === 'city-move') {
      if (frame.progress.status !== 'complete' || routeSlots(next, definition, actor, frame.progress.routeId!).length) break;
      stack.pop(); continue;
    }
    if (frame.status === 'waiting') { stack.pop(); continue; }
    const spec = facilityEntrySpec(frame.sourceCardId);
    switch (spec.entry.kind) {
      case 'none': stack.pop(); continue;
      case 'gain': gain(next, actor, spec.entry.asset, spec.entry.amount); stack.pop(); continue;
      case 'core-neighbor-vouchers':
        gain(next, actor, 'columbia-voucher', getOrthogonallyAdjacentPanelFacilities(panelFor(next, actor), next.facilities!.supply, FOUNDERS_FACILITY_PANEL.initialCoreCellId).length * 4); stack.pop(); continue;
      case 'starting-player':
        next.roundFlow!.startingPlayerOverride = { playerId: actor, cardId: frame.sourceCardId }; stack.pop(); continue;
      case 'free-city-move': {
        if (!cityMoveOptionsFor(next, definition, actor, action.roundNumber).length) { stack.pop(); continue; }
        frame.status = 'waiting'; stack.push({ kind: 'city-move', sourceCardId: frame.sourceCardId, progress: cityMoveProgressSchema.parse({ actorId: actor, roundNumber: action.roundNumber, status: 'ready', sourceNodeId: null, targetNodeId: null, routeId: null, cardId: null, resolvedChoiceId: null }) });
        continue;
      }
      case 'copy-entry': if (!copyEntryTargets(next, actor, frame.sourceCardId).length) { stack.pop(); continue; } break;
      case 'extra-construction': {
        const options = extraConstructionOptions(next, definition, actor);
        if (!options.choices.length && !options.unresolvedCardIds.length) { stack.pop(); continue; }
        break;
      }
      default: break;
    }
    break;
  }
  action.status = stack.length ? 'entry-pending' : 'complete';
}
/** Trusted internal start after the existing construction transaction commits its facts to a private copy. */
export function beginNestedFacilityEntry(next: MutableState, definition: GameDefinition, cardId: string): void {
  next.construction!.entryStack = [entryFrame(cardId)]; advanceFacilityEntries(next, definition);
}
function pending(input: GameState, definition: GameDefinition, actorId: string) {
  const state = parseGameState(input, definition), action = state.construction;
  if (!['1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) || state.phase !== 'construction' || action?.status !== 'entry-pending' || !action.entryStack?.length) return reject('ENTRY_STAGE', 'No pending nested facility entry');
  if (action.actorId !== actorId) return reject('WRONG_ACTOR', 'Only the construction owner resolves these effects');
  return { state, action, frame: action.entryStack.at(-1)! };
}
/** Read-only advisory choices; every command revalidates the actual authoritative facts. */
export function getNestedFacilityEntryOptions(input: GameState, definition: GameDefinition, actorId: string) {
  const p = pending(input, definition, actorId), frame = p.frame, board = boardFor(definition);
  if (frame.kind === 'city-move') return deepFreeze({ kind: frame.kind, sourceCardId: frame.sourceCardId, status: frame.progress.status,
    moveOptions: frame.progress.status === 'ready' ? cityMoveOptionsFor(p.state, definition, actorId, p.action.roundNumber) : [],
    finalSlotIds: frame.progress.status === 'final-influence' ? availableTargetInfluenceSlots(p.state, board, actorId, frame.progress.targetNodeId!) : [],
    routeSlotIds: frame.progress.status === 'complete' ? routeSlots(p.state, definition, actorId, frame.progress.routeId!) : [] });
  if (frame.kind === 'exploration') return deepFreeze({ kind: frame.kind, sourceCardId: frame.sourceCardId, status: frame.progress.status,
    targets: frame.progress.status === 'ready' ? affordableWarehouseTargets(p.state, board, actorId, p.action.roundNumber, definition.players.length) : [],
    finalSlotIds: frame.progress.status === 'final-influence' ? finalExplorationSlots(p.state, board, actorId, frame.progress.targetNodeId!) : [] });
  const entry = facilityEntrySpec(frame.sourceCardId).entry.kind;
  return deepFreeze({ kind: entry, sourceCardId: frame.sourceCardId,
    copyCardIds: entry === 'copy-entry' ? copyEntryTargets(p.state, actorId, frame.sourceCardId) : [],
    extensionCardIds: entry === 'logistics' ? p.state.facilities!.supply.extensionReserve : [],
    constructionOptions: entry === 'extra-construction' ? extraConstructionOptions(p.state, definition, actorId) : { choices: [], unresolvedCardIds: [] } });
}
export function getPendingFacilityEventRequirements(input: GameState, definition: GameDefinition, actorId: string, choiceId: string) {
  const p = pending(input, definition, actorId);
  if (p.frame.kind === 'entry' || p.frame.progress.status !== 'event-choice') return reject('ENTRY_STAGE', 'No pending nested event');
  return getEventChoiceRequirements(getGamePosition(p.state, definition), definition,
    { gameId: p.state.gameId, actorId, nodeId: p.frame.progress.targetNodeId!, cardId: p.frame.progress.cardId! }, choiceId);
}
const envelope = { gameId: gameEntityIdSchema, expectedVersion: z.number().int().nonnegative().safe() };
export const nestedFacilityEntryCommandSchema = z.discriminatedUnion('type', [
  ...explorationPlayerCommandSchema.options, ...cityMovePlayerCommandSchema.options,
  z.strictObject({ ...envelope, type: z.literal('resolve-facility-entry'), entryChoice: facilityEntryChoiceSchema }),
  z.strictObject({ ...envelope, type: z.literal('copy-facility-entry'), targetCardId: z.string().min(1) }),
  z.strictObject({ ...envelope, type: z.literal('build-logistics-extension'), placement: z.strictObject({ cardId: z.string().min(1), cellId: z.string().min(1) }).nullable() }),
  facilityConstructionCommandSchema.extend({ ...envelope, type: z.literal('construct-entry-facility') }),
  z.strictObject({ ...envelope, type: z.literal('place-entry-route-influence'), slotId: slotIdSchema }),
]);
function settleChosenEntry(next: MutableState, definition: GameDefinition, source: string, choice: Choice): void {
  const spec = facilityEntrySpec(source), action = next.construction!, stack = action.entryStack!, frame = stack.at(-1)!;
  if (frame.kind !== 'entry' || frame.status !== 'choice') return reject('ENTRY_STAGE', 'No unresolved entry choice');
  if (spec.entry.kind === 'warehouse' && choice.kind === 'warehouse-explore') {
    if (!affordableWarehouseTargets(next, boardFor(definition), action.actorId, action.roundNumber, definition.players.length).length) { stack.pop(); return; }
    frame.status = 'waiting'; stack.push({ kind: 'exploration', sourceCardId: source, progress: explorationProgressSchema.parse({ actorId: action.actorId, roundNumber: action.roundNumber, status: 'ready', targetNodeId: null, cardId: null, resolvedChoiceId: null }) }); return;
  }
  if (spec.entry.kind === 'choose-five-resources' && choice.kind === 'resource-allocation') {
    for (const asset of ['orirock', 'originium', 'iron'] as const) gain(next, action.actorId, asset, choice.gains[asset]);
  } else {
    const expected = spec.entry.kind === 'warehouse' ? 'warehouse-influence' : spec.entry.kind === 'remove-two-influence' ? 'remove-influence' : spec.entry.kind === 'replace-or-remove-influence' ? 'mercenary-influence' : spec.entry.kind === 'sell-resources' ? 'sell-resources' : null;
    if (choice.kind === 'resource-allocation' || choice.kind === 'warehouse-explore' || choice.kind === 'warehouse-entry' || choice.kind === 'deferred-entry' || expected === null || choice.kind !== expected) return reject('ENTRY_CHOICE', 'Choose the exact entry effect of the source facility');
    settleFacilityBoardOrSaleEntry(next, boardFor(definition), action.actorId, choice, reject);
  }
  stack.pop();
}
/** Server-authoritative parent/child continuation; one version increment per successful player request. */
export function applyNestedFacilityEntryCommand(input: GameState, definition: GameDefinition, context: { readonly authenticatedPlayerId: string }, payload: unknown): GameState {
  const current = parseGameState(input, definition), parsed = nestedFacilityEntryCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data;
  if (command.gameId !== current.gameId) return reject('GAME_REFERENCE', 'Wrong facility game');
  if (command.expectedVersion !== current.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  pending(current, definition, context.authenticatedPlayerId);
  if (current.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  const next = gameStateSchema.parse(current), action = next.construction!, stack = action.entryStack!, frame = stack.at(-1)!, actor = action.actorId;
  if (frame.kind === 'exploration') {
    const checked = explorationPlayerCommandSchema.safeParse(command);
    if (!checked.success) return reject('ENTRY_STAGE', 'Complete the nested exploration first');
    resolveExplorationStep(next, definition, frame.progress, checked.data, reject);
  } else if (frame.kind === 'city-move') {
    if (frame.progress.status === 'complete') {
      if (command.type !== 'place-entry-route-influence' || !routeSlots(next, definition, actor, frame.progress.routeId!).includes(command.slotId)) return reject('ROUTE_SLOT', 'Place the additional influence on the traversed route after the whole movement');
      next.board.influenceBySlot[command.slotId] = { markerId: next.markerSupplyByPlayer[actor]!.shift()!, ownerPlayerId: actor }; stack.pop();
    } else {
      const checked = cityMovePlayerCommandSchema.safeParse(command);
      if (!checked.success) return reject('ENTRY_STAGE', 'Complete the free city movement first');
      resolveCityMoveStep(next, definition, frame.progress, checked.data, reject, true);
    }
  } else {
    const kind = facilityEntrySpec(frame.sourceCardId).entry.kind;
    if (frame.status !== 'choice') return reject('ENTRY_STAGE', 'The child effect must finish first');
    if (command.type === 'resolve-facility-entry') settleChosenEntry(next, definition, frame.sourceCardId, command.entryChoice);
    else if (command.type === 'copy-facility-entry' && kind === 'copy-entry') {
      if (!copyEntryTargets(next, actor, frame.sourceCardId).includes(command.targetCardId)) return reject('COPY_TARGET', 'Choose an orthogonally adjacent non-rainbow facility on your own panel');
      facilityEntrySpec(command.targetCardId); frame.status = 'waiting'; stack.push(entryFrame(command.targetCardId));
    } else if (command.type === 'construct-entry-facility' && kind === 'extra-construction') {
      const panel = panelFor(next, actor), { type: _type, gameId: _game, expectedVersion: _version, ...build } = command;
      const settled = beginFacilityConstruction({ position: { gameId: next.gameId, board: next.board, players: next.players, markerSupplyByPlayer: next.markerSupplyByPlayer, ...(next.patternMarkers ? { patternMarkers: next.patternMarkers } : {}) }, ...next.facilities! }, definition,
        { gameId: next.gameId, actorId: actor, expectedSupplyRevision: next.facilities!.supply.revision, expectedPanelRevision: panel.revision }, build);
      const built = facilityConstructionPositionSchema.parse(settled.state);
      Object.assign(next, built.position); next.facilities = { supply: built.supply, panels: built.panels };
      frame.status = 'waiting';
      if (settled.pendingEntry) {
        if (settled.pendingEntry === 'warehouse-exploration') {
          // This endpoint accepts an entry choice after refill; its exploration uses the normal resumable child.
          stack.push(entryFrame(command.cardId)); settleChosenEntry(next, definition, command.cardId, { kind: 'warehouse-explore' });
        } else stack.push(entryFrame(command.cardId));
      }
    } else if (command.type === 'build-logistics-extension' && kind === 'logistics') {
      if (command.placement !== null) {
        const { cardId, cellId } = command.placement, supply = next.facilities!.supply, panel = next.facilities!.panels.find(row => row.playerId === actor)!;
        if (!supply.extensionReserve.includes(cardId)) return reject('EXTENSION_SOURCE', 'Choose one remaining extension reserve card');
        const card = getFacilityPhysicalCard(cardId), face = getFacilityExecutionFace(card.facilityId);
        if (card.group !== 'extension-hub') return reject('EXTENSION_SOURCE', 'Only extension cards belong to this effect');
        if (!getEmptyFacilityPanelCells(panel, supply).some(cell => cell.id === cellId)) return reject('EXTENSION_CELL', 'Choose an empty cell on your panel');
        if (supply.revision === Number.MAX_SAFE_INTEGER || panel.revision === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'Facility version exhausted');
        if (!Number.isSafeInteger(next.players[actor]!.score + face.printedScore)) return reject('SCORE_OVERFLOW', 'Extension score exceeds safe integer range');
        // This reserve-only card has no printed cost. It never grants a free ordinary construction.
        supply.extensionReserve.splice(supply.extensionReserve.indexOf(cardId), 1); supply.playerHoldings.find(row => row.playerId === actor)!.cardIds.push(cardId); supply.revision++;
        panel.placements.push({ cardId, cellId }); panel.revision++; next.players[actor]!.score += face.printedScore;
      }
      stack.pop();
    } else return reject('ENTRY_STAGE', 'Command does not belong to the current facility entry');
  }
  advanceFacilityEntries(next, definition); advanceCityPatternContinuation(next, definition); next.stateVersion++;
  return parseGameState(next, definition);
}
