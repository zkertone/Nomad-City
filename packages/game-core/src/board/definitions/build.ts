import { computeBoardContentHash, deepFreeze } from '../hash.js';
import type {
  BoardDefinition, EventDeckColor, RegionDefinition, ResourceNodeDefinition,
  RouteDefinition, SlotLocation, MapSide,
} from '../types.js';

export type NodeRow = readonly [id: string, eventColor: EventDeckColor];
export type RouteRow = readonly [id: string, regionId: string, nodes: readonly string[], slots: number];

/** Mechanical assembly only. Facts are explicitly supplied by each map module. */
export function buildDefinition(
  mapSide: MapSide,
  regionRows: readonly (readonly [id: string, points: number])[],
  nodeRows: readonly NodeRow[],
  routeRows: readonly RouteRow[],
): BoardDefinition {
  const evidence = mapSide === 'three-player' ? 'photo-IMG_8183' : 'photo-IMG_8184';
  const sourceRefs = ['rules-20230803', 'map-analysis-REVIEW-02', evidence];
  const regions: Record<string, RegionDefinition> = {};
  const resourceNodes: Record<string, ResourceNodeDefinition> = {};
  const routes: Record<string, RouteDefinition> = {};
  const influenceSlots: Record<string, SlotLocation> = {};
  for (const [id, controlRewardPoints] of regionRows) {
    if (Object.hasOwn(regions, id)) throw new Error(`Duplicate region row: ${id}`);
    regions[id] = { id, label: `${id}区`, controlRewardPoints };
  }
  for (const [id, eventDeckColor] of nodeRows) {
    if (Object.hasOwn(resourceNodes, id)) throw new Error(`Duplicate resource row: ${id}`);
    const influenceSlotIds = [1, 2].map((i) => `node:${id}:slot:${i}`);
    resourceNodes[id] = {
      id, regionId: id.charAt(0), eventDeckColor,
      redRestricted: eventDeckColor === 'red',
      initialCityEligible: eventDeckColor === 'green',
      influenceSlotIds, sourceRefs: [evidence, 'map-analysis-REVIEW-02'],
    };
    for (const slot of influenceSlotIds) influenceSlots[slot] = { kind: 'resource-node', nodeId: id };
  }
  for (const [id, regionId, nodes, slots] of routeRows) {
    if (Object.hasOwn(routes, id)) throw new Error(`Duplicate route row: ${id}`);
    const influenceSlotIds = Array.from({ length: slots }, (_, i) => `route:${id}:slot:${i + 1}`);
    routes[id] = { id, regionId, incidentNodeIds: [...nodes], influenceSlotIds, sourceRefs: [evidence, 'map-analysis-REVIEW-02'] };
    for (const slot of influenceSlotIds) influenceSlots[slot] = { kind: 'route', routeId: id };
  }
  const unsigned = {
    definitionId: mapSide === 'three-player' ? 'founders-map-3' : 'founders-map-4',
    definitionVersion: '1.0.0', schemaVersion: '1.0.0', mapSide,
    regions, resourceNodes, routes, influenceSlots, sourceRefs,
  };
  return deepFreeze({ ...unsigned, contentHash: computeBoardContentHash(unsigned) });
}
