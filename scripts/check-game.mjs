import assert from 'node:assert/strict';
import {
  createPreEntryGame, validateGameState, getMarkerLedger, canAffordResources,
} from '@nomad-city-online/game-core/game';
import { createPreEntryGame as rootFactory } from '@nomad-city-online/game-core';

assert.equal(rootFactory, createPreEntryGame);
const seats = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
for (const count of [2, 3, 4]) {
  const game = createPreEntryGame(`game-${count}`, seats.slice(0, count));
  assert(validateGameState(game.state, game.definition).success);
  const ledger = getMarkerLedger(game.state, game.definition);
  assert.equal(Object.keys(ledger).length, 30 * count);
  for (const player of game.definition.players) {
    assert.equal(game.state.markerSupplyByPlayer[player.id].length, 29);
    assert.equal(ledger[game.state.players[player.id].scoreMarkerId].location.kind, 'score');
    assert(!canAffordResources(game.state.players[player.id].balances, [{ asset: 'iron', amount: 1 }]));
  }
  assert(Object.isFrozen(game.state.board.influenceBySlot));
  console.log(JSON.stringify({ players: count, map: game.definition.boardDefinitionRef.definitionId,
    inventory: Object.keys(ledger).length, supplyPerPlayer: 29, scoreMarkersPerPlayer: 1 }));
}
console.log('PASS: compiled /game and root exports, setup, balances and conserved marker ledger');
