import type { ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState } from './types.js';
import { FOUNDERS_BASE_ROLES } from './round-schema.js';
import { facilityEntrySpec } from './facility-entry-rules.js';
import { getFacilityPhysicalCard } from '../facilities/stock.js';
import { isBaseRoleModeAvailableInFormat } from './role-rules.js';
import { hasLiskarmCleanup, ownBoardInfluenceSlotIds } from './liskarm-rules.js';
import { patternMajorActionReady, bothRoleModesAllowed } from './city-pattern-major-actions.js';

/** Cross-check the sole round cursor against existing action progress; never duplicate economic state. */
export function roundFlowIssues(state: GameState, definition: GameDefinition): ValidationIssue[] {
  const flow = state.roundFlow;
  if (!flow) return [];
  const issues: ValidationIssue[] = [], count = definition.players.length, order = state.playerOrder ?? [];
  const report = (message: string) => { issues.push({ code: 'ROUND_FLOW', path: 'roundFlow', message }); };
  if (JSON.stringify(flow.rolesByPlayer.map(row => row.playerId).sort()) !== JSON.stringify(definition.players.map(row => row.id).sort())) report('Role inventory must cover exactly the registered players');
  for (const role of flow.rolesByPlayer) {
    const ids = [...role.hand, ...role.discarded, ...(role.placed === null ? [] : [role.placed])];
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(FOUNDERS_BASE_ROLES.map(role => role.id))) report(`Five distinct initial roles must be conserved for ${role.playerId}`);
    if (role.used) {
      if (role.placed !== null || !role.discarded.includes(role.used.roleId)) report('Used role must be in discard, with no unused placed role');
      if (!['player-actions', 'harvest', 'cleanup'].includes(flow.stage) || role.used.turnIndex > flow.turnIndex || order[role.used.turnIndex % count] !== role.playerId) report('Role use must belong to this player in a reached action turn');
      if (!isBaseRoleModeAvailableInFormat(role.used.roleId, role.used.mode, state.schemaVersion) || (role.used.mode === 'both' && !bothRoleModesAllowed(state, role.playerId, role.used.turnIndex))) report('Both modes require starting-player or actual command-pattern authority');
      if (role.used.roleId === 'ROLE-01' && !['1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion)) report('Liskarm requires snapshot 1.9.0');
      if (hasLiskarmCleanup(role.used)) {
        if (typeof role.used.cleanupResolved !== 'boolean') report('Liskarm strategy requires an explicit cleanup obligation');
        if (role.used.cleanupResolved && flow.stage !== 'cleanup') report('Delayed removal cannot be resolved before cleanup');
        if (flow.stage === 'cleanup' && !role.used.cleanupResolved && !ownBoardInfluenceSlotIds(state, role.playerId).length) report('Impossible cleanup automatically resolves when cleanup opens');
      } else if (role.used.cleanupResolved !== undefined) report('Only Liskarm strategy has this cleanup obligation');
    }
  }
  // This managed flow currently supports ordinary base-price construction only. Do not silently
  // skip delayed/continuous effects from a facility that the implementation cannot execute.
  for (const holding of state.facilities?.supply.playerHoldings ?? []) for (const id of holding.cardIds) {
    try { if (getFacilityPhysicalCard(id).group !== 'core-command-tower') facilityEntrySpec(id); }
    catch { report('Managed rounds cannot contain an unsupported built facility'); }
  }
  const placedPlayers = new Set(flow.rolesByPlayer.filter(row => row.placed !== null || row.used != null).map(row => row.playerId));
  if (flow.stage === 'role-removal') {
    if (count !== 2 || flow.supplyRemovalCount >= 2 || flow.rolePlacementCount !== 0) report('Two-player removals precede every role placement');
  } else if (flow.stage === 'finished') {
    if (flow.roundNumber !== 8 || flow.supplyRemovalCount !== 0 || flow.rolePlacementCount !== 0) report('Only eight completed rounds finish exploration');
  } else if (flow.supplyRemovalCount !== (count === 2 ? 2 : 0)) report('Required supply removals must be complete before placing roles');
  if (flow.stage === 'role-placement' && flow.rolePlacementCount >= count) report('Completed role placement must enter player actions');
  if (['player-actions', 'harvest', 'cleanup'].includes(flow.stage) && flow.rolePlacementCount !== count) report('All players must place a role before actions');
  if (flow.stage === 'cleanup' && !['1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion)) report('Explicit role cleanup requires snapshot 1.9.0');
  const expectedPlaced = order.slice(0, flow.rolePlacementCount);
  if (placedPlayers.size !== expectedPlaced.length || expectedPlaced.some(id => !placedPlayers.has(id))) report('Placed roles must follow clockwise placement progress');
  if (flow.completedMajorAction != null && (flow.stage !== 'player-actions' || !flow.majorActionOpened || (state.phase !== 'round-control' && state.cityPatternContinuation?.kind !== 'declaration-build') || (!['1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) && !flow.rolesByPlayer.some(role => role.playerId === order[flow.turnIndex % count] && role.used?.turnIndex === flow.turnIndex)))) report('Retired major action must preserve completion in its exact turn');
  if (flow.stage === 'player-actions') {
    if (flow.turnIndex >= count * 2) report('Each player receives one turn in each of two cycles');
    const actorId = order[flow.turnIndex % count];
    if ((flow.majorActionOpened && flow.completedMajorAction == null && !patternMajorActionReady(state)) || state.cityPatternContinuation) {
      const action = state.phase === 'exploration' ? state.exploration : state.phase === 'city-move' ? state.cityMove
        : state.phase === 'influence-action' ? state.influenceAction : state.phase === 'construction' ? state.construction : undefined;
      if (!action || action.actorId !== actorId || action.roundNumber !== flow.roundNumber) report('Active major action must belong to the current turn and round');
    } else if (state.phase !== 'round-control') report('Before the major action only round control is active');
  } else {
    if (flow.majorActionOpened) report('No major grant outside player actions');
    if (flow.turnIndex !== (['harvest', 'cleanup'].includes(flow.stage) ? count * 2 : 0)) report('Round cursor does not match its stage');
    if (flow.stage === 'harvest') {
      if (state.phase !== 'round-control' && (state.phase !== 'harvest' || state.harvest?.roundNumber !== flow.roundNumber)) report('Harvest follows both cycles in the current round');
    } else if (state.phase !== 'round-control') report('Role placement and finished exploration have no active action');
  }
  return issues;
}
