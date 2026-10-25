import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { getCityPattern } from './catalog.js';
import { getFacilityPanelCellAt, getFacilityPanelCell } from '../facilities/panel-definition.js';
import { parseFacilityPanelState } from '../facilities/panel-state.js';
import { isTemporarySettlementCard } from '../facilities/temporary-settlement.js';
import { parseFacilitySupplyState } from '../facilities/supply.js';
import { getFacilityPhysicalCard } from '../facilities/stock.js';
import type { DeepReadonly } from '../game/types.js';
import type { CityPatternCell } from './schema.js';

const name = z.string().min(1);
export const cityPatternBoardSchema = z.strictObject({
  placements: z.array(z.strictObject({
    cardId: name, cellId: z.string().regex(/^CP-[1-4]-[1-3]$/),
    color: z.enum(['red', 'blue', 'yellow', 'rainbow']), exhausted: z.boolean(),
  })).max(12),
}).superRefine((board, ctx) => {
  if (new Set(board.placements.map(row => row.cardId)).size !== board.placements.length) ctx.addIssue({ code: 'custom', message: 'Each facility must occur once' });
  if (new Set(board.placements.map(row => row.cellId)).size !== board.placements.length) ctx.addIssue({ code: 'custom', message: 'Two facilities cannot occupy one cell' });
});
export type CityPatternBoard = DeepReadonly<z.infer<typeof cityPatternBoardSchema>>;
/** Supply and the sole authoritative panel establish ownership/colour. Exhaustion is a trusted read-model input. */
export function getCityPatternBoard(panelInput: unknown, supplyInput: unknown, exhaustedCardIds: readonly string[] = []): CityPatternBoard {
  const panel = parseFacilityPanelState(panelInput, supplyInput), owned = new Set(panel.placements.map(row => row.cardId));
  const supply = parseFacilitySupplyState(supplyInput);
  const retired = (id: string) => supply.stockRef.definitionId === 'project-base-facility-stock' && isTemporarySettlementCard(id) && supply.returnedToBox.includes(id);
  if (new Set(exhaustedCardIds).size !== exhaustedCardIds.length || exhaustedCardIds.some(id => !owned.has(id) && !retired(id))) throw new Error('Exhausted facilities must be distinct owned and placed cards');
  const exhausted = new Set(exhaustedCardIds);
  return deepFreeze({ placements: panel.placements.map(row => ({ ...row, color: getFacilityPhysicalCard(row.cardId).color, exhausted: exhausted.has(row.cardId) })) });
}
export interface CityPatternMatch {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly anchorCellId: string;
  readonly facilityCardIds: readonly string[];
  readonly assignments: readonly {
    readonly requirementIndex: number; readonly cellId: string; readonly cardId: string;
    readonly actualColor: 'red' | 'blue' | 'yellow' | 'rainbow'; readonly requiredColors: readonly ('red' | 'blue' | 'yellow')[];
  }[];
}
/** Exactly four rotations of the original requirements. There is no mirror transform. */
export function getCityPatternRotations(patternId: string) {
  const cells = getCityPattern(patternId).cells;
  return deepFreeze(([0, 90, 180, 270] as const).map(rotation => {
    const transformed = cells.map((cell, requirementIndex) => {
      let row = cell.row, column = cell.column;
      for (let i = 0; i < rotation / 90; i++) [row, column] = [column, -row];
      return { row, column, colors: cell.colors, requirementIndex };
    });
    const minRow = Math.min(...transformed.map(cell => cell.row)), minColumn = Math.min(...transformed.map(cell => cell.column));
    return { rotation, cells: transformed.map(cell => ({ ...cell, row: cell.row - minRow, column: cell.column - minColumn })) };
  }));
}
const accepts = (cell: CityPatternCell, color: CityPatternMatch['assignments'][number]['actualColor']) => color === 'rainbow' || cell.colors.some(allowed => allowed === color);
/** Read-only geometry engine. Extra cells inside a bounding box are allowed; required cells need distinct, unused facilities. */
export function findCityPatternMatches(input: CityPatternBoard, patternId: string): readonly CityPatternMatch[] {
  const board = cityPatternBoardSchema.parse(input), byCell = new Map(board.placements.map(row => [row.cellId, row]));
  const found: CityPatternMatch[] = [], seen = new Set<string>();
  for (const orientation of getCityPatternRotations(patternId)) {
    const height = Math.max(...orientation.cells.map(cell => cell.row)) + 1, width = Math.max(...orientation.cells.map(cell => cell.column)) + 1;
    for (let row = 0; row <= 4 - height; row++) for (let column = 0; column <= 3 - width; column++) {
      const assignments: CityPatternMatch['assignments'][number][] = [];
      for (const requirement of orientation.cells) {
        const target = getFacilityPanelCellAt(row + requirement.row, column + requirement.column), facility = byCell.get(target.id);
        if (!facility || facility.exhausted || !accepts(requirement, facility.color)) break;
        assignments.push({ requirementIndex: requirement.requirementIndex, cellId: target.id, cardId: facility.cardId, actualColor: facility.color, requiredColors: requirement.colors });
      }
      if (assignments.length !== orientation.cells.length) continue;
      const facilityCardIds = assignments.map(item => item.cardId).sort(), key = JSON.stringify(facilityCardIds);
      if (seen.has(key)) continue;
      seen.add(key); found.push({ rotation: orientation.rotation, anchorCellId: getFacilityPanelCellAt(row, column).id, facilityCardIds, assignments });
    }
  }
  return deepFreeze(found);
}
/** Explicitly validates the submitted facility set instead of trusting a claimed rotation or client-side match. */
export function matchCityPatternSelection(input: CityPatternBoard, patternId: string, cardIds: readonly string[]): CityPatternMatch | null {
  if (new Set(cardIds).size !== cardIds.length) return null;
  const expected = JSON.stringify([...cardIds].sort());
  return findCityPatternMatches(input, patternId).find(match => JSON.stringify(match.facilityCardIds) === expected) ?? null;
}
/** Small public utility for tools that need the logical coordinates, never screen coordinates. */
export const getCityPatternCellPosition = getFacilityPanelCell;
