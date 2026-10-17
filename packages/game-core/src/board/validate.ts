import verifiedCatalog from './verification/verified-catalog.json' with { type: 'json' };
import { boardDefinitionSchema, definitionRefSchema } from './schema.js';
import { computeBoardContentHash, deepFreeze } from './hash.js';
import { isBoardConnected } from './topology.js';
import type { BoardDefinition, DefinitionRef, MapSide, ValidationIssue, ValidationResult } from './types.js';

interface VerifiedMap {
  definitionId: string;
  definitionVersion: string;
  schemaVersion: string;
  regions: Record<string, number>;
  nodes: Record<string, {
    regionId: string; eventDeckColor: string; redRestricted: boolean;
    initialCityEligible: boolean; slotCount: number;
  }>;
  routes: Record<string, { regionId: string; incidentNodeIds: string[]; slotCount: number }>;
  totals: {
    nodes: number; routes: number; regions: number; nodeSlots: number;
    routeSlots: number; totalSlots: number; controlPoints: number;
  };
}
const catalog: Record<MapSide, VerifiedMap> = verifiedCatalog;

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

/** Strict structural + relational + every-entry verified-catalog + digest checks. */
export function validateBoardDefinition(input: unknown): ValidationResult<BoardDefinition> {
  const parsed = boardDefinitionSchema.safeParse(input);
  if (!parsed.success) return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      code: 'SCHEMA', path: issue.path.map(String).join('.'), message: issue.message,
    })),
  };
  const board = parsed.data;
  const issues: ValidationIssue[] = [];
  const report = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  const unique = (values: readonly string[], path: string): void => {
    if (new Set(values).size !== values.length) report('DUPLICATE_ID', path, 'IDs must be unique');
  };
  const checkKeys = (actual: object, expected: object, path: string): void => {
    if (!sameIds(Object.keys(actual), Object.keys(expected))) {
      report('CATALOG_IDS', path, 'IDs differ from the verified map inventory');
    }
  };
  const expected = catalog[board.mapSide];
  for (const field of ['definitionId', 'definitionVersion', 'schemaVersion'] as const) {
    if (board[field] !== expected[field]) report('VERSION', field, `Expected ${expected[field]}`);
  }
  checkKeys(board.regions, expected.regions, 'regions');
  checkKeys(board.resourceNodes, expected.nodes, 'resourceNodes');
  checkKeys(board.routes, expected.routes, 'routes');
  const expectedSources = ['rules-20230803', 'map-analysis-REVIEW-02',
    board.mapSide === 'three-player' ? 'photo-IMG_8183' : 'photo-IMG_8184'];
  unique(board.sourceRefs, 'sourceRefs');
  if (!sameIds(board.sourceRefs, expectedSources)) report('SOURCE', 'sourceRefs', 'Verified source references differ');

  for (const [key, region] of Object.entries(board.regions)) {
    if (key !== region.id) report('ID_KEY', `regions.${key}.id`, 'Record key must equal object ID');
    if (region.label !== `${key}区`) report('REGION_LABEL', `regions.${key}.label`, 'Label differs from this definition version');
    if (region.controlRewardPoints !== expected.regions[key]) {
      report('REGION_SCORE', `regions.${key}`, 'Control points differ from verified inventory');
    }
  }
  unique(Object.values(board.regions).map((r) => r.id), 'regions');
  unique(Object.values(board.resourceNodes).map((n) => n.id), 'resourceNodes');
  unique(Object.values(board.routes).map((r) => r.id), 'routes');
  const owners = new Map<string, string>();
  const checkSlots = (ids: readonly string[], ownerId: string, kind: 'resource-node' | 'route'): void => {
    unique(ids, `${kind}.${ownerId}.influenceSlotIds`);
    for (const slotId of ids) {
      const previous = owners.get(slotId);
      if (previous !== undefined) report('SLOT_OWNERSHIP', slotId, `Already belongs to ${previous}`);
      owners.set(slotId, `${kind}:${ownerId}`);
      const slot = board.influenceSlots[slotId];
      if (!slot) { report('MISSING_SLOT', slotId, 'Referenced slot does not exist'); continue; }
      if (slot.kind !== kind || (slot.kind === 'resource-node' ? slot.nodeId : slot.routeId) !== ownerId) {
        report('SLOT_LOCATION', slotId, 'Slot points to wrong owner or object type');
      }
    }
  };
  const checkSources = (ids: readonly string[], path: string): void => {
    unique(ids, path);
    if (!sameIds(ids, expectedSources.slice(1))) report('SOURCE', path, 'Object sources differ from verified sources');
  };

  for (const [key, node] of Object.entries(board.resourceNodes)) {
    const path = `resourceNodes.${key}`;
    if (key !== node.id) report('ID_KEY', `${path}.id`, 'Record key must equal object ID');
    if (!Object.hasOwn(board.regions, node.regionId)) report('REGION_REFERENCE', path, 'Unknown region');
    checkSlots(node.influenceSlotIds, node.id, 'resource-node');
    checkSources(node.sourceRefs, `${path}.sourceRefs`);
    const fact = expected.nodes[key];
    if (!fact) continue;
    for (const field of ['regionId', 'eventDeckColor', 'redRestricted', 'initialCityEligible'] as const) {
      if (node[field] !== fact[field]) report('NODE_FACT', `${path}.${field}`, 'Value differs from verified inventory');
    }
    const expectedSlots = Array.from({ length: fact.slotCount }, (_, i) => `node:${key}:slot:${i + 1}`);
    if (!sameIds(node.influenceSlotIds, expectedSlots)) report('NODE_SLOTS', path, 'Node slots differ from verified inventory');
  }
  for (const [key, route] of Object.entries(board.routes)) {
    const path = `routes.${key}`;
    if (key !== route.id) report('ID_KEY', `${path}.id`, 'Record key must equal object ID');
    if (!Object.hasOwn(board.regions, route.regionId)) report('REGION_REFERENCE', path, 'Unknown region');
    unique(route.incidentNodeIds, `${path}.incidentNodeIds`);
    if (new Set(route.incidentNodeIds).size < 2) report('ROUTE_ENDPOINTS', path, 'At least two distinct resource nodes required');
    for (const nodeId of route.incidentNodeIds) {
      if (!Object.hasOwn(board.resourceNodes, nodeId)) report('NODE_REFERENCE', `${path}.incidentNodeIds`, `Unknown node ${nodeId}`);
    }
    checkSlots(route.influenceSlotIds, route.id, 'route');
    checkSources(route.sourceRefs, `${path}.sourceRefs`);
    const fact = expected.routes[key];
    if (!fact) continue;
    if (route.regionId !== fact.regionId || !sameIds(route.incidentNodeIds, fact.incidentNodeIds)) {
      report('ROUTE_FACT', path, 'Route region or endpoints differ from verified inventory');
    }
    const expectedSlots = Array.from({ length: fact.slotCount }, (_, i) => `route:${key}:slot:${i + 1}`);
    if (!sameIds(route.influenceSlotIds, expectedSlots)) report('ROUTE_SLOTS', path, 'Route slots differ from verified inventory');
  }
  for (const [key, slot] of Object.entries(board.influenceSlots)) {
    if (!owners.has(key)) report('ORPHAN_SLOT', key, 'Slot is not listed by any object');
    const exists = slot.kind === 'resource-node'
      ? Object.hasOwn(board.resourceNodes, slot.nodeId) : Object.hasOwn(board.routes, slot.routeId);
    if (!exists) report('SLOT_REFERENCE', key, 'Slot owner does not exist');
  }
  const totals = {
    nodes: Object.keys(board.resourceNodes).length,
    routes: Object.keys(board.routes).length,
    regions: Object.keys(board.regions).length,
    nodeSlots: Object.values(board.resourceNodes).reduce((sum, n) => sum + n.influenceSlotIds.length, 0),
    routeSlots: Object.values(board.routes).reduce((sum, r) => sum + r.influenceSlotIds.length, 0),
    totalSlots: Object.keys(board.influenceSlots).length,
    controlPoints: Object.values(board.regions).reduce((sum, r) => sum + r.controlRewardPoints, 0),
  };
  for (const field of Object.keys(totals) as (keyof typeof totals)[]) {
    if (totals[field] !== expected.totals[field]) report('COUNT', field, `Expected ${expected.totals[field]}, got ${totals[field]}`);
  }
  if (!isBoardConnected(board)) report('DISCONNECTED', 'routes', 'The resource-node/route incidence graph is invalid or disconnected');
  if (board.contentHash !== computeBoardContentHash(board)) report('HASH', 'contentHash', 'Content SHA-256 does not match');
  return issues.length > 0 ? { success: false, issues } : { success: true, data: deepFreeze(board) };
}

export function parseBoardDefinition(input: unknown): BoardDefinition {
  const result = validateBoardDefinition(input);
  if (!result.success) throw new Error(`Invalid board definition: ${result.issues.map((i) => `${i.code}@${i.path}`).join(', ')}`);
  return result.data;
}

/** Compare a save/reference to an already validated immutable definition. */
export function validateDefinitionRef(input: unknown, board: BoardDefinition): ValidationResult<DefinitionRef> {
  const parsed = definitionRefSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: [{ code: 'SCHEMA', path: 'definitionRef', message: parsed.error.message }] };
  const issues: ValidationIssue[] = [];
  for (const field of ['definitionId', 'definitionVersion', 'contentHash'] as const) {
    if (parsed.data[field] !== board[field]) issues.push({ code: 'DEFINITION_REF', path: `definitionRef.${field}`, message: 'Reference does not match loaded definition' });
  }
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(parsed.data) };
}
