import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        // Register tsx as a CJS require hook so require('./module') resolves .ts files
        execArgv: ['--require', 'tsx/cjs'],
      }
    },
    // Bridge vi.mock() to CJS require() for route handler tests
    setupFiles: ['./backend/tests/setup-cjs-mocks.js'],
  }
});
