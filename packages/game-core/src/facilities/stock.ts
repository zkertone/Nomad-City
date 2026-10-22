import { createHash } from 'node:crypto';
import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import type { DeepReadonly } from '../game/types.js';
import { FOUNDERS_FACILITY_COLOR_COUNTS, FOUNDERS_FACILITY_COLOR_COUNTS_HASH } from './catalog.js';
import { getFacilityCopyCountRecords } from './inventory.js';

const colors = ['red', 'blue', 'yellow', 'rainbow'] as const;
export const facilityPhysicalCardSchema = z.strictObject({
  id: z.string().min(1), facilityId: z.string().min(1), color: z.enum(colors),
  group: z.enum(['ordinary', 'core-command-tower', 'extension-hub']),
});
export const facilityStockSchema = z.strictObject({
  definitionId: z.literal('founders-base-facility-stock'), definitionVersion: z.literal('1.0.0'),
  quantityCatalogRef: z.strictObject({ catalogId: z.literal('founders-facility-copy-counts'), schemaVersion: z.literal('2.0.0'), contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
  sourceRefs: z.array(z.string().min(1)).min(1),
  cards: z.array(facilityPhysicalCardSchema).length(48),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type FacilityPhysicalCard = DeepReadonly<z.infer<typeof facilityPhysicalCardSchema>>;
export type FacilityStockDefinition = DeepReadonly<z.infer<typeof facilityStockSchema>>;
export type FacilityModuleValidation<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly issues: readonly string[] };

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Stock hash requires JSON data');
  return json;
}
export function canonicalFacilityStockContent(input: FacilityStockDefinition | Omit<FacilityStockDefinition, 'contentHash'>): string {
  const { contentHash: _ignored, ...definition } = input as FacilityStockDefinition;
  return canonicalize({ hashProtocol: 'nco-facility-stock-c14n-v1', definition: { ...definition,
    cards: [...definition.cards].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  } });
}
export function computeFacilityStockHash(input: FacilityStockDefinition | Omit<FacilityStockDefinition, 'contentHash'>): string {
  return `sha256:${createHash('sha256').update(canonicalFacilityStockContent(input), 'utf8').digest('hex')}`;
}
function confirmedPhysicalCards(): FacilityPhysicalCard[] {
  return getFacilityCopyCountRecords().flatMap(record => colors.flatMap(color => Array.from({ length: record.copyCountsByColor[color] }, (_, index) => ({
    id: `FC:${record.id}:${color}:${String(index + 1).padStart(2, '0')}`, facilityId: record.id, color,
    group: record.id === 'FAC-CORE-COMMAND-TOWER' ? 'core-command-tower' as const : record.id === 'FAC-018' ? 'extension-hub' as const : 'ordinary' as const,
  }))));
}
export const FOUNDERS_FACILITY_STOCK_HASH = 'sha256:fd2b5bdebaace746684ec0edb01571db6e2866fcaa718c62a57449bd747a4e58';
export function validateFoundersFacilityStock(input: unknown): FacilityModuleValidation<FacilityStockDefinition> {
  const parsed = facilityStockSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const definition = parsed.data, issues: string[] = [];
  if (definition.quantityCatalogRef.contentHash !== FOUNDERS_FACILITY_COLOR_COUNTS_HASH) issues.push('Wrong confirmed quantity catalog');
  const expected = new Map(confirmedPhysicalCards().map(card => [card.id, card]));
  const ids = new Set<string>();
  for (const card of definition.cards) {
    if (ids.has(card.id)) issues.push(`Duplicate physical card: ${card.id}`);
    ids.add(card.id);
    const original = expected.get(card.id);
    if (!original || original.facilityId !== card.facilityId || original.color !== card.color || original.group !== card.group) issues.push(`Unconfirmed physical card: ${card.id}`);
  }
  const actual = computeFacilityStockHash(definition);
  if (actual !== definition.contentHash) issues.push('Stock content hash mismatch');
  if (actual !== FOUNDERS_FACILITY_STOCK_HASH) issues.push('Stock differs from confirmed physical inventory');
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(definition) };
}
export function parseFoundersFacilityStock(input: unknown): FacilityStockDefinition {
  const result = validateFoundersFacilityStock(input);
  if (!result.success) throw new Error(`Invalid facility stock: ${result.issues.join('; ')}`);
  return result.data;
}
const unsigned = {
  definitionId: 'founders-base-facility-stock', definitionVersion: '1.0.0',
  quantityCatalogRef: { catalogId: FOUNDERS_FACILITY_COLOR_COUNTS.catalogId, schemaVersion: FOUNDERS_FACILITY_COLOR_COUNTS.schemaVersion, contentHash: FOUNDERS_FACILITY_COLOR_COUNTS_HASH },
  sourceRefs: ['rules-20230803-p01', 'rules-20230803-p02-p03', 'user-2026-10-22-facility-quantity-clarification', 'user-2026-10-22-e-enterprise-o-infected'],
  cards: confirmedPhysicalCards(),
} as const;
export const FOUNDERS_FACILITY_STOCK = parseFoundersFacilityStock({ ...unsigned, contentHash: computeFacilityStockHash(unsigned) });
export function getFoundersPhysicalFacilityCard(id: string): FacilityPhysicalCard {
  const card = FOUNDERS_FACILITY_STOCK.cards.find(row => row.id === id);
  if (!card) throw new RangeError(`Unknown base physical facility card: ${id}`);
  return card;
}
