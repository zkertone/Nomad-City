import { z } from 'zod';

const count = z.number().int().nonnegative().safe();
/** Color-cell counts only. Does not encode footprint, cost, score or executable effects. */
export const facilityColorCountsSchema = z.strictObject({ red: count, blue: count, yellow: count, rainbow: count });
export const facilityColorCountRecordSchema = z.strictObject({
  id: z.string().regex(/^FAC-\d{3}$/), name: z.string().trim().min(1).max(60),
  colorCellCounts: facilityColorCountsSchema,
}).superRefine((facility, ctx) => {
  if (!Object.values(facility.colorCellCounts).some(value => value > 0)) ctx.addIssue({ code: 'custom', path: ['colorCellCounts'], message: 'A confirmed count record must contain at least one colored cell' });
});
export const facilityColorCountsCatalogSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'), catalogId: z.literal('founders-facility-color-counts'),
  verificationStatus: z.literal('user-confirmed-colors-only'),
  sourceRefs: z.tuple([z.literal('user-2026-10-22-facility-colors')]),
  // Exactly this submitted batch, not a claim about the complete official facility set.
  facilities: z.array(facilityColorCountRecordSchema).length(20),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).superRefine((catalog, ctx) => {
  for (const key of ['id', 'name'] as const) {
    const used = new Set<string>();
    catalog.facilities.forEach((facility, i) => {
      if (used.has(facility[key])) ctx.addIssue({ code: 'custom', path: ['facilities', i, key], message: `Duplicate facility ${key}` });
      used.add(facility[key]);
    });
  }
});
