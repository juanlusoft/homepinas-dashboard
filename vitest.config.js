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
    }
  }
});
