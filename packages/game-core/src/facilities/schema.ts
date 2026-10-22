import { z } from 'zod';

const count = z.number().int().nonnegative().safe();
/** Reported physical copy counts by color only. Does not encode footprint, cost, score or executable effects. */
export const facilityColorCountsSchema = z.strictObject({ red: count, blue: count, yellow: count, rainbow: count });
export const facilityColorCountRecordSchema = z.strictObject({
  id: z.string().regex(/^FAC-\d{3}$/), name: z.string().trim().min(1).max(60),
  copyCountsByColor: facilityColorCountsSchema,
}).superRefine((facility, ctx) => {
  if (!Object.values(facility.copyCountsByColor).some(value => value > 0)) ctx.addIssue({ code: 'custom', path: ['copyCountsByColor'], message: 'A reported count record must contain at least one physical copy' });
});
export const facilityColorCountsCatalogSchema = z.strictObject({
  schemaVersion: z.literal('2.0.0'), catalogId: z.literal('founders-facility-copy-counts'),
  verificationStatus: z.literal('user-confirmed-copy-counts-and-editions'),
  scope: z.literal('mixed-edition-inventory-report'),
  sourceRefs: z.tuple([z.literal('user-2026-10-22-facility-colors'), z.literal('user-2026-10-22-facility-quantity-clarification'), z.literal('user-2026-10-22-e-enterprise-o-infected')]),
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
