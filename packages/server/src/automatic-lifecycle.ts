import { beginRoundFlow, enableBaseRoleEffects, enableLiskarmEffects, enableRemainingBaseRoleEffects, enableWarehouseEntries,
  enableNestedFacilityEntries, enableCityPatterns, enableCityPatternContinuations, enableCityPatternMajorActions, enableTemporarySettlements,
  openHarvestPhase, openManagedCleanup, getRoundTurn, finishManagedRound, finalizeBaseGame, FOUNDERS_FACILITY_STOCK, deepFreeze } from '@nomad-city-online/game-core';
import type { GameState } from '@nomad-city-online/game-core';
import type { RoomSnapshot, RoomStore } from './room-state.js';

export type AutomaticIssue = 'STORAGE_UNAVAILABLE' | 'COMMIT_CONFLICT' | 'AUTOMATION_BLOCKED' | 'AUTOMATION_LIMIT';
export interface AutomaticProgress {
  readonly status: 'waiting-for-player' | 'finished' | 'pending';
  readonly stateVersion: number;
  readonly issue?: AutomaticIssue;
}
export interface AutomaticAdvance { readonly snapshot: RoomSnapshot; readonly automatic?: AutomaticProgress }
type Step = 'initialize-rounds' | '1.8' | '1.9' | '1.10' | '1.11' | '1.12' | '1.13' | '1.14' | '1.15' | '1.16' | 'harvest' | 'cleanup' | 'finish-round' | 'finalize';
function nextStep(room: RoomSnapshot): Step | null {
  if (!room.lifecycle) return null;
  const s = room.state;
  if (s.phase === 'entry') return s.entry?.status === 'complete' ? 'initialize-rounds' : null;
  const upgrades: Partial<Record<GameState['schemaVersion'], Step>> = { '1.7.0': '1.8', '1.8.0': '1.9', '1.9.0': '1.10',
    '1.10.0': '1.11', '1.11.0': '1.12', '1.12.0': '1.13', '1.13.0': '1.14', '1.14.0': '1.15', '1.15.0': '1.16' };
  if (upgrades[s.schemaVersion]) return upgrades[s.schemaVersion]!;
  if (s.schemaVersion !== '1.16.0') return null;
  if (s.roundFlow?.stage === 'harvest') {
    if (s.phase === 'round-control') return 'harvest';
    if (s.phase === 'harvest' && s.harvest?.status === 'complete') return 'cleanup';
  }
  if (s.roundFlow?.stage === 'cleanup' && getRoundTurn(s, room.definition).actorId === null) return 'finish-round';
  return s.roundFlow?.stage === 'finished' ? 'finalize' : null;
}
export function automaticProgress(room: RoomSnapshot, issue?: AutomaticIssue): AutomaticProgress | undefined {
  if (!room.lifecycle) return undefined;
  return deepFreeze({ stateVersion: room.state.stateVersion,
    status: issue || nextStep(room) ? 'pending' : room.state.finalScoring ? 'finished' : 'waiting-for-player',
    ...(issue ? { issue } : {}) });
}
function applyStep(room: RoomSnapshot, step: Step): GameState {
  const s = room.state, d = room.definition, plan = room.lifecycle!, options = { expectedVersion: s.stateVersion };
  switch (step) {
    case 'initialize-rounds': {
      const oldIds = new Set(FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id));
      return beginRoundFlow(s, d, { ...options, facilityDeckOrder: plan.facilityDeckOrder.filter(id => oldIds.has(id)),
        deckOrder: { yellow: plan.yellowDeckOrder, red: plan.redDeckOrder } });
    }
    case '1.8': return enableBaseRoleEffects(s, d, options);
    case '1.9': return enableLiskarmEffects(s, d, options);
    case '1.10': return enableRemainingBaseRoleEffects(s, d, options);
    case '1.11': return enableWarehouseEntries(s, d, options);
    case '1.12': return enableNestedFacilityEntries(s, d, options);
    case '1.13': return enableCityPatterns(s, d, { ...options, gameplayVersion: 'base', patternOrder: plan.patternOrder });
    case '1.14': return enableCityPatternContinuations(s, d, options);
    case '1.15': return enableCityPatternMajorActions(s, d, options);
    case '1.16': return enableTemporarySettlements(s, d, { ...options, deckOrder: plan.facilityDeckOrder });
    case 'harvest': return openHarvestPhase(s, d, { ...options, roundNumber: s.roundFlow!.roundNumber });
    case 'cleanup': return openManagedCleanup(s, d, options);
    case 'finish-round': return finishManagedRound(s, d, options);
    case 'finalize': return finalizeBaseGame(s, d, options);
  }
}
/** Every automatic boundary is separately CAS-committed. Failed/unconfirmed candidates never escape. */
export async function advanceAutomaticRoom(initial: RoomSnapshot, store: RoomStore): Promise<AutomaticAdvance> {
  if (!initial.lifecycle) return { snapshot: initial };
  let snapshot = initial;
  for (let count = 0; count < 16; count++) {
    let step: Step | null, next: GameState;
    try {
      step = nextStep(snapshot);
      if (!step) return { snapshot, automatic: automaticProgress(snapshot)! };
      next = applyStep(snapshot, step);
      if (next.stateVersion !== snapshot.state.stateVersion + 1) throw new Error('Automatic step did not advance one version');
    } catch { return { snapshot, automatic: automaticProgress(snapshot, 'AUTOMATION_BLOCKED')! }; }
    let committed: boolean;
    try { committed = await store.compareAndSwap(snapshot.roomId, snapshot.state.stateVersion, next); }
    catch { return { snapshot, automatic: automaticProgress(snapshot, 'STORAGE_UNAVAILABLE')! }; }
    if (!committed) return { snapshot, automatic: automaticProgress(snapshot, 'COMMIT_CONFLICT')! };
    snapshot = { ...snapshot, state: next };
  }
  return { snapshot, automatic: automaticProgress(snapshot, 'AUTOMATION_LIMIT')! };
}
