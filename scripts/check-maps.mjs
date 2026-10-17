import assert from 'node:assert/strict';
import {
  loadFoundersBoard, validateBoardDefinition, isBoardConnected,
  areNodesDirectlyConnected, createEmptyBoardState,
} from '@nomad-city-online/game-core/board';

for (const mapSide of ['three-player', 'four-player']) {
  const board = loadFoundersBoard(mapSide);
  assert(validateBoardDefinition(board).success);
  assert(isBoardConnected(board));
  assert(areNodesDirectlyConnected(board, 'D-02', 'A-03', 'D-route-01'));
  console.log(JSON.stringify({
    mapSide, definitionId: board.definitionId, version: board.definitionVersion,
    hash: board.contentHash, nodes: Object.keys(board.resourceNodes).length,
    routes: Object.keys(board.routes).length, slots: Object.keys(board.influenceSlots).length,
  }, null, 2));
}
const state = createEmptyBoardState(loadFoundersBoard('three-player'), ['p1', 'p2']);
assert.equal(Object.keys(state.cityNodeByPlayer).length, 2);
console.log('PASS: compiled package import, both maps, fork incidence, two-player empty snapshot');
