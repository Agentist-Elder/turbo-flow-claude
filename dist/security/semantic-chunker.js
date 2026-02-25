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
// ── Constants ─────────────────────────────────────────────────────────────────
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
export const MAX_DEPTH = 4;
// ── Pure Splitting Functions ──────────────────────────────────────────────────
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
export function splitIntoParagraphs(text) {
    return text
        .split(/\n\n+|\n/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}
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
export function splitIntoSentences(text) {
    // Split after . ? ! that is followed by whitespace or end-of-string.
    // The lookbehind keeps the terminator attached to the preceding sentence.
    return text
        .split(/(?<=[.?!])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}
/**
 * Choose the splitting strategy for the given recursion depth.
 *
 * depth 0 → paragraphs (coarser; fewer auditFn calls)
 * depth 1+ → sentences (finer; more precise excision)
 */
export function splitAtDepth(text, depth) {
    return depth === 0
        ? splitIntoParagraphs(text)
        : splitIntoSentences(text);
}
/**
 * Rejoin chunks with the separator that matches the split that produced them.
 *
 * depth 0 chunks were paragraph-split → rejoin with double newline
 * depth 1+ chunks were sentence-split → rejoin with single space
 */
export function joinAtDepth(chunks, depth) {
    return depth === 0
        ? chunks.join('\n\n')
        : chunks.join(' ');
}
// ── Recursive Decontaminator ──────────────────────────────────────────────────
/**
 * Recursively split and audit `chunk` until either:
 *   (a) all sub-pieces pass, or
 *   (b) depth reaches MAX_DEPTH → redact the whole chunk.
 *
 * Not exported — callers use decontaminate() which handles the top-level
 * fast-exit (skip recursion when the full text is already clean).
 */
async function decontaminateChunk(chunk, auditFn, depth) {
    // Hard redact at MAX_DEPTH — do not keep digging.
    if (depth >= MAX_DEPTH) {
        return {
            isClean: false,
            cleanText: '',
            manifest: [{
                    redactedChunks: [chunk],
                    reason: `Hit MAX_DEPTH=${MAX_DEPTH} — chunk redacted at depth ${depth}`,
                }],
        };
    }
    const pieces = splitAtDepth(chunk, depth);
    // Indivisible: cannot split further at this depth → try next depth level.
    // Example: a single sentence at depth 0 (paragraph split returns 1 piece).
    if (pieces.length <= 1) {
        return decontaminateChunk(chunk, auditFn, depth + 1);
    }
    const cleanParts = [];
    const manifest = [];
    for (const piece of pieces) {
        const clean = await auditFn(piece);
        if (clean) {
            cleanParts.push(piece);
        }
        else {
            // Piece fails audit — recurse to next depth.
            const sub = await decontaminateChunk(piece, auditFn, depth + 1);
            if (sub.cleanText.length > 0) {
                cleanParts.push(sub.cleanText);
            }
            // Surface redaction events from the recursive call.
            for (const entry of sub.manifest) {
                manifest.push(entry);
            }
        }
    }
    return {
        isClean: manifest.length === 0,
        cleanText: joinAtDepth(cleanParts, depth),
        manifest,
    };
}
// ── Public Entry Point ────────────────────────────────────────────────────────
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
export async function decontaminate(text, auditFn) {
    const topLevelClean = await auditFn(text);
    if (topLevelClean) {
        return { isClean: true, cleanText: text, manifest: [] };
    }
    return decontaminateChunk(text, auditFn, 0);
}
