import { z } from 'zod';
import type { DeepReadonly } from '../game/types.js';

const text = z.string().min(1).refine(value => value.trim().length > 0, 'Blank text is not a transcription');
/** Visual labels preserve printed symbols; these tokens are not executable commands. */
export const facilityFaceIconSchema = z.enum([
  'red-up-cube', 'green-down-cube', 'blue-right-cube', 'city-right-arrow',
  'construction-crane', 'orirock', 'originium', 'iron', 'pure-originium', 'voucher',
]);
export const facilityFaceSegmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text }),
  z.strictObject({ kind: z.literal('icon'), icon: facilityFaceIconSchema }),
]);
const partial = z.strictObject({ status: z.literal('partial'), fragments: z.array(text).min(1), reason: text });
const unreadable = z.strictObject({ status: z.literal('unreadable'), reason: text });
export const facilityFlavorTranscriptionSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('transcribed'), text }), partial, unreadable,
]);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const facilityPrintedCostSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('printed-alternatives'),
    resourcePayment: z.strictObject({ orirock: amount, originium: amount, iron: amount, pureOriginium: amount, vouchers: amount })
      .refine(value => Object.values(value).some(n => n > 0), 'Resource alternative must not be empty'),
    voucherPayment: amount.refine(value => value > 0, 'Voucher alternative must be positive'),
  }),
  // Absence of a printed cost is NOT permission to build for free.
  z.strictObject({ kind: z.literal('not-printed') }),
]);
export const facilityFaceTranscriptionSchema = z.strictObject({
  id: z.string().regex(/^(FAC-\d{3}|FAC-CORE-COMMAND-TOWER)$/),
  name: text, edition: z.literal('base'),
  observedColor: z.enum(['red', 'blue', 'yellow', 'rainbow']),
  appliesTo: z.literal('pictured-face-only'),
  sourceRef: text, location: text,
  printedScore: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  constructionCost: facilityPrintedCostSchema,
  effect: z.strictObject({
    entryMarker: z.boolean(), uniqueMarker: z.boolean(),
    transcription: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('transcribed'), segments: z.array(facilityFaceSegmentSchema) }),
      partial, unreadable,
    ]),
  }).superRefine((effect, ctx) => {
    if (effect.transcription.status === 'transcribed' && !effect.transcription.segments.length
      && !(effect.uniqueMarker && !effect.entryMarker)) {
      ctx.addIssue({ code: 'custom', message: 'Empty effect must not hide unreadable text; only a unique-marker-only face may be empty' });
    }
  }),
  flavor: facilityFlavorTranscriptionSchema,
});
export const facilityFacesCatalogSchema = z.strictObject({
  catalogId: z.literal('founders-facility-face-transcriptions'), schemaVersion: z.literal('1.0.0'),
  scope: z.literal('base-pictured-faces'), reviewStatus: z.literal('ai-transcribed-awaiting-review'),
  executionReady: z.literal(false),
  sources: z.array(z.strictObject({ id: text, filename: text, attachmentId: text, sha256: z.string().regex(/^[a-f0-9]{64}$/) })).length(3),
  facilities: z.array(facilityFaceTranscriptionSchema).length(18),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).superRefine((catalog, ctx) => {
  for (const [field, rows] of [['sources', catalog.sources], ['facilities', catalog.facilities]] as const) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', path: [field], message: 'Duplicate ID' });
  }
  if (new Set(catalog.facilities.map(row => row.name)).size !== catalog.facilities.length) {
    ctx.addIssue({ code: 'custom', path: ['facilities'], message: 'Duplicate name' });
  }
  const sourceIds = new Set(catalog.sources.map(source => source.id));
  for (const [index, face] of catalog.facilities.entries()) if (!sourceIds.has(face.sourceRef)) {
    ctx.addIssue({ code: 'custom', path: ['facilities', index, 'sourceRef'], message: 'Unknown image source' });
  }
});
export type FacilityFaceSegment = DeepReadonly<z.infer<typeof facilityFaceSegmentSchema>>;
export type FacilityFaceTranscription = DeepReadonly<z.infer<typeof facilityFaceTranscriptionSchema>>;
export type FacilityFacesCatalog = DeepReadonly<z.infer<typeof facilityFacesCatalogSchema>>;
export type UnsignedFacilityFacesCatalog = Omit<FacilityFacesCatalog, 'contentHash'>;
