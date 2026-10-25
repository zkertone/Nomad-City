import { createHash } from 'node:crypto';
import { deepFreeze } from '../board/hash.js';
import { facilityFaceTranscriptionSchema } from './faces-schema.js';
import { z } from 'zod';

/** Printing source and gameplay eligibility are separate; never rewrite the original O inventory. */
export const TEMPORARY_SETTLEMENT_RULE = deepFreeze({
  facilityId: 'FAC-017', minimumGameplayVersion: 'base', printingEdition: 'infected',
  ownerApproval: '2026-10-24', copies: 3, color: 'rainbow', rewardVouchers: 12,
  source: { attachmentId: 'libfile_35a1fb9b4b208191be898939b83995df', filename: 'image(1).png',
    sha256: '5a9566cc41f0db71732dbbe5bccfa7808502a26415cde78643ae8359197dca84', location: 'top row, second card' },
});
export const TEMPORARY_SETTLEMENT_FACE = deepFreeze(facilityFaceTranscriptionSchema.extend({ edition: z.literal('infected') }).parse({
  id: 'FAC-017', name: '临时聚居点', edition: 'infected', observedColor: 'rainbow', appliesTo: 'pictured-face-only',
  sourceRef: 'facility-image-1', location: 'top row, second card', printedScore: 0,
  constructionCost: { kind: 'printed-alternatives', resourcePayment: { orirock: 0, originium: 1, iron: 2, pureOriginium: 0, vouchers: 0 }, voucherPayment: 11 },
  effect: { entryMarker: false, uniqueMarker: true, transcription: { status: 'transcribed',
    sourceRef: 'facility-image-1', verificationStatus: 'image-transcribed', segments: [
      { kind: 'text', text: '使用该设施进行宣告城市样式后：可将此牌从城市面板放回游戏盒，获得12金券。' },
    ] } },
  flavor: { status: 'unreadable', reason: 'Small flavor text has not been transcribed; it is not required by the executable rule.' },
}));
export const isTemporarySettlementCard = (id: string): boolean => /^FC:FAC-017:rainbow:0[1-3]$/.test(id);

export const TEMPORARY_SETTLEMENT_SOURCE_HASH = 'sha256:e4792b1f47d2931e2214a5ab0e7f9fe0fab47ef45945e6a12cc82f520b3c2d04';
const actualHash = `sha256:${createHash('sha256').update(JSON.stringify({ hashProtocol: 'nco-temporary-settlement-v1', rule: TEMPORARY_SETTLEMENT_RULE, face: TEMPORARY_SETTLEMENT_FACE })).digest('hex')}`;
if (actualHash !== TEMPORARY_SETTLEMENT_SOURCE_HASH) throw new Error('Temporary settlement differs from the reviewed source transcription');
