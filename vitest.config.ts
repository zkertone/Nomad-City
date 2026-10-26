import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: [{ find: /^@nomad-city-online\/game-core$/, replacement: fileURLToPath(new URL('./packages/game-core/src/index.ts', import.meta.url)) }] },
  test: {
    environment: 'node',
    // Bound concurrent files to avoid CPU contention in the shared development runtime.
    maxWorkers: 4,
    // Existing integration fixtures can exceed 5 seconds on a busy shared runtime.
    testTimeout: 30_000,
    include: ['packages/game-core/src/**/*.test.ts', 'packages/server/src/**/*.test.ts'],
  },
});
