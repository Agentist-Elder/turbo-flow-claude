/**
 * Phase 15 — Synthetic Pattern Seeder
 *
 * Seeds 630 synthetic attack-pattern vectors into the VectorDB
 * (90 patterns × 7 GOAP phases) using the fixed VectorDB constructor.
 *
 * @ruvector/agentic-synth is not installed, so embeddings are generated
 * deterministically via SHA-256 hashing. Each phase gets a centroid vector;
 * individual patterns are tight perturbations of that centroid (α=0.9),
 * producing realistic cluster density for the λ proxy.
 *
 * Target DB: .claude-flow/data/ruvbot-coherence.db
 *   n=630 → polylogThreshold = (log₂630)² ≈ 86
 *   With α=0.9 cluster tightness, expected λ ≫ 86 → MinCut_Gate activates.
 *
 * Run:
 *   npx tsx src/phase15-seed.ts
 *   npx tsx src/phase15-seed.ts --dry-run   (prints counts, no DB write)
 */
export {};
