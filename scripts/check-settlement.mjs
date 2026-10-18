import assert from 'node:assert/strict';
import * as root from '@nomad-city-online/game-core';
import * as game from '@nomad-city-online/game-core/game';

assert.equal(root.settleEventChoice, game.settleEventChoice);
const seats = [
  { id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' },
  { id: 'p3', color: 'green' }, { id: 'p4', color: 'yellow' },
];
function fixture(cardId, count = 4) {
  const setup = root.createPreEntryGame('compiled-settlement', seats.slice(0, count));
  const position = game.gamePositionSchema.parse(game.getGamePosition(setup.state, setup.definition));
  const board = root.loadFoundersBoard(count === 4 ? 'four-player' : 'three-player');
  const card = root.getFoundersEventCard(cardId);
  const nodeId = Object.values(board.resourceNodes).find(node => node.eventDeckColor === card.color).id;
  position.players.p1.balances['columbia-voucher'] = 20;
  position.board.resourceMarkerByNode[nodeId] = { markerDefinitionId: cardId,
    resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
  return { position, definition: setup.definition, context: { gameId: setup.definition.gameId, actorId: 'p1', nodeId, cardId } };
}
let choices = 0;
for (const card of root.FOUNDERS_EVENT_CATALOG.cards) {
  for (const choice of card.choices) {
    const f = fixture(card.id);
    const req = game.getEventChoiceRequirements(f.position, f.definition, f.context, choice.id);
    const result = game.settleEventChoice(JSON.parse(JSON.stringify(f.position)), f.definition, f.context, {
      choiceId: choice.id,
      ...(req.requiresCostDecision ? { costDecision: 'pay' } : {}),
      ...(req.legalInfluenceSlotIds.length ? { influenceSlotId: req.legalInfluenceSlotIds[0] } : {}),
    });
    assert.equal(game.validateGamePosition(result.position, f.definition).success, true);
    assert.equal(Object.isFrozen(result.position), true);
    assert.equal(result.receipt.choiceId, choice.id);
    choices++;
  }
}
assert.equal(choices, 49);
for (const count of [2, 3, 4]) {
  const f = fixture('Y06', count);
  const result = game.settleEventChoice(f.position, f.definition, f.context, { choiceId: 'Y06:2' });
  assert.equal(result.position.players.p1.balances['columbia-voucher'], 33);
  for (const player of f.definition.players.slice(1)) assert.equal(result.position.players[player.id].balances.iron, 1);
}
console.log(JSON.stringify({ status: 'passed', compiledChoices: choices, opponentRewardPlayerCounts: [2, 3, 4], rootAndGameExports: 'matched' }));
