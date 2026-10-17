import { buildDefinition } from './build.js';

/** Independent transcription of Map-Analysis v0.1.0 REVIEW-02, section 5A. */
export const founders3 = buildDefinition('three-player', [
  ['A', 3], ['B', 3], ['C', 3], ['D', 3], ['E', 4], ['F', 4], ['R', 3],
], [
  ['A-01', 'green'], ['A-02', 'green'], ['A-03', 'yellow'],
  ['B-01', 'green'], ['B-02', 'green'], ['B-03', 'yellow'],
  ['C-01', 'green'], ['C-02', 'yellow'], ['C-03', 'yellow'],
  ['D-01', 'yellow'], ['D-02', 'yellow'], ['D-03', 'yellow'],
  ['E-01', 'yellow'], ['E-02', 'red'], ['E-03', 'red'],
  ['F-01', 'red'], ['F-02', 'red'], ['F-03', 'red'],
], [
  ['F-route-01', 'F', ['F-03', 'F-01'], 1],
  ['F-route-02', 'F', ['F-01', 'D-02'], 1],
  ['F-route-03', 'F', ['F-01', 'F-02'], 1],
  ['E-route-01', 'E', ['E-03', 'E-02', 'C-03'], 2],
  ['E-route-02', 'E', ['F-02', 'E-02', 'E-01'], 2],
  ['D-route-01', 'D', ['D-02', 'D-03', 'D-01', 'A-03'], 2],
  ['D-route-02', 'D', ['F-02', 'D-02', 'D-03'], 2],
  ['A-route-01', 'A', ['A-01', 'A-02'], 1],
  ['A-route-02', 'A', ['A-02', 'A-03', 'B-03'], 2],
  ['B-route-01', 'B', ['A-02', 'B-02'], 1],
  ['B-route-02', 'B', ['B-01', 'B-02', 'C-01'], 2],
  ['C-route-01', 'C', ['C-03', 'C-02'], 1],
  ['C-route-02', 'C', ['C-02', 'B-02', 'B-03', 'C-01'], 2],
  ['R-route-01', 'R', ['D-01', 'A-01'], 1],
  ['R-route-02', 'R', ['A-01', 'B-01'], 1],
  ['R-route-04', 'R', ['F-03', 'E-03', 'F-02'], 2],
  ['R-route-06', 'R', ['D-03', 'B-03', 'E-01'], 2],
  ['R-route-07', 'R', ['A-02', 'B-01'], 2],
  ['R-route-08', 'R', ['C-03', 'E-01'], 1],
  ['R-route-09', 'R', ['C-02', 'E-01'], 1],
]);
