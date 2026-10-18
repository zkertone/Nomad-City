import type { BoardDefinition, ValidationIssue } from '../board/types.js';
import { eligibleEntryGreenIds } from './entry-rules.js';
import type { GameDefinition, GameState } from './types.js';

/** Progress consistency, not authentication of a submitted snapshot or its reward history. */
export function entryProgressIssues(state: GameState, definition: GameDefinition, board: BoardDefinition): ValidationIssue[] {
  const entry = state.entry;
  if (!entry) return [];
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string): void => { issues.push({ code: 'ENTRY_PROGRESS', path, message }); };
  const ids = definition.players.map(player => player.id).sort();
  if (JSON.stringify([...entry.playerOrder].sort()) !== JSON.stringify(ids)) report('entry.playerOrder', 'Order must contain exactly the registered players');
  const count = definition.players.length;
  const completed = entry.completedPlayerCount;
  if (completed > count) report('entry.completedPlayerCount', 'Too many completed players');
  const isResolving = entry.status === 'resolving-event';
  if (isResolving !== (entry.pendingEvent !== null)) report('entry.pendingEvent', 'Pending event and status disagree');
  if (['selecting-node', 'resolving-event'].includes(entry.status) && completed >= count) report('entry.status', 'All cities already resolved');
  if (['bonus-influence', 'complete'].includes(entry.status) && completed !== count) report('entry.status', 'Initial city events are not complete');
  if (entry.status === 'bonus-influence' && count !== 2) report('entry.status', 'Only two-player setup has the bonus placement');

  const cityPlayers = new Set(entry.playerOrder.slice(0, completed + (isResolving ? 1 : 0)));
  const cityNodes = new Set<string>();
  for (const player of definition.players) {
    const nodeId = Object.hasOwn(state.board.cityNodeByPlayer, player.id) ? state.board.cityNodeByPlayer[player.id] : null;
    if (cityPlayers.has(player.id) !== (nodeId !== null && nodeId !== undefined)) report(player.id, 'City placement disagrees with entry order');
    if (!nodeId) continue;
    cityNodes.add(nodeId);
    const node = Object.hasOwn(board.resourceNodes, nodeId) ? board.resourceNodes[nodeId] : undefined;
    if (!node?.initialCityEligible || node.eventDeckColor !== 'green') report(player.id, 'Initial city must occupy an eligible green node');
    if (count === 2 && nodeId === 'B-01') report(player.id, 'B-01 is excluded by the two-player appendix');
    if (!state.board.resourceMarkerByNode[nodeId]) report(nodeId, 'Every entry city must have revealed its green marker');
  }
  if (entry.pendingEvent) {
    const pending = entry.pendingEvent;
    if (pending.playerId !== entry.playerOrder[completed]) report('entry.pendingEvent', 'Pending actor disagrees with order');
    if (!Object.hasOwn(state.board.cityNodeByPlayer, pending.playerId) || state.board.cityNodeByPlayer[pending.playerId] !== pending.nodeId) {
      report('entry.pendingEvent', 'Pending event must belong to the current city');
    }
    if (state.board.resourceMarkerByNode[pending.nodeId]?.markerDefinitionId !== pending.cardId) report('entry.pendingEvent', 'Pending card must match the revealed marker');
  }
  const revealed = Object.entries(state.board.resourceMarkerByNode).filter(([, marker]) => marker !== null);
  for (const [nodeId] of revealed) if (!cityNodes.has(nodeId)) report(nodeId, 'Entry cannot explore a node outside the selected cities');
  const eligible = eligibleEntryGreenIds(count);
  const consumed = new Set(revealed.map(([, marker]) => marker!.markerDefinitionId));
  const expectedRemaining = eligible.filter(id => !consumed.has(id)).sort();
  if (JSON.stringify([...entry.remainingGreenEventIds].sort()) !== JSON.stringify(expectedRemaining)) {
    report('entry.remainingGreenEventIds', 'Remaining deck must contain exactly the eligible unconsumed cards');
  }
  const influence = Object.entries(state.board.influenceBySlot).filter(([, marker]) => marker !== null);
  if (count !== 2 || entry.status !== 'complete') {
    if (influence.length) report('board.influenceBySlot', 'No influence placement is part of this entry step');
  } else {
    if (influence.length > 1) report('board.influenceBySlot', 'Two-player setup permits at most one bonus influence');
    for (const [slotId, marker] of influence) {
      const actor = entry.playerOrder[1];
      if (marker!.ownerPlayerId !== actor) report(slotId, 'Only the non-starting player receives the bonus');
      const location = Object.hasOwn(board.influenceSlots, slotId) ? board.influenceSlots[slotId] : undefined;
      if (location?.kind === 'resource-node' && (!state.board.resourceMarkerByNode[location.nodeId] ||
          Object.entries(state.board.cityNodeByPlayer).some(([other, nodeId]) => other !== actor && nodeId === location.nodeId))) {
        report(slotId, 'Bonus placement violates normal node placement conditions');
      }
    }
  }
  return issues;
}
