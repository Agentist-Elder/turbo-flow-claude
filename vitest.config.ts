import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default run excludes integration tests that require a live MCP daemon.
    // Run integration tests: npx vitest run --config vitest.integration.config.ts
    exclude: [
      'tests/integration/**',
      'node_modules/**',
    ],
  },
});
