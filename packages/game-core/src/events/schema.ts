import { z } from 'zod';

export const eventColorSchema = z.enum(['green', 'yellow', 'red']);
export const eventAssetSchema = z.enum([
  'orirock', 'originium', 'iron', 'columbia-voucher', 'pure-originium', 'point',
]);
const amountSchema = z.number().int().positive().safe();
export const eventEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('gain'),
    recipient: z.enum(['actor', 'each-opponent']),
    asset: eventAssetSchema,
    amount: amountSchema,
  }).readonly(),
  z.strictObject({
    kind: z.literal('place-influence'),
    scope: z.enum(['standard', 'incident-route', 'event-node-or-incident-route']),
    amount: z.literal(1),
  }).readonly(),
]);
export const eventChoiceSchema = z.strictObject({
  id: z.string().regex(/^[GYR]\d{2}:[1-3]$/),
  narration: z.string().min(1).refine(value => value.trim().length > 0),
  // Describes the printed precondition; this schema does not debit any balance.
  cost: z.strictObject({ asset: z.literal('columbia-voucher'), amount: amountSchema })
    .readonly().nullable(),
  effects: z.array(eventEffectSchema).min(1).readonly(),
}).readonly();
export const eventCardDefinitionSchema = z.strictObject({
  id: z.string().regex(/^[GYR]\d{2}$/),
  title: z.string().min(1),
  color: eventColorSchema,
  hasFourPlayerMark: z.boolean(),
  resourceMarker: z.strictObject({
    resource: z.enum(['orirock', 'originium', 'iron', 'pure-originium']),
    harvestAmount: z.union([z.literal(1), z.literal(2)]),
  }).readonly(),
  description: z.string().min(1),
  choices: z.array(eventChoiceSchema).min(2).max(3).readonly(),
  sourceRef: z.enum(['S1', 'S2', 'S3', 'S4']),
}).superRefine((card, ctx) => {
  const prefix = { green: 'G', yellow: 'Y', red: 'R' }[card.color];
  if (!card.id.startsWith(prefix)) {
    ctx.addIssue({ code: 'custom', path: ['color'], message: 'Card ID and color disagree' });
  }
  card.choices.forEach((choice, index) => {
    if (choice.id !== `${card.id}:${index + 1}`) {
      ctx.addIssue({ code: 'custom', path: ['choices', index, 'id'],
        message: 'Choices must belong to the card and retain printed order' });
    }
  });
}).readonly();

export const foundersEventCatalogSchema = z.strictObject({
  catalogId: z.literal('founders-base-events'),
  schemaVersion: z.literal('1.0.0'),
  definitionVersion: z.literal('1.0.0'),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sources: z.strictObject({
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/),
    confirmedOn: z.literal('2026-10-17'),
    reviewPath: z.literal('docs/Event-Cards-Review-2026-10-17.md'),
    reviewSha256: z.string().regex(/^[a-f0-9]{64}$/),
    textPath: z.literal('docs/Event-Card-Text-2026-10-17.md'),
    textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).readonly(),
  cards: z.array(eventCardDefinitionSchema).length(22).readonly(),
}).superRefine((catalog, ctx) => {
  const expectedIds = [ ['G', 6], ['Y', 10], ['R', 6] ] as const;
  const ids = catalog.cards.map(card => card.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['cards'], message: 'Duplicate card ID' });
  }
  for (const [prefix, count] of expectedIds) {
    for (let i = 1; i <= count; i++) {
      if (!ids.includes(`${prefix}${String(i).padStart(2, '0')}`)) {
        ctx.addIssue({ code: 'custom', path: ['cards'], message: 'Missing base card ID' });
      }
    }
  }
}).readonly();
