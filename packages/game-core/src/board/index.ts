import { founders3 } from './definitions/founders-3.js';
import { founders4 } from './definitions/founders-4.js';
import { parseBoardDefinition } from './validate.js';
import type { BoardDefinition, MapSide } from './types.js';

export * from './types.js';
export * from './schema.js';
export * from './hash.js';
export * from './validate.js';
export * from './topology.js';
export * from './state.js';
export { founders3, founders4 };

/** Supported map side, deliberately not the number of players. */
export function loadFoundersBoard(mapSide: MapSide): BoardDefinition {
  switch (mapSide) {
    case 'three-player': return parseBoardDefinition(founders3);
    case 'four-player': return parseBoardDefinition(founders4);
    default: throw new RangeError(`Unsupported map side: ${String(mapSide)}`);
  }
}
