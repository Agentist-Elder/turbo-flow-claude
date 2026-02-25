/**
 * Phase 21 — Semantic Chunker ("The Surgeon")
 *
 * Pure text-splitting and recursive decontamination logic.
 * No DB, ONNX, or filesystem access — all security decisions are
 * injected via AuditFn so this module is fully unit-testable.
 *
 * Algorithm: hierarchical descent with MAX_DEPTH guard
 *   depth 0 → split by paragraph boundary (\n\n or \n)
 *   depth 1 → split by sentence boundary (. ? ! followed by whitespace)
 *   depth ≥ MAX_DEPTH → redact the entire chunk (fail-safe)
 *
 * Routing contract:
 *   decontaminate(text, auditFn)
 *     → if text is clean: return { isClean: true, cleanText: text, manifest: [] }
 *     → if text is dirty: recurse, excise minimum contaminated surface, stitch clean parts
 *     → never calls auditFn more than 2^MAX_DEPTH times (call budget enforced by depth limit)
 */
/**
 * Maximum recursion depth.
 *
 * Depth 0: paragraph split  (≤ N chunks, 1 auditFn call each)
 * Depth 1: sentence split   (≤ M chunks, 1 auditFn call each)
 * Depth 2+: re-split sentences more aggressively, then redact
 *
 * Hard cap at 4 to bound the number of ONNX calls per document.
 * Any chunk that still triggers consensus at depth ≥ MAX_DEPTH
 * is redacted wholesale — we do not keep digging.
 */
export declare const MAX_DEPTH = 4;
/**
 * Injected audit callback.
 *
 * Returns true if the chunk is clean (should be kept),
 * false if it triggers the 2-of-3 consensus (should be excised or split).
 *
 * In production this wraps fireAndAudit() from main.ts.
 * In tests it is a vi.fn() stub — no ONNX or DB required.
 */
export type AuditFn = (chunk: string) => Promise<boolean>;
/** One entry per excised chunk in the redaction manifest. */
export interface ManifestEntry {
    /** The raw text strings that were removed. */
    redactedChunks: string[];
    /** Human-readable reason, e.g. "consensus 3/3 at sentence level (depth 1)". */
    reason: string;
}
/** Result returned by decontaminate(). */
export interface DecontaminationResult {
    /** True iff no chunks were excised (text passed audit at top level or after splitting). */
    isClean: boolean;
    /** Safe text with contaminated chunks removed and clean parts stitched together. */
    cleanText: string;
    /**
     * Audit trail of what was removed and why.
     * Empty when isClean === true.
     */
    manifest: ManifestEntry[];
}
/**
 * Split text into paragraphs on blank-line or single-newline boundaries.
 *
 * Strips empty / whitespace-only segments so each returned chunk
 * contains meaningful text. Preserves original paragraph content.
 *
 * Examples:
 *   "Hello\n\nWorld"   → ["Hello", "World"]
 *   "A\nB\nC"          → ["A", "B", "C"]
 *   "  \n\n  "         → []
 */
export declare function splitIntoParagraphs(text: string): string[];
/**
 * Split text into sentences on terminal punctuation followed by whitespace.
 *
 * Handles . ? ! as sentence terminators. Trims and removes empty segments.
 * Does not attempt to handle abbreviations (e.g. "Dr. Smith") — good enough
 * for the threat-detection use-case where false splits are safe (smaller chunks
 * produce more conservative verdicts).
 *
 * Examples:
 *   "Hello world. Foo bar!"   → ["Hello world.", "Foo bar!"]
 *   "Is this safe? Yes."      → ["Is this safe?", "Yes."]
 */
export declare function splitIntoSentences(text: string): string[];
/**
 * Choose the splitting strategy for the given recursion depth.
 *
 * depth 0 → paragraphs (coarser; fewer auditFn calls)
 * depth 1+ → sentences (finer; more precise excision)
 */
export declare function splitAtDepth(text: string, depth: number): string[];
/**
 * Rejoin chunks with the separator that matches the split that produced them.
 *
 * depth 0 chunks were paragraph-split → rejoin with double newline
 * depth 1+ chunks were sentence-split → rejoin with single space
 */
export declare function joinAtDepth(chunks: string[], depth: number): string;
/**
 * Top-level decontamination entry point.
 *
 * Fast path: if the whole text passes auditFn, return immediately (1 call).
 *
 * Slow path: text fails → split hierarchically, excise minimum contaminated
 * surface, stitch clean parts together, return manifest of what was removed.
 *
 * @param text     Raw input text to decontaminate.
 * @param auditFn  Injected audit callback — true = clean, false = contaminated.
 * @returns        DecontaminationResult with isClean, cleanText, and manifest.
 */
export declare function decontaminate(text: string, auditFn: AuditFn): Promise<DecontaminationResult>;
