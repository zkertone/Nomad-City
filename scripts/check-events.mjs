import assert from 'node:assert/strict';
import {
  FOUNDERS_EVENT_CATALOG, validateFoundersEventCatalog,
  getFoundersEventCard, getFoundersEventCards,
} from '@nomad-city-online/game-core/events';
import { FOUNDERS_EVENT_CATALOG as rootExport } from '@nomad-city-online/game-core';

assert.equal(rootExport, FOUNDERS_EVENT_CATALOG);
assert(validateFoundersEventCatalog(FOUNDERS_EVENT_CATALOG).success);
assert.deepEqual(['green', 'yellow', 'red'].map(color => getFoundersEventCards(color).length), [6, 10, 6]);
assert.equal(FOUNDERS_EVENT_CATALOG.cards.reduce((sum, card) => sum + card.choices.length, 0), 49);
assert.equal(getFoundersEventCard('Y01').title, '遭弃矿场');
assert.deepEqual(getFoundersEventCard('Y05').choices[0].cost, { asset: 'columbia-voucher', amount: 4 });
assert(Object.isFrozen(getFoundersEventCard('R06').choices[2].effects));
assert.throws(() => getFoundersEventCard('__proto__'), RangeError);
console.log(JSON.stringify({
  result: 'PASS: compiled events subpath + root exports, approved catalog, narratives and scopes',
  cards: 22, choices: 49, contentHash: FOUNDERS_EVENT_CATALOG.contentHash,
}, null, 2));
