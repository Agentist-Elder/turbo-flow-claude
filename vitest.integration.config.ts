import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests only — require a live MCP daemon (`ruv start`).
    include: ['tests/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
});
