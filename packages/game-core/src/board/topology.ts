import type { BoardDefinition, ResourceNodeDefinition, RouteDefinition } from './types.js';

export function getRoutesForNode(board: BoardDefinition, nodeId: string): readonly RouteDefinition[] {
  if (!Object.hasOwn(board.resourceNodes, nodeId)) throw new RangeError(`Unknown resource node: ${nodeId}`);
  return Object.freeze(Object.values(board.routes)
    .filter((route) => route.incidentNodeIds.includes(nodeId))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function getNodesForRoute(board: BoardDefinition, routeId: string): readonly ResourceNodeDefinition[] {
  if (!Object.hasOwn(board.routes, routeId)) throw new RangeError(`Unknown route: ${routeId}`);
  const route = board.routes[routeId];
  if (!route) throw new RangeError(`Unknown route: ${routeId}`);
  return Object.freeze([...route.incidentNodeIds].sort().map((id) => {
    const node = board.resourceNodes[id];
    if (!node) throw new RangeError(`Route ${routeId} references unknown node: ${id}`);
    return node;
  }));
}

/** Geometric incidence only. It never approves a game action. */
export function areNodesDirectlyConnected(
  board: BoardDefinition, sourceId: string, targetId: string, routeId: string,
): boolean {
  if (sourceId === targetId || !Object.hasOwn(board.resourceNodes, sourceId)
    || !Object.hasOwn(board.resourceNodes, targetId)) return false;
  if (!Object.hasOwn(board.routes, routeId)) return false;
  const route = board.routes[routeId];
  return route !== undefined && route.incidentNodeIds.includes(sourceId)
    && route.incidentNodeIds.includes(targetId);
}

/** Traverses the bipartite graph, preserving each route as one vertex. */
export function isBoardConnected(board: BoardDefinition): boolean {
  const graph = new Map<string, Set<string>>();
  for (const id of Object.keys(board.resourceNodes)) graph.set(`node:${id}`, new Set());
  for (const [id, route] of Object.entries(board.routes)) {
    if (new Set(route.incidentNodeIds).size !== route.incidentNodeIds.length
      || route.incidentNodeIds.length < 2) return false;
    const routeKey = `route:${id}`;
    graph.set(routeKey, new Set());
    for (const nodeId of route.incidentNodeIds) {
      const nodeKey = `node:${nodeId}`;
      const neighbors = graph.get(nodeKey);
      if (!neighbors) return false;
      neighbors.add(routeKey);
      graph.get(routeKey)?.add(nodeKey);
    }
  }
  const start = graph.keys().next().value as string | undefined;
  if (start === undefined || Object.keys(board.resourceNodes).length === 0) return false;
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const vertex = pending.pop();
    if (vertex === undefined || visited.has(vertex)) continue;
    visited.add(vertex);
    for (const neighbor of graph.get(vertex) ?? []) {
      if (!visited.has(neighbor)) pending.push(neighbor);
    }
  }
  return visited.size === graph.size;
}
