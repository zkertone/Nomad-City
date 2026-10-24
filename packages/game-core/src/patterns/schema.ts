import { z } from 'zod';
import type { DeepReadonly } from '../game/types.js';

const text = z.string().trim().min(1);
export const gameplayVersionSchema = z.enum(['base', 'enterprise', 'entrepreneur']);
export const patternColorSchema = z.enum(['red', 'blue', 'yellow']);
export const cityPatternIdSchema = z.string().regex(/^PAT-\d{3}$/);
export const cityPatternCellSchema = z.strictObject({
  row: z.number().int().min(0).max(2), column: z.number().int().min(0).max(2),
  colors: z.array(patternColorSchema).min(1).max(2).refine(colors => new Set(colors).size === colors.length, 'Duplicate colour alternative'),
});
export const cityPatternSchema = z.strictObject({
  id: cityPatternIdSchema, name: text, edition: z.enum(['base', 'enterprise', 'infected']),
  minimumGameplayVersion: gameplayVersionSchema, level: z.union([z.literal(1), z.literal(2)]),
  printedScore: z.number().int().min(0).max(50), cells: z.array(cityPatternCellSchema).min(2).max(6),
  declarationEffect: z.enum(['unlock', 'gain-resources', 'construction', 'exchange-pattern-marker']),
  specialAction: z.enum(['none', 'replace-one', 'two-extra-major-actions', 'paid-free-city-move-and-route-influence',
    'place-by-pattern-marker-count', 'two-free-city-moves', 'enterprise-two-levels', 'gain-and-extra-major-action',
    'choose-two-tactical-options', 'extra-major-and-both-role-modes', 'place-two-at-city-then-move-x',
    'paid-draw-pile-construction-and-shuffle', 'enterprise-two-levels-and-trigger']),
  useCapacity: z.number().int().min(0).max(2), effectText: text, forbidsRoleInTurn: z.boolean(),
  sourceRef: text, location: text,
  flavor: z.strictObject({ text: z.string().min(1), sourceRef: text, submittedName: text }),
}).superRefine((pattern, ctx) => {
  if (new Set(pattern.cells.map(cell => `${cell.row}:${cell.column}`)).size !== pattern.cells.length) ctx.addIssue({ code: 'custom', path: ['cells'], message: 'Repeated logical position' });
  if (Math.min(...pattern.cells.map(cell => cell.row)) !== 0 || Math.min(...pattern.cells.map(cell => cell.column)) !== 0) ctx.addIssue({ code: 'custom', path: ['cells'], message: 'Shape must have a normalized bounding box' });
  if ((pattern.declarationEffect === 'unlock') !== (pattern.specialAction !== 'none')) ctx.addIssue({ code: 'custom', message: 'Only unlocking declarations grant a special action' });
  const capacity = pattern.declarationEffect === 'unlock' ? pattern.level : 0;
  if (pattern.useCapacity !== capacity) ctx.addIssue({ code: 'custom', path: ['useCapacity'], message: 'Use track must match printed level or announcement-only card' });
});
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const cityPatternCatalogSchema = z.strictObject({
  catalogId: z.literal('founders-city-patterns'), schemaVersion: z.literal('1.0.0'), scope: z.literal('all-15-provided-patterns'),
  sources: z.array(z.strictObject({ id: text, filename: text, libraryFileId: text, attachmentId: text, sha256: sha })).length(3),
  textSources: z.array(z.strictObject({ id: text, kind: z.literal('user-message'), date: z.literal('2026-10-24') })).length(1),
  ruleSources: z.array(z.strictObject({ filename: text, sha256: sha, printedPages: z.array(z.number().int().positive()).min(1) })).length(2),
  patterns: z.array(cityPatternSchema).length(15), contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).superRefine((catalog, ctx) => {
  for (const rows of [catalog.patterns, catalog.sources, catalog.textSources]) if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: 'Duplicate catalog identity' });
  if (new Set(catalog.patterns.map(row => row.name)).size !== catalog.patterns.length) ctx.addIssue({ code: 'custom', message: 'Duplicate pattern name' });
  for (const pattern of catalog.patterns) {
    if (!catalog.sources.some(source => source.id === pattern.sourceRef) || !catalog.textSources.some(source => source.id === pattern.flavor.sourceRef)) ctx.addIssue({ code: 'custom', message: 'Unknown source reference' });
  }
});
export type GameplayVersion = z.infer<typeof gameplayVersionSchema>;
export type CityPattern = DeepReadonly<z.infer<typeof cityPatternSchema>>;
export type CityPatternCell = CityPattern['cells'][number];
export type CityPatternCatalog = DeepReadonly<z.infer<typeof cityPatternCatalogSchema>>;
