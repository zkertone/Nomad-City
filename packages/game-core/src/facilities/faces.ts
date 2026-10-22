import data from './founders-faces.json' with { type: 'json' };
import { deepFreeze } from '../board/hash.js';
import { getFacilityCopyCountRecords } from './inventory.js';
import { facilityFacesCatalogSchema } from './faces-schema.js';
import type { FacilityFaceTranscription, FacilityFacesCatalog, FacilityIconMeaning } from './faces-schema.js';
import { computeFacilityFacesHash } from './faces-hash.js';

export const FOUNDERS_FACILITY_FACES_HASH = 'sha256:840edd051e9c8a97377a0419cf64d663b35d68a2fcd861b5f288560ac6ab614e';
export type FacilityFacesValidationResult =
  | { readonly success: true; readonly catalog: FacilityFacesCatalog }
  | { readonly success: false; readonly issues: readonly string[] };

/** Validates a transcription against inventory identities and a pinned image-reading baseline, not game legality. */
export function validateFoundersFacilityFaces(input: unknown): FacilityFacesValidationResult {
  const parsed = facilityFacesCatalogSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const issues: string[] = [];
  const inventory = getFacilityCopyCountRecords();
  for (const face of parsed.data.facilities) {
    const record = inventory.find(row => row.id === face.id);
    if (!record || record.name !== face.name) issues.push(`Unknown base facility identity: ${face.id}`);
    else if (record.copyCountsByColor[face.observedColor] < 1) issues.push(`Unreported pictured color: ${face.id}`);
  }
  const actual = computeFacilityFacesHash(parsed.data);
  if (actual !== parsed.data.contentHash) issues.push('Facility faces hash mismatch');
  if (actual !== FOUNDERS_FACILITY_FACES_HASH) issues.push('Facility faces differ from pinned image transcription');
  return issues.length ? { success: false, issues } : { success: true, catalog: deepFreeze(parsed.data) };
}
export function parseFoundersFacilityFaces(input: unknown): FacilityFacesCatalog {
  const result = validateFoundersFacilityFaces(input);
  if (!result.success) throw new Error(`Invalid facility faces: ${result.issues.join('; ')}`);
  return result.catalog;
}
export const FOUNDERS_FACILITY_FACES: FacilityFacesCatalog = parseFoundersFacilityFaces(data);
export function getFoundersFacilityFace(id: string): FacilityFaceTranscription {
  const face = FOUNDERS_FACILITY_FACES.facilities.find(row => row.id === id);
  if (!face) throw new RangeError(`Unknown base facility face: ${id}`);
  return face;
}
/** Meanings describe the symbol. They grant no action window, targets, payment exemption or state mutation. */
export function getFacilityIconMeaning(icon: string): FacilityIconMeaning {
  const meaning = FOUNDERS_FACILITY_FACES.iconLegend.find(row => row.icon === icon);
  if (!meaning) throw new RangeError(`Unknown facility icon: ${icon}`);
  return meaning;
}
/** Human-readable rule terms, rather than color/shape labels. Single move symbols stay single moves. */
export function getFacilityEffectText(id: string): string {
  const effect = getFoundersFacilityFace(id).effect;
  const markers = [effect.entryMarker ? '入场' : '', effect.uniqueMarker ? '唯一' : ''].filter(Boolean);
  const value = effect.transcription;
  const body = value.status === 'transcribed'
    ? value.segments.map(segment => segment.kind === 'text' ? segment.text : `〔${getFacilityIconMeaning(segment.icon).label}〕`).join('')
    : value.status === 'partial' ? `${value.fragments.join(' / ')}（部分可读）` : '待辨认';
  return [...markers, body].filter(Boolean).join('；');
}
/** Explicit progress prevents stored partial/unknown text from being reported as completed rules. */
export function getFacilityFaceTranscriptionProgress() {
  const faces = FOUNDERS_FACILITY_FACES.facilities;
  const count = (field: 'flavor' | 'effect', status: 'transcribed' | 'partial' | 'unreadable') => faces.filter(face =>
    (field === 'flavor' ? face.flavor : face.effect.transcription).status === status).length;
  return deepFreeze({
    totalPicturedFaces: faces.length, printedScores: faces.length,
    printedCostAlternatives: faces.filter(face => face.constructionCost.kind === 'printed-alternatives').length,
    costNotPrinted: faces.filter(face => face.constructionCost.kind === 'not-printed').length,
    effects: { transcribed: count('effect', 'transcribed'), partial: count('effect', 'partial'), unreadable: count('effect', 'unreadable') },
    flavor: { transcribed: count('flavor', 'transcribed'), partial: count('flavor', 'partial'), unreadable: count('flavor', 'unreadable') },
    executionReady: false as const, reviewStatus: FOUNDERS_FACILITY_FACES.reviewStatus,
  });
}
