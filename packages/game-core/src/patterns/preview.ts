import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { parseFacilitySupplyState } from '../facilities/supply.js';
import { parseFacilityPanelState } from '../facilities/panel-state.js';
import { getCityPattern, getEligibleCityPatterns } from './catalog.js';
import { cityPatternIdSchema, gameplayVersionSchema } from './schema.js';
import { findCityPatternMatches, getCityPatternBoard, matchCityPatternSelection } from './matching.js';

export const cityPatternPreviewContextSchema = z.strictObject({
  gameId: z.string().min(1), actorId: z.string().min(1), gameplayVersion: gameplayVersionSchema,
  playerCount: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  expectedSupplyRevision: z.number().int().nonnegative().safe(), expectedPanelRevision: z.number().int().nonnegative().safe(),
  publicPatternIds: z.array(cityPatternIdSchema).length(6), exhaustedFacilityCardIds: z.array(z.string().min(1)).max(12),
  availableMarkerCount: z.number().int().min(0).max(30),
}).superRefine((context, ctx) => {
  if (new Set(context.publicPatternIds).size !== 6) ctx.addIssue({ code: 'custom', message: 'Public patterns must be distinct' });
});
/** Trusted internal quote only: it does not check a turn window or modify score, markers, facilities or actions. */
export function previewCityPatternDeclaration(panelInput: unknown, supplyInput: unknown, rawContext: unknown, patternId: string, selectedCardIds?: readonly string[]) {
  const context = cityPatternPreviewContextSchema.parse(rawContext), supply = parseFacilitySupplyState(supplyInput), panel = parseFacilityPanelState(panelInput, supply);
  if (context.gameId !== panel.gameId || context.actorId !== panel.playerId || context.playerCount !== supply.playerHoldings.length) throw new Error('Pattern preview game/player/count mismatch');
  if (context.expectedSupplyRevision !== supply.revision || context.expectedPanelRevision !== panel.revision) throw new Error('Stale pattern preview revisions');
  const eligible = getEligibleCityPatterns(context.gameplayVersion, context.playerCount), ids = new Set(eligible.map(pattern => pattern.id));
  if (context.publicPatternIds.some(id => !ids.has(id)) || context.publicPatternIds.filter(id => getCityPattern(id).level === 1).length !== 4) throw new Error('Public patterns must be four level-I and two level-II eligible cards');
  const pattern = getCityPattern(patternId), board = getCityPatternBoard(panel, supply, context.exhaustedFacilityCardIds), issues: string[] = [];
  if (!context.publicPatternIds.includes(patternId)) issues.push('PATTERN_NOT_PUBLIC');
  if (!ids.has(patternId)) issues.push('PATTERN_VERSION');
  if (!context.availableMarkerCount) issues.push('NO_AVAILABLE_MARKER');
  const matches = findCityPatternMatches(board, patternId);
  const selectedMatch = selectedCardIds === undefined ? null : matchCityPatternSelection(board, patternId, selectedCardIds);
  if (selectedCardIds === undefined ? !matches.length : !selectedMatch) issues.push('NO_VALID_LAYOUT');
  return deepFreeze({ status: issues.length ? 'not-eligible' as const : 'layout-eligible' as const, issues,
    patternId, printedScore: pattern.printedScore, matches, selectedMatch,
    declarationEffect: pattern.declarationEffect, specialAction: pattern.specialAction, useCapacity: pattern.useCapacity,
    effectText: pattern.effectText, authoritativeActionGranted: false as const });
}
