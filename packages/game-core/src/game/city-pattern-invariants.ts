import { CITY_PATTERNS_HASH, getCityPattern, getEligibleCityPatterns } from '../patterns/catalog.js';
import { IMPLEMENTED_PATTERN_SPECIALS } from './city-pattern-rules.js';
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
    if (!facts.publicPatternIds.includes(used.patternId) || !(IMPLEMENTED_PATTERN_SPECIALS as readonly string[]).includes(used.patternId)) report('Special use needs an implemented public pattern');
    if (!['player-actions', 'harvest', 'cleanup'].includes(flow.stage) || used.turnIndex > flow.turnIndex || state.playerOrder?.[used.turnIndex % players.length] !== used.playerId) report('Special must belong to a reached turn of its actor');
    let usedPattern; try { usedPattern = getCityPattern(used.patternId); } catch { report('Unknown used special'); continue; }
    const consumed = facts.useTracks.find(track => track.playerId === used.playerId && track.patternId === used.patternId);
    if (!consumed || (usedPattern.level === 1 ? consumed.remainingUses !== 0 : consumed.remainingUses >= usedPattern.useCapacity)) report('A used special must consume its actual use track');
    if (usedPattern.forbidsRoleInTurn && flow.rolesByPlayer.some(role => role.playerId === used.playerId && role.used?.turnIndex === used.turnIndex)) report('This special forbids using a role in its action turn');
  }
  if (flow.completedMajorAction === 'special' && !facts.usedSpecialActions.some(used => used.turnIndex === flow.turnIndex && used.playerId === state.playerOrder?.[flow.turnIndex % players.length])) report('Special completion needs its actual use in this exact turn');
  return issues;
}
