import assert from 'node:assert/strict';
import * as core from '@nomad-city-online/game-core';
import * as patterns from '@nomad-city-online/game-core/patterns';

for (const key of ['getCityPattern', 'selectCityPatterns', 'findCityPatternMatches', 'previewCityPatternDeclaration']) assert.equal(core[key], patterns[key]);
assert.equal(patterns.CITY_PATTERNS.patterns.length, 15);
assert.equal(patterns.computeCityPatternCatalogHash(patterns.CITY_PATTERNS), patterns.CITY_PATTERNS_HASH);
assert.equal(patterns.getCityPattern('PAT-004').flavor.submittedName, '符合动力系统');
assert.equal(patterns.getCityPattern('PAT-009').minimumGameplayVersion, 'base');
assert.equal(patterns.getCityPattern('PAT-013').declarationEffect, 'construction');
for (const count of [2, 3, 4]) for (const version of ['base', 'enterprise', 'entrepreneur']) {
  const eligible = patterns.getEligibleCityPatterns(version, count), order = eligible.map(row => row.id);
  const selected = patterns.selectCityPatterns(version, count, order);
  assert.equal(eligible.length, version === 'base' ? 13 : 15);
  assert.equal(selected.length, 6); assert.equal(selected.filter(id => patterns.getCityPattern(id).level === 1).length, 4);
  assert.equal(selected.filter(id => patterns.getCityPattern(id).level === 2).length, 2);
  console.log(JSON.stringify({ playerCount: count, gameplayVersion: version, eligiblePatterns: eligible.length, selectedPatterns: selected.length, scope: 'catalog-filter-only' }));
}
const board = { placements: [
  { cardId: 'first', cellId: 'CP-1-1', color: 'yellow', exhausted: false },
  { cardId: 'second', cellId: 'CP-1-2', color: 'rainbow', exhausted: false },
  { cardId: 'third', cellId: 'CP-1-3', color: 'red', exhausted: false },
] };
const before = JSON.stringify(board), restored = JSON.parse(before), matches = patterns.findCityPatternMatches(restored, 'PAT-001');
assert.equal(matches.length, 1); assert.equal(matches[0].assignments.length, 3);
assert(patterns.matchCityPatternSelection(restored, 'PAT-001', ['third', 'second', 'first']));
restored.placements[1].exhausted = true; assert.equal(patterns.findCityPatternMatches(restored, 'PAT-001').length, 0);
assert.equal(JSON.stringify(board), before);
assert.equal(patterns.getCityPatternSupport().authoritativeDeclarationsImplemented, false);
assert.equal(patterns.getCityPatternSupport().specialActionsImplemented, false);
console.log('PASS: compiled pattern exports, 15 source transcriptions/flavors, nine catalog-filter combinations, 4+2 setup, distinct rainbow match, exhaustion and no action grant');
