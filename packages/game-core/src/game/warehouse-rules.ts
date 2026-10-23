import type { BoardDefinition } from '../board/types.js';
import { explorationProgressSchema } from './schema.js';
import type { gameStateSchema } from './schema.js';
import type { z } from 'zod';
import { loadFoundersBoard } from '../board/index.js';
import { getFoundersMapSide } from './state.js';
import { resolveExplorationStep } from './exploration-engine.js';
import type { ExplorationPathStep } from './exploration-engine.js';
import type { GameDefinition } from './types.js';
import type { GameState } from './types.js';
import { quoteRouteTolls } from './route-tolls.js';
import { redExplorationOpeningRound } from './exploration-rules.js';

/** Internal existence/minimum-cost query. Hyperedges keep one fee; coordinates and discovery of intermediates do not gate travel. */
export function affordableWarehouseTargets(state: GameState, board: BoardDefinition, actorId: string, roundNumber: number, playerCount: number) {
  const source = state.board.cityNodeByPlayer[actorId]!, funds = state.players[actorId]!.balances['columbia-voucher'];
  const distance = new Map<string, number>([[source, 0]]), visited = new Set<string>();
  const routes = Object.values(board.routes).map(route => ({ route, leg: quoteRouteTolls(state, board, actorId, [route.id]).legs[0]! }));
  while (true) {
    const current = [...distance].filter(([nodeId]) => !visited.has(nodeId)).sort((a, b) => a[1] - b[1])[0];
    if (!current || current[1] > funds) break;
    const [nodeId, cost] = current; visited.add(nodeId);
    for (const { route, leg } of routes) if (route.incidentNodeIds.includes(nodeId)) {
      if (leg.amount && !leg.toSupply && !leg.recipientPlayerIds.some(id => Number.isSafeInteger(state.players[id]!.balances['columbia-voucher'] + leg.amount))) continue;
      for (const target of route.incidentNodeIds) {
        const candidate = cost + leg.amount;
        if (candidate < (distance.get(target) ?? Infinity)) distance.set(target, candidate);
      }
    }
  }
  return Object.values(board.resourceNodes).filter(node => node.id !== source && state.board.resourceMarkerByNode[node.id] === null
    && (!node.redRestricted || roundNumber >= redExplorationOpeningRound(playerCount)) && state.eventDecks![node.eventDeckColor].length
    && (distance.get(node.id) ?? Infinity) <= funds).map(node => ({ nodeId: node.id, minimumToll: distance.get(node.id)! }));
}

/** Begin only the chosen exploration using the already-paid current construction facts. */
export function beginWarehouseExploration(next: z.infer<typeof gameStateSchema>, definition: GameDefinition,
  initial: { readonly nodeId: string; readonly path: readonly ExplorationPathStep[] } | undefined, reject: (code: string, message: string) => never): void {
  const action = next.construction!, board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const targets = affordableWarehouseTargets(next, board, action.actorId, action.roundNumber, definition.players.length);
  if (!targets.length) {
    if (initial !== undefined) return reject('EXPLORATION_IMPOSSIBLE', 'No exploration can execute after paying for construction');
    action.status = 'complete'; action.warehouseEntry = { kind: 'warehouse-exploration', status: 'skipped', targetNodeId: null, cardId: null, resolvedChoiceId: null };
  } else {
    if (!initial) return reject('EXPLORATION_REQUIRED', 'Choose an executable initial exploration target and path');
    const progress = explorationProgressSchema.parse({ actorId: action.actorId, roundNumber: action.roundNumber, status: 'ready', targetNodeId: null, cardId: null, resolvedChoiceId: null });
    resolveExplorationStep(next, definition, progress, { nodeId: initial.nodeId, path: initial.path.map(step => ({ ...step })), gameId: next.gameId, expectedVersion: next.stateVersion, type: 'explore' }, reject);
    action.status = 'entry-pending'; action.warehouseEntry = { kind: 'warehouse-exploration', status: 'event-choice', targetNodeId: progress.targetNodeId, cardId: progress.cardId, resolvedChoiceId: null };
  }
}
