import { createHash } from 'node:crypto';
import { z } from 'zod';
import data from './founders-player-panel.json' with { type: 'json' };
import { deepFreeze } from '../board/hash.js';
import type { DeepReadonly } from '../game/types.js';
import type { FacilityModuleValidation } from './stock.js';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const facilityPanelCellSchema = z.strictObject({ id: z.string().regex(/^CP-[1-4]-[1-3]$/), row: z.number().int().min(0).max(3), column: z.number().int().min(0).max(2) });
export const facilityPanelDefinitionSchema = z.strictObject({
  definitionId: z.literal('founders-player-panel'), definitionVersion: z.literal('1.0.0'),
  rows: z.literal(4), columns: z.literal(3), initialCoreCellId: z.string(), cells: z.array(facilityPanelCellSchema).length(12),
  sources: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ id: z.string().min(1), kind: z.literal('user-photo'), filename: z.string().min(1), attachmentId: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
    z.strictObject({ id: z.string().min(1), kind: z.literal('rulebook'), filename: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), printedPages: z.array(z.number().int().min(1).max(25)).min(1) }),
  ])).length(2), contentHash: hash,
}).superRefine((definition, ctx) => {
  if (new Set(definition.cells.map(cell => cell.id)).size !== 12) ctx.addIssue({ code: 'custom', path: ['cells'], message: 'Duplicate cell ID' });
  if (new Set(definition.cells.map(cell => `${cell.row}:${cell.column}`)).size !== 12) ctx.addIssue({ code: 'custom', path: ['cells'], message: 'Duplicate logical position' });
  if (definition.cells.some(cell => cell.id !== `CP-${cell.row + 1}-${cell.column + 1}`)) ctx.addIssue({ code: 'custom', path: ['cells'], message: 'Cell ID/position mismatch' });
  if (!definition.cells.some(cell => cell.id === definition.initialCoreCellId)) ctx.addIssue({ code: 'custom', path: ['initialCoreCellId'], message: 'Unknown core position' });
  if (new Set(definition.sources.map(source => source.id)).size !== definition.sources.length) ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Duplicate evidence ID' });
});
export type FacilityPanelCell = DeepReadonly<z.infer<typeof facilityPanelCellSchema>>;
export type FacilityPanelDefinition = DeepReadonly<z.infer<typeof facilityPanelDefinitionSchema>>;
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Panel hash requires JSON data');
  return json;
}
export function canonicalFacilityPanelContent(input: FacilityPanelDefinition | Omit<FacilityPanelDefinition, 'contentHash'>): string {
  const { contentHash: _ignored, ...definition } = input as FacilityPanelDefinition;
  const byId = (a: { readonly id: string }, b: { readonly id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return canonicalize({ hashProtocol: 'nco-player-panel-c14n-v1', definition: { ...definition, cells: [...definition.cells].sort(byId), sources: [...definition.sources].sort(byId) } });
}
export function computeFacilityPanelHash(input: FacilityPanelDefinition | Omit<FacilityPanelDefinition, 'contentHash'>): string {
  return `sha256:${createHash('sha256').update(canonicalFacilityPanelContent(input), 'utf8').digest('hex')}`;
}
export const FOUNDERS_FACILITY_PANEL_HASH = 'sha256:138c13fd41068830138c5111c3212b3a9f3bf2fda30dd12835e9166f6bdef904';
export function validateFoundersFacilityPanel(input: unknown): FacilityModuleValidation<FacilityPanelDefinition> {
  const parsed = facilityPanelDefinitionSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const actual = computeFacilityPanelHash(parsed.data), issues: string[] = [];
  if (actual !== parsed.data.contentHash) issues.push('Panel hash mismatch');
  if (actual !== FOUNDERS_FACILITY_PANEL_HASH) issues.push('Panel differs from source-verified baseline');
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(parsed.data) };
}
export function parseFoundersFacilityPanel(input: unknown): FacilityPanelDefinition {
  const result = validateFoundersFacilityPanel(input);
  if (!result.success) throw new Error(`Invalid facility panel: ${result.issues.join('; ')}`);
  return result.data;
}
export const FOUNDERS_FACILITY_PANEL = parseFoundersFacilityPanel(data);
export function getFacilityPanelCell(id: string): FacilityPanelCell {
  const cell = FOUNDERS_FACILITY_PANEL.cells.find(row => row.id === id);
  if (!cell) throw new RangeError(`Unknown panel cell: ${id}`);
  return cell;
}
export function getFacilityPanelCellAt(row: number, column: number): FacilityPanelCell {
  if (!Number.isInteger(row) || !Number.isInteger(column)) throw new RangeError('Panel position must be integer row/column');
  const cell = FOUNDERS_FACILITY_PANEL.cells.find(cell => cell.row === row && cell.column === column);
  if (!cell) throw new RangeError('Panel position out of bounds');
  return cell;
}
/** Logical grid adjacency only; no pixel/3D coordinates or world-map movement distances. */
export function getFacilityPanelOrthogonalNeighbors(id: string): readonly FacilityPanelCell[] {
  const cell = getFacilityPanelCell(id);
  return deepFreeze(FOUNDERS_FACILITY_PANEL.cells.filter(other => Math.abs(other.row - cell.row) + Math.abs(other.column - cell.column) === 1));
}
export function areFacilityPanelCellsAdjacent(firstId: string, secondId: string): boolean {
  const first = getFacilityPanelCell(firstId), second = getFacilityPanelCell(secondId);
  return Math.abs(first.row - second.row) + Math.abs(first.column - second.column) === 1;
}
