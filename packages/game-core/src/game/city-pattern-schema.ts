import { z } from 'zod';
import { cityPatternIdSchema } from '../patterns/schema.js';

export const patternMarkerSchema = z.strictObject({
  markerId: z.string().min(1), ownerPlayerId: z.string().min(1), patternId: cityPatternIdSchema,
});
export const cityPatternStateSchema = z.strictObject({
  gameplayVersion: z.literal('base'), catalogHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  publicPatternIds: z.array(cityPatternIdSchema).length(6),
  exhaustedFacilityIdsByPlayer: z.record(z.string().min(1), z.array(z.string().min(1)).max(48)),
  useTracks: z.array(z.strictObject({ playerId: z.string().min(1), patternId: cityPatternIdSchema, remainingUses: z.number().int().min(0).max(2) })).max(24),
  usedSpecialActions: z.array(z.strictObject({
    playerId: z.string().min(1), patternId: cityPatternIdSchema, turnIndex: z.number().int().min(0).max(7),
  })).max(24),
});
