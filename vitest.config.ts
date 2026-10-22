import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Bound concurrent files to avoid CPU contention in the shared development runtime.
    maxWorkers: 4,
    // Existing integration fixtures can exceed 5 seconds on a busy shared runtime.
    testTimeout: 30_000,
    include: ['packages/game-core/src/**/*.test.ts'],
  },
});
