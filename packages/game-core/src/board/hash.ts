import { createHash } from 'node:crypto';
import type { BoardDefinition, UnsignedBoardDefinition } from './types.js';

/** V1: sorted object keys and unordered ID arrays, unchanged JSON string values. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).sort().join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalize(object[key])}`,
    ).join(',')}}`;
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Hash input must contain JSON values only');
  return json;
}

export function canonicalBoardContent(board: BoardDefinition | UnsignedBoardDefinition): string {
  const { contentHash: _ignored, ...definition } = board as BoardDefinition;
  return canonicalize({ hashProtocol: 'nco-board-c14n-v1', definition });
}

export function computeBoardContentHash(board: BoardDefinition | UnsignedBoardDefinition): string {
  return `sha256:${createHash('sha256').update(canonicalBoardContent(board), 'utf8').digest('hex')}`;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
