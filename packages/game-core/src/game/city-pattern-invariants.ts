import { CITY_PATTERNS_HASH, getCityPattern, getEligibleCityPatterns } from '../patterns/catalog.js';
import { getCityPatternActionSupport } from './city-pattern-rules.js';
import { cityMoveOptionsFor } from './city-move.js';
import { patternRouteSlots, patternConstructionOptions } from './city-pattern-continuations.js';
import { getCityPatternBoard, findCityPatternMatches } from '../patterns/matching.js';
import type { ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState } from './types.js';

export function cityPatternIssues(state: GameState, definition: GameDefinition): ValidationIssue[] {
  if (!state.cityPatterns) return [];
  const facts = state.cityPatterns, flow = state.roundFlow!, issues: ValidationIssue[] = [];
  const report = (message: string) => issues.push({ code: 'CITY_PATTERN_STATE', path: 'cityPatterns', message });
  if (facts.catalogHash !== CITY_PATTERNS_HASH) report('Pattern catalog reference mismatch');
  const players = definition.players.map(player => player.id).sort(), eligible = getEligibleCityPatterns('base', players.length);
  if (new Set(facts.publicPatternIds).size !== 6 || facts.publicPatternIds.some(id => !eligible.some(pattern => pattern.id === id)) || facts.publicPatternIds.filter(id => eligible.find(pattern => pattern.id === id)?.level === 1).length !== 4) report('Public patterns must be four distinct level-I and two level-II eligible patterns');
  if (JSON.stringify(Object.keys(facts.exhaustedFacilityIdsByPlayer).sort()) !== JSON.stringify(players)) report('Exhaustion must cover exactly the registered players');
  for (const [playerId, ids] of Object.entries(facts.exhaustedFacilityIdsByPlayer)) {
    const owned = state.facilities?.panels.find(panel => panel.playerId === playerId)?.placements.map(row => row.cardId) ?? [];
    if (new Set(ids).size !== ids.length || ids.some(id => !owned.includes(id))) report('Exhausted facilities must be unique, owned and placed');
  }
  for (const marker of state.patternMarkers ?? []) {
    let pattern; try { pattern = getCityPattern(marker.patternId); } catch { report('Unknown pattern marker target'); continue; }
    if (!facts.publicPatternIds.includes(marker.patternId)) report('Pattern marker must occupy a public pattern');
    if (!facts.useTracks.some(track => track.playerId === marker.ownerPlayerId && track.patternId === pattern.id)) report('Each pattern marker needs the existing player-pattern use track');
    if (!players.includes(marker.ownerPlayerId)) report('Unknown pattern marker owner');
  }
  const tracks = new Set<string>();
  for (const track of facts.useTracks) {
    const key = `${track.playerId}:${track.patternId}`;
    if (tracks.has(key) || !players.includes(track.playerId)) report('Use tracks must be unique and belong to registered players'); tracks.add(key);
    let pattern; try { pattern = getCityPattern(track.patternId); } catch { report('Unknown use track target'); continue; }
    if (!facts.publicPatternIds.includes(track.patternId) || track.remainingUses > pattern.useCapacity) report('Use track needs a public pattern with a valid remaining count');
  }
  const keys = new Set<string>();
  for (const used of facts.usedSpecialActions) {
    const key = `${used.playerId}:${used.patternId}`;
    if (keys.has(key)) report('Each player can use a particular special at most once per round'); keys.add(key);
    if (!facts.publicPatternIds.includes(used.patternId) || !getCityPatternActionSupport(state.schemaVersion).specialActionPatternIds.includes(used.patternId)) report('Special use needs an implemented public pattern');
    if (!['player-actions', 'harvest', 'cleanup'].includes(flow.stage) || used.turnIndex > flow.turnIndex || state.playerOrder?.[used.turnIndex % players.length] !== used.playerId) report('Special must belong to a reached turn of its actor');
    let usedPattern; try { usedPattern = getCityPattern(used.patternId); } catch { report('Unknown used special'); continue; }
    const consumed = facts.useTracks.find(track => track.playerId === used.playerId && track.patternId === used.patternId);
    if (!consumed || (usedPattern.level === 1 ? consumed.remainingUses !== 0 : consumed.remainingUses >= usedPattern.useCapacity)) report('A used special must consume its actual use track');
    if (usedPattern.forbidsRoleInTurn && flow.rolesByPlayer.some(role => role.playerId === used.playerId && role.used?.turnIndex === used.turnIndex)) report('This special forbids using a role in its action turn');
  }
  if (flow.completedMajorAction === 'special' && !facts.usedSpecialActions.some(used => used.turnIndex === flow.turnIndex && used.playerId === state.playerOrder?.[flow.turnIndex % players.length])) report('Special completion needs its actual use in this exact turn');
  const pending = state.cityPatternContinuation;
  if (pending) {
    const actorId = state.playerOrder?.[flow.turnIndex % players.length];
    if (flow.stage !== 'player-actions' || !actorId || !players.includes(actorId) || !state.players[actorId] || !state.facilities?.panels.some(p => p.playerId === actorId) || !facts.publicPatternIds.includes(pending.patternId)) { report('Continuation needs the scheduled actor and public pattern'); return issues; }
    if (pending.kind === 'declaration-build') {
      const exhausted = facts.exhaustedFacilityIdsByPlayer[actorId] ?? [], panel = state.facilities!.panels.find(p => p.playerId === actorId)!;
      let matches: ReturnType<typeof findCityPatternMatches> = [];
      try { matches = findCityPatternMatches(getCityPatternBoard(panel, state.facilities!.supply), 'PAT-013'); } catch { report('Declaration needs a valid physical facility panel'); }
      if (!state.patternMarkers?.some(m => m.ownerPlayerId === actorId && m.patternId === 'PAT-013') || !matches.some(m => m.facilityCardIds.every(id => exhausted.includes(id)))) report('Declaration construction needs a real announced pattern and exhausted facilities');
    } else if (!flow.majorActionOpened || flow.completedMajorAction !== null || !facts.usedSpecialActions.some(u => u.playerId === actorId && u.patternId === pending.patternId && u.turnIndex === flow.turnIndex) || !state.patternMarkers?.some(m => m.ownerPlayerId === actorId && m.patternId === pending.patternId)) report('Special continuation needs its actual current-turn activation and major quota');
    if (pending.kind === 'city-move') {
      if (state.phase !== 'city-move' || !state.cityMove || state.cityMove.actorId !== actorId) report('Pattern city movement needs its unique owned progress');
      else {
        if (pending.patternId === 'PAT-004' && pending.remainingMoves !== 1) report('Composite power grants exactly one movement');
        if (state.cityMove.status === 'ready' && !cityMoveOptionsFor(state, definition, actorId, flow.roundNumber).length) report('Impossible movement must advance automatically');
        if (state.cityMove.status === 'complete' && (pending.patternId !== 'PAT-004' || !patternRouteSlots(state, definition).length)) report('Only an executable composite route placement may retain completed movement');
      }
    } else {
      if (pending.kind === 'deck-build' && state.facilities!.supply.revision === Number.MAX_SAFE_INTEGER) report('Deck construction must retain revision capacity for its required final shuffle');
      if (state.phase !== 'construction' || !state.construction || state.construction.actorId !== actorId || state.construction.status === 'complete') report('Pattern construction needs its unfinished owned construction');
      else if (state.construction.status === 'ready') {
        try { if (!patternConstructionOptions(state, definition, actorId, pending.kind === 'deck-build' ? 'draw-pile' : 'supply').choices.length) report('Impossible pattern construction must advance automatically'); }
        catch { report('Pending construction requires a valid physical source and panel'); }
      }
    }
  }
  return issues;
}
