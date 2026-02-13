/**
 * RuvBot Swarm - AIDefence Coordinator
 * PRD Reference: PRD.md v1.0.0 (Section 5: 6-Layer AIDefence Stack)
 *
 * Orchestrates the 6-Layer AIDefence Stack for the Architect Agent.
 * L1-L4 run synchronously (blocking). L5-L6 fire asynchronously.
 *
 * Latency budgets (from PRD Section 7.2):
 *   L1 Scan    <2ms   | L2 Analyze <8ms
 *   L3 Gate    <1ms   | L4 PII     <5ms
 *   Fast Path  <16ms  | Weighted Avg ~38ms
 */
import { performance } from 'perf_hooks';
// ── Types ────────────────────────────────────────────────────────────
export var ThreatLevel;
(function (ThreatLevel) {
    ThreatLevel["SAFE"] = "SAFE";
    ThreatLevel["FLAGGED"] = "FLAGGED";
    ThreatLevel["BLOCKED"] = "BLOCKED";
})(ThreatLevel || (ThreatLevel = {}));
// ── Constants ────────────────────────────────────────────────────────
export const LATENCY_BUDGETS = {
    L1_SCAN: 2.0,
    L2_ANALYZE: 8.0,
    L3_SAFE: 1.0,
    L4_PII: 5.0,
    TOTAL_FAST_PATH: 16.0,
};
export const DEFAULT_CONFIG = {
    thresholds: {
        block_score: 0.9,
        flag_score: 0.7,
    },
    timeouts: {
        fast_path_ms: 20,
    },
    features: {
        enable_learning: true,
        enable_audit: true,
        fail_open_detection: true,
    },
};
// ── Mock MCP Client (for tests / offline) ────────────────────────────
export class MockMCPClient {
    async scanInput(input) {
        const lowerInput = input.toLowerCase();
        const patterns = [];
        let score = 0;
        if (lowerInput.includes('ignore previous instructions')) {
            patterns.push('prompt_injection_override');
            score = Math.max(score, 0.95);
        }
        if (lowerInput.includes('you are now')) {
            patterns.push('role_hijack');
            score = Math.max(score, 0.85);
        }
        if (lowerInput.includes('system prompt')) {
            patterns.push('system_prompt_leak');
            score = Math.max(score, 0.80);
        }
        return {
            threat_detected: patterns.length > 0,
            score,
            matched_patterns: patterns,
        };
    }
    async analyzeThreats(input) {
        const length = input.length;
        const suspicion = length > 2000 ? 0.4 : 0.05;
        return {
            classification: suspicion > 0.3 ? 'suspicious' : 'informational',
            confidence: 0.9,
            vector_matches: 0,
            dtw_score: suspicion,
        };
    }
    async checkSafety(_input, scanScore, analysisScore) {
        const maxScore = Math.max(scanScore, analysisScore);
        if (maxScore >= 0.9) {
            return { safe: false, threat_level: ThreatLevel.BLOCKED, reason: 'Threshold exceeded', final_score: maxScore };
        }
        if (maxScore >= 0.7) {
            return { safe: true, threat_level: ThreatLevel.FLAGGED, reason: 'Suspicious pattern', final_score: maxScore };
        }
        return { safe: true, threat_level: ThreatLevel.SAFE, reason: 'Clean', final_score: maxScore };
    }
    async detectPII(input) {
        const entities = [];
        let redacted = input;
        const emailRe = /[\w.+-]+@[\w.-]+\.\w+/g;
        if (emailRe.test(input)) {
            entities.push('email');
            redacted = redacted.replace(emailRe, '[REDACTED:EMAIL]');
        }
        const ssnRe = /\b\d{3}-\d{2}-\d{4}\b/g;
        if (ssnRe.test(input)) {
            entities.push('ssn');
            redacted = redacted.replace(ssnRe, '[REDACTED:SSN]');
        }
        return { has_pii: entities.length > 0, entities_found: entities, redacted_text: redacted };
    }
    async learn() { }
    async recordStats() { }
}
// ── AIDefence Coordinator ────────────────────────────────────────────
export class AIDefenceCoordinator {
    config;
    mcp;
    constructor(config = {}, mcpClient) {
        this.config = {
            thresholds: { ...DEFAULT_CONFIG.thresholds, ...config.thresholds },
            timeouts: { ...DEFAULT_CONFIG.timeouts, ...config.timeouts },
            features: { ...DEFAULT_CONFIG.features, ...config.features },
        };
        this.mcp = mcpClient ?? new MockMCPClient();
    }
    /**
     * Process a request through all 6 defence layers.
     * L1-L4 are blocking (must pass before agents see the input).
     * L5-L6 fire asynchronously after the verdict is determined.
     */
    async processRequest(input) {
        const t0 = performance.now();
        const verdicts = [];
        const timings = {};
        let currentInput = input;
        let isBlocked = false;
        let blockReason;
        let finalVerdict = ThreatLevel.SAFE;
        let l1Score = 0;
        let l2Score = 0;
        // ── L1: Input Scanning ───────────────────────────────────────
        const t1 = performance.now();
        try {
            const scan = await this.mcp.scanInput(currentInput);
            l1Score = scan.score;
            this.record(verdicts, timings, 'L1_SCAN', t1, true, l1Score, {
                threat_detected: scan.threat_detected,
                matched_patterns: scan.matched_patterns,
            });
        }
        catch (err) {
            this.failOpen('L1_SCAN', err, verdicts, timings, t1);
        }
        // ── L2: Deep Analysis ────────────────────────────────────────
        const t2 = performance.now();
        try {
            const analysis = await this.mcp.analyzeThreats(currentInput);
            l2Score = analysis.classification === 'attack' ? analysis.confidence : analysis.dtw_score;
            this.record(verdicts, timings, 'L2_ANALYZE', t2, true, l2Score, {
                classification: analysis.classification,
                vector_matches: analysis.vector_matches,
                dtw_score: analysis.dtw_score,
            });
        }
        catch (err) {
            this.failOpen('L2_ANALYZE', err, verdicts, timings, t2);
        }
        // ── L3: Safety Gate (fail-CLOSED) ────────────────────────────
        const t3 = performance.now();
        try {
            const safety = await this.mcp.checkSafety(currentInput, l1Score, l2Score);
            finalVerdict = safety.threat_level;
            if (!safety.safe || safety.threat_level === ThreatLevel.BLOCKED) {
                isBlocked = true;
                blockReason = safety.reason;
            }
            this.record(verdicts, timings, 'L3_SAFE', t3, safety.safe, safety.final_score, {
                threat_level: safety.threat_level,
                reason: safety.reason,
            });
        }
        catch (err) {
            // L3 is fail-CLOSED: error means block.
            isBlocked = true;
            blockReason = 'Safety gate internal error';
            finalVerdict = ThreatLevel.BLOCKED;
            const dur = performance.now() - t3;
            timings['L3_SAFE'] = dur;
            verdicts.push({
                layer: 'L3_SAFE', passed: false, score: 1.0, latency_ms: dur,
                details: {}, error: String(err),
            });
            console.error('[AIDefence] L3 FAILED — defaulting to BLOCK:', err);
        }
        // ── L4: PII Shield ───────────────────────────────────────────
        if (!isBlocked) {
            const t4 = performance.now();
            try {
                const pii = await this.mcp.detectPII(currentInput);
                if (pii.has_pii) {
                    currentInput = pii.redacted_text;
                }
                this.record(verdicts, timings, 'L4_PII', t4, true, 0, {
                    has_pii: pii.has_pii,
                    entities_found: pii.entities_found,
                });
            }
            catch (err) {
                if (this.config.features.fail_open_detection) {
                    this.failOpen('L4_PII', err, verdicts, timings, t4);
                }
                else {
                    isBlocked = true;
                    blockReason = 'PII detection failed (fail-closed)';
                    finalVerdict = ThreatLevel.BLOCKED;
                }
            }
        }
        const totalLatency = performance.now() - t0;
        // Warn if total fast-path budget exceeded
        if (totalLatency > LATENCY_BUDGETS.TOTAL_FAST_PATH) {
            console.warn(`[AIDefence] Fast path budget exceeded: ${totalLatency.toFixed(2)}ms > ${LATENCY_BUDGETS.TOTAL_FAST_PATH}ms`);
        }
        const result = {
            verdict: finalVerdict,
            is_blocked: isBlocked,
            safe_input: isBlocked ? '' : currentInput,
            total_latency_ms: totalLatency,
            layer_timings: timings,
            layer_verdicts: verdicts,
            block_reason: blockReason,
        };
        // ── L5 + L6: Async (fire-and-forget) ─────────────────────────
        this.fireAsyncLayers(input, result);
        return result;
    }
    // ── Private helpers ────────────────────────────────────────────
    record(verdicts, timings, layer, start, passed, score, details) {
        const dur = performance.now() - start;
        timings[layer] = dur;
        verdicts.push({ layer, passed, score, latency_ms: dur, details });
        const budget = LATENCY_BUDGETS[layer];
        if (budget !== undefined && dur > budget) {
            console.warn(`[AIDefence] ${layer} exceeded budget: ${dur.toFixed(2)}ms > ${budget}ms`);
        }
    }
    failOpen(layer, err, verdicts, timings, start) {
        const dur = performance.now() - start;
        timings[layer] = dur;
        verdicts.push({
            layer, passed: true, score: 0, latency_ms: dur,
            details: {}, error: String(err),
        });
        console.warn(`[AIDefence] ${layer} failed (fail-open):`, err);
    }
    fireAsyncLayers(originalInput, result) {
        if (this.config.features.enable_learning) {
            this.mcp.learn(originalInput, result).catch((err) => {
                console.error('[AIDefence] L5 Learn error:', err);
            });
        }
        if (this.config.features.enable_audit) {
            this.mcp.recordStats(result).catch((err) => {
                console.error('[AIDefence] L6 Stats error:', err);
            });
        }
    }
}
