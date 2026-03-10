import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default run excludes integration tests that require a live MCP daemon.
    // Run integration tests: npx vitest run --config vitest.integration.config.ts
    //
    // PRODUCTION TODO: The three coherence tests below require a pre-seeded
    // ruvbot-coherence.db (809 attack vectors via MiniLM-L6-v2 ONNX embeddings).
    // CI always starts cold with no DB. To enable in CI: add provision-model.ts
    // and seed-red-team.ts steps to ci.yml with model caching (~90MB ONNX model).
    // See scripts/provision-model.ts and scripts/seed-red-team.ts.
    exclude: [
      'tests/integration/**',
      'tests/security/red-team-coherence.spec.ts',
      'tests/security/coherence-gate-wiring.spec.ts',
      'tests/security/vector-scanner.spec.ts',
      'node_modules/**',
    ],
  },
});
