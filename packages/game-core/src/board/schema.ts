import { z } from 'zod';

export const regionIdSchema = z.string().regex(/^[A-GR]$/);
export const resourceNodeIdSchema = z.string().regex(/^[A-G]-\d{2}$/);
export const routeIdSchema = z.string().regex(/^[A-GR]-route-\d{2}$/);
export const slotIdSchema = z.string().regex(/^(?:node:[A-G]-\d{2}|route:[A-GR]-route-\d{2}):slot:[1-9]\d*$/);
const externalIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/);
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export const contentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sourceRefsSchema = z.array(externalIdSchema).min(1);

export const regionDefinitionSchema = z.strictObject({
  id: regionIdSchema,
  label: z.string().min(1),
  controlRewardPoints: z.number().int().positive(),
});

export const resourceNodeDefinitionSchema = z.strictObject({
  id: resourceNodeIdSchema,
  regionId: regionIdSchema,
  eventDeckColor: z.enum(['green', 'yellow', 'red']),
  redRestricted: z.boolean(),
  initialCityEligible: z.boolean(),
  influenceSlotIds: z.array(slotIdSchema).min(1),
  sourceRefs: sourceRefsSchema,
});

export const routeDefinitionSchema = z.strictObject({
  id: routeIdSchema,
  regionId: regionIdSchema,
  // Distinctness and existence are cross-object checks, not array length alone.
  incidentNodeIds: z.array(resourceNodeIdSchema).min(2),
  influenceSlotIds: z.array(slotIdSchema).min(1),
  sourceRefs: sourceRefsSchema,
});

export const slotLocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resource-node'), nodeId: resourceNodeIdSchema }),
  z.strictObject({ kind: z.literal('route'), routeId: routeIdSchema }),
]);

export const definitionRefSchema = z.strictObject({
  definitionId: externalIdSchema,
  definitionVersion: versionSchema,
  contentHash: contentHashSchema,
});

/** Structural parsing only: call validateBoardDefinition for full integrity. */
export const boardDefinitionSchema = z.strictObject({
  ...definitionRefSchema.shape,
  schemaVersion: versionSchema,
  mapSide: z.enum(['three-player', 'four-player']),
  regions: z.record(regionIdSchema, regionDefinitionSchema),
  resourceNodes: z.record(resourceNodeIdSchema, resourceNodeDefinitionSchema),
  routes: z.record(routeIdSchema, routeDefinitionSchema),
  influenceSlots: z.record(slotIdSchema, slotLocationSchema),
  sourceRefs: sourceRefsSchema,
});

export const boardStateSchema = z.strictObject({
  definitionRef: definitionRefSchema,
  resourceMarkerByNode: z.record(resourceNodeIdSchema, z.strictObject({
    markerDefinitionId: externalIdSchema,
    resourceKind: z.enum(['orirock', 'originium', 'iron']),
    harvestAmount: z.union([z.literal(1), z.literal(2)]),
  }).nullable()),
  influenceBySlot: z.record(slotIdSchema, z.strictObject({
    ownerPlayerId: externalIdSchema,
    markerId: externalIdSchema,
  }).nullable()),
  cityNodeByPlayer: z.record(externalIdSchema, resourceNodeIdSchema.nullable()),
});
