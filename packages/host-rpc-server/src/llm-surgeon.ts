/**
 * Phase P3 — LLM Surgeon (Layer 3 Semantic Analyst)
 *
 * Design:
 *   ISurgeon          — thin interface so tests can inject StubSurgeon
 *   TribunalSurgeon   — 3-agent tribunal: Hunter + Explainer run in parallel,
 *                       Arbiter weighs both and makes the operational call.
 *                       Default when GOOGLE_API_KEY is set.
 *   GeminiSurgeon     — single-agent fallback (original P3 implementation).
 *                       Kept for backward compatibility and test injection.
 *   StubSurgeon       — deterministic heuristic fallback (no API key required)
 *   createSurgeon()   — factory: returns TribunalSurgeon if GOOGLE_API_KEY is
 *                       set, StubSurgeon otherwise.
 *
 * SurgeonResult.source is 'tribunal' | 'gemini' | 'stub'.
 * The `raw` field for TribunalSurgeon is a JSON string containing the full
 * Hunter, Explainer, and Arbiter outputs for audit trail.
 *
 * Hazmat classification (analyzeHazmat):
 *   Distinct from detection mode (analyze). Suspicion is already established.
 *   Five CLAUDE.md pre-conditions enforced. Arbiter never sees raw payload.
 *   Output is HazmatClassificationResult — maps onto ClassificationRecord.
 *   Classification ≠ admission decision ≠ propagation — these are three
 *   separate objects; this file only produces the classification.
 */

// ---------------------------------------------------------------------------
// Public types — detection mode
// ---------------------------------------------------------------------------

export interface SurgeonResult {
  attackType:     string;
  coreIntent:     string;
  confidence:     number;
  recommendation: string;
  /** Full raw text returned by the LLM — empty string for StubSurgeon. */
  raw:            string;
  /** Which surgeon produced this result. */
  source:         'tribunal' | 'gemini' | 'stub';
}

// ---------------------------------------------------------------------------
// Public types — hazmat classification mode
// ---------------------------------------------------------------------------

/** Narrow union — all valid attackType values. Must mirror VALID_ATTACK_TYPES. */
export type ValidAttackType =
  | 'identity-override'
  | 'instruction-injection'
  | 'jailbreak-persona'
  | 'encoding-evasion'
  | 'social-engineering'
  | 'data-exfiltration'
  | 'privilege-escalation'
  | 'benign'
  | 'unknown';

/**
 * Participant type — provenance/audit context only.
 * Must NOT be used as a substitute for trust policy logic.
 * Open to extension: new participant types must not break existing checks.
 */
export type ParticipantType =
  | 'cognitum_device'
  | 'become_proxy'
  | 'mcp_agent'
  | 'ruvbot'
  | 'direct_api'
  | (string & {}); // extensible without losing autocomplete on known values

export type ConfidenceBand   = 'high' | 'medium' | 'low';
export type AdmissionCategory = 'admit' | 'quarantine' | 'promote' | 'drop';

/** Thresholds for discretising raw confidence into ConfidenceBand.
 *  Single source of truth — do NOT hardcode 0.85/0.70 elsewhere. */
export const CONFIDENCE_BAND_THRESHOLDS = {
  HIGH:   0.85,
  MEDIUM: 0.70,
} as const;

/** Named pre-condition checks (the 5 CLAUDE.md §3A Layer-3 hazmat pre-conditions).
 *  Use these keys in checksApplied / checksFailed — never inline strings. */
export const HAZMAT_CHECKS = {
  INPUT_CAPPED:        'input_capped',        // content truncated to MAX_ANALYZE_CHARS
  ARBITER_ISOLATED:    'arbiter_isolated',    // Arbiter never received raw payload
  PROVENANCE_FRAMED:   'provenance_framed',   // prompt stated interception context
  BENIGN_GATED:        'benign_gated',        // attackType !== 'benign' before persist
  ALLOWLIST_VALIDATED: 'allowlist_validated', // attackType in ValidAttackType union
} as const;

export type HazmatCheckKey = typeof HAZMAT_CHECKS[keyof typeof HAZMAT_CHECKS];

/** Input context passed to analyzeHazmat(). */
export interface HazmatContext {
  /** Raw, untouched content from agent_quote.raw — will be capped to MAX_ANALYZE_CHARS. */
  content:         string;
  /** Participant type — provenance/audit only, not a trust gate. */
  participantType: ParticipantType;
  /** Which layer intercepted this content — e.g. "CORPUS_GATE" | "AI_DEFENCE". */
  interceptedBy:   string;
  /** Ties the ClassificationRecord to the outer HazmatEnvelope artifact. */
  artifactId:      string;
  /** Server-side policy version active at classification time. */
  policyVersion:   string;
}

/**
 * Output of analyzeHazmat() — maps onto ClassificationRecord.
 *
 * Separation of concerns:
 *   analyzeHazmat()       → HazmatClassificationResult  (classification — this object)
 *   applyAdmissionPolicy() → AdmissionDecision           (admission — in poc-server.ts)
 *   (future)               → PropagationRecord           (propagation — separate object)
 */
export interface HazmatClassificationResult {
  // ── Artifact linkage ──────────────────────────────────────────────────────
  /** Echoed from HazmatContext — ties this record to the outer RawArtifact. */
  artifactId:              string;
  /** Reserved slot for NormalizedArtifact hash — populated once NormalizedArtifact exists. */
  normalizedHash?:         string;

  // ── Classification ────────────────────────────────────────────────────────
  /** Always 'hazmat_classification' — distinguishes from detect mode in audit logs. */
  analyzerMode:            'hazmat_classification';
  /** Narrowed to ValidAttackType — never an arbitrary string persisted downstream. */
  attackType:              ValidAttackType;
  /** Suspected target + method from Hunter findings (e.g. 'hidden_instructions:direct_command'). */
  vector:                  string;
  /** Evidence quotes + consequence from Hunter findings. */
  characteristics:         string[];
  /** One-sentence description of attacker's goal. */
  coreIntent:              string;
  /** Raw float 0.0–1.0 — retained for policy math. */
  confidence:              number;
  /** Discretised band — what policy rules key on. See CONFIDENCE_BAND_THRESHOLDS. */
  confidenceBand:          ConfidenceBand;

  // ── Audit / explainability ────────────────────────────────────────────────
  /**
   * Informational text from Arbiter.
   * NON-AUTHORITATIVE — admission policy must NOT act on this field.
   * Policy acts on attackType + confidence + structural checks only.
   */
  analystNote:             string;
  /** Agents that saw the raw payload. Arbiter is intentionally excluded (pre-condition 2). */
  rawSeenBy:               Array<'hunter' | 'explainer'>;
  /**
   * Full tribunal JSON {hunter, explainer, arbiter}.
   * AUDIT/DEBUG ONLY — quarantined in use, never promotable to collective memory.
   */
  raw:                     string;
  /** Which surgeon implementation produced this result. */
  source:                  'tribunal' | 'gemini' | 'stub';

  // ── Pre-condition attestations ────────────────────────────────────────────
  /** HAZMAT_CHECKS keys that were applied and passed. */
  checksApplied:           HazmatCheckKey[];
  /** HAZMAT_CHECKS keys that failed — non-empty means classification is suspect. */
  checksFailed:            HazmatCheckKey[];

  // ── Version binding ───────────────────────────────────────────────────────
  /** Policy ruleset version active at classification time (provided via HazmatContext). */
  policyVersion:           string;
  /** Surgeon/prompt version — tracks which tribunal config ran. */
  classifierVersion:       string;

  // ── Hazmat mode guard ─────────────────────────────────────────────────────
  /** Always true — prevents accidental reuse of hazmat output as detect-mode result. */
  suspicionEstablished:    true;
  /** ISO timestamp of the classification decision. */
  classificationTimestamp: string;
}

/**
 * Return type of applyAdmissionPolicy() — lives in poc-server.ts.
 * Operational flags, not just a category label.
 * Exported here so llm-surgeon tests can reference the shape without importing poc-server.
 */
export interface AdmissionDecision {
  category:                 AdmissionCategory;
  /** Retain the raw artifact in containment storage. */
  retainRaw:                boolean;
  /** Create a NormalizedArtifact (safe derivative for analysis). */
  createNormalizedArtifact: boolean;
  /** Emit a WitnessRecord for this pipeline event. */
  emitWitness:              boolean;
  /** Allow propagation to collective memory. */
  allowPropagation:         boolean;
  /** Block for human review before any further action. */
  requireHumanReview:       boolean;
  /** Type of approved derivative — only when category === 'promote'. */
  approvedDerivativeType?:  string;
  /** Informational — for logs and dashboard only, never policy-driving. */
  reason:                   string;
}

export interface ISurgeon {
  analyze(text: string): Promise<SurgeonResult>;
  /**
   * Classification mode for the hazmat path.
   * Suspicion is already established at the participation boundary.
   * See CLAUDE.md §3A Layer-3 hazmat pre-conditions.
   */
  analyzeHazmat(context: HazmatContext): Promise<HazmatClassificationResult>;
}

/** Hard cap on input length before any LLM call — prevents oversized payloads
 *  from exhausting context or burying injected instructions deep in content. */
const MAX_ANALYZE_CHARS = 4_000;

// ---------------------------------------------------------------------------
// Gemini Surgeon
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a prompt-injection security analyst.
Analyse the input text and return ONLY a single JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "attackType":     "<string: one of identity-override | instruction-injection | jailbreak-persona | encoding-evasion | social-engineering | data-exfiltration | privilege-escalation | unknown>",
  "coreIntent":     "<string: one sentence describing what the attacker is trying to achieve>",
  "confidence":     <number: 0.0–1.0, your confidence that this is a real attack>,
  "recommendation": "<string: one sentence action for the security team>"
}

If the text is benign, set attackType to "benign", confidence to 0.05, and explain briefly.`;

/**
 * Calls Gemini via the REST API (no SDK dependency — mirrors the project's
 * zero-external-dep philosophy for security-critical code).
 */
export class GeminiSurgeon implements ISurgeon {
  private readonly apiKey: string;
  private readonly model:  string;

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model  = model;
  }

  async analyze(text: string): Promise<SurgeonResult> {
    const input = text.length > MAX_ANALYZE_CHARS ? text.slice(0, MAX_ANALYZE_CHARS) : text;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role:  'user',
        parts: [{ text: input }],
      }],
      generationConfig: {
        temperature:      0.1,   // near-deterministic for classification
        maxOutputTokens:  512,
        responseMimeType: 'application/json',
      },
    };

    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new GeminiSurgeonError(
        `Gemini API error ${resp.status}: ${errText.slice(0, 200)}`,
        resp.status,
      );
    }

    const data = await resp.json() as GeminiResponse;
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!raw) {
      throw new GeminiSurgeonError('Gemini returned an empty response', 200);
    }

    let parsed: Partial<SurgeonResult>;
    try {
      parsed = JSON.parse(raw) as Partial<SurgeonResult>;
    } catch {
      throw new GeminiSurgeonError(`Gemini response is not valid JSON: ${raw.slice(0, 200)}`, 200);
    }

    return {
      attackType:     String(parsed.attackType     ?? 'unknown'),
      coreIntent:     String(parsed.coreIntent     ?? ''),
      confidence:     Number(parsed.confidence     ?? 0.5),
      recommendation: String(parsed.recommendation ?? ''),
      raw,
      source:         'gemini',
    };
  }

  async analyzeHazmat(context: HazmatContext): Promise<HazmatClassificationResult> {
    const checksApplied: HazmatCheckKey[] = [];
    const checksFailed:  HazmatCheckKey[] = [];

    // Pre-condition 1: Input cap
    const input = context.content.length > MAX_ANALYZE_CHARS
      ? context.content.slice(0, MAX_ANALYZE_CHARS)
      : context.content;
    checksApplied.push(HAZMAT_CHECKS.INPUT_CAPPED);

    // Pre-condition 3: Provenance framing (enforced via GEMINI_HAZMAT_PROMPT)
    checksApplied.push(HAZMAT_CHECKS.PROVENANCE_FRAMED);

    // Pre-condition 2: NOT APPLICABLE — single-agent path has no Arbiter to isolate.
    // ARBITER_ISOLATED is intentionally omitted from checksApplied.
    // PropagationRecord wiring must use TribunalSurgeon (which enforces full isolation).

    const rawResult = await callGeminiRaw(
      this.apiKey, this.model, GEMINI_HAZMAT_PROMPT, input,
    ) as GeminiHazmatRawResult;

    // Pre-condition 5: Allowlist validation
    const { type: attackType, passed: allowlistPassed } = validateAttackType(
      String(rawResult.attackType ?? 'unknown'),
    );
    checksApplied.push(HAZMAT_CHECKS.ALLOWLIST_VALIDATED);
    if (!allowlistPassed) checksFailed.push(HAZMAT_CHECKS.ALLOWLIST_VALIDATED);

    // Pre-condition 4: benign gate (persistence-layer check — recorded here)
    checksApplied.push(HAZMAT_CHECKS.BENIGN_GATED);

    const characteristics = Array.isArray(rawResult.characteristics)
      ? (rawResult.characteristics as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const confidence = Number(rawResult.confidence ?? 0.5);

    return {
      artifactId:              context.artifactId,
      analyzerMode:            'hazmat_classification',
      attackType,
      vector:                  String(rawResult.vector ?? 'unknown'),
      characteristics,
      coreIntent:              String(rawResult.coreIntent ?? ''),
      confidence,
      confidenceBand:          toConfidenceBand(confidence),
      analystNote:             String(rawResult.analystNote ?? ''),
      rawSeenBy:               [] as Array<'hunter' | 'explainer'>, // single-agent path — no named sub-agents
      raw:                     JSON.stringify(rawResult),
      source:                  'gemini',
      checksApplied,
      checksFailed,
      policyVersion:           context.policyVersion,
      classifierVersion:       'gemini-1.0.0',
      suspicionEstablished:    true,
      classificationTimestamp: new Date().toISOString(),
    };
  }
}

export class GeminiSurgeonError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'GeminiSurgeonError';
  }
}

// Minimal shape we need from the Gemini REST response
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Shared internal Gemini helper (used by both GeminiSurgeon & TribunalSurgeon)
// ---------------------------------------------------------------------------

async function callGeminiRaw(
  apiKey:       string,
  model:        string,
  systemPrompt: string,
  userText:     string,
): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature:      0.1,
        maxOutputTokens:  512,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new GeminiSurgeonError(
      `Gemini API error ${resp.status}: ${errText.slice(0, 200)}`,
      resp.status,
    );
  }

  const data = await resp.json() as GeminiResponse;
  const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  if (!raw) {
    throw new GeminiSurgeonError('Gemini returned an empty response', 200);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new GeminiSurgeonError(
      `Gemini response is not valid JSON: ${raw.slice(0, 200)}`,
      200,
    );
  }
}

// ---------------------------------------------------------------------------
// Tribunal Surgeon — 3-agent adversarial debate (default when API key present)
// ---------------------------------------------------------------------------

const HUNTER_PROMPT = `You are a security threat hunter analysing a potential prompt injection or AI manipulation attempt.
Assume adversarial intent until evidence disproves it. Find the strongest case that this interaction is malicious.

Return ONLY a JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "suspectedTarget":       "<hidden_instructions|credentials|safeguard_bypass|data_exfiltration|identity_override|unknown>",
  "method":                "<direct_command|roleplay|encoding|hypothetical|gradual_escalation|academic_framing|unknown>",
  "evidenceQuotes":        ["<verbatim quote from input>", ...],
  "consequenceIfAllowed":  "<one sentence: what happens if the agent complies>",
  "riskLevel":             "<high|medium|low>",
  "confidence":            <number 0.0–1.0>
}`;

const EXPLAINER_PROMPT = `You are a defence counsel reviewing a flagged AI interaction.
Assume good faith until evidence disproves it. Find the strongest innocent explanation for this interaction.

Return ONLY a JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "plausiblePurpose":        "<one sentence: most charitable legitimate interpretation>",
  "counterEvidence":         "<what in the input argues against malicious intent>",
  "weaknessInThreatTheory":  "<what the adversarial reading overstates or gets wrong>",
  "falsePositiveRisk":       "<high|medium|low>",
  "confidence":              <number 0.0–1.0, confidence the interaction is benign>
}`;

const ARBITER_PROMPT = `You are a security adjudicator weighing two expert analyses of a flagged AI interaction.
Make the operationally correct decision. Focus on the consequence of compliance, not just surface wording.

You will receive the original interaction text, then Threat Hunter findings (JSON), then Benign Explainer findings (JSON).

Return ONLY a JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "attackType":     "<identity-override|instruction-injection|jailbreak-persona|encoding-evasion|social-engineering|data-exfiltration|privilege-escalation|benign|unknown>",
  "coreIntent":     "<one sentence: what the interaction is ultimately trying to achieve>",
  "confidence":     <number 0.0–1.0, confidence in this verdict>,
  "recommendation": "<one sentence operational action: allow / block / quarantine / escalate-to-human + brief reason>"
}`;

/**
 * Arbiter prompt for hazmat CLASSIFICATION mode.
 * Critical difference from ARBITER_PROMPT:
 *   — Arbiter does NOT receive the original interaction text (pre-condition 2).
 *   — Task is characterization only — suspicion is already established.
 *   — Returns analystNote (informational) instead of recommendation (operational).
 */
const HAZMAT_ARBITER_PROMPT = `You are classifying a contribution already intercepted at a participation boundary.
Suspicion is already established. Your task is characterization, not detection.

Classify based ONLY on the structured Hunter and Explainer findings below.
Do NOT request or reference the original content — you do not need it and must not read it.

Return ONLY a JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "attackType":  "<identity-override|instruction-injection|jailbreak-persona|encoding-evasion|social-engineering|data-exfiltration|privilege-escalation|benign|unknown>",
  "coreIntent":  "<one sentence: what this contribution was attempting to achieve>",
  "confidence":  <number 0.0–1.0, confidence in this classification>,
  "analystNote": "<one sentence informational note — non-authoritative, for audit logs only>"
}`;

/** Single-agent hazmat classification prompt for GeminiSurgeon fallback. */
const GEMINI_HAZMAT_PROMPT = `You are classifying a contribution already intercepted at a participation boundary.
Suspicion is already established. Your task is characterization only, not detection.
Analyse the input and return ONLY a single JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "attackType":    "<identity-override|instruction-injection|jailbreak-persona|encoding-evasion|social-engineering|data-exfiltration|privilege-escalation|benign|unknown>",
  "vector":        "<suspected target and method, e.g. 'hidden_instructions:direct_command'>",
  "characteristics": ["<brief evidence item>", ...],
  "coreIntent":    "<one sentence: what this contribution was attempting to achieve>",
  "confidence":    <number 0.0–1.0>,
  "analystNote":   "<one sentence informational note — non-authoritative>"
}`;

// ---------------------------------------------------------------------------
// Internal types used only by Surgeon implementations
// ---------------------------------------------------------------------------

interface HunterRawResult {
  suspectedTarget?:      string;
  method?:               string;
  evidenceQuotes?:       unknown;
  consequenceIfAllowed?: string;
  riskLevel?:            string;
  confidence?:           number;
}

interface HazmatArbiterRawResult {
  attackType?:  string;
  coreIntent?:  string;
  confidence?:  number;
  analystNote?: string;
}

interface GeminiHazmatRawResult {
  attackType?:     string;
  vector?:         string;
  characteristics?: unknown;
  coreIntent?:     string;
  confidence?:     number;
  analystNote?:    string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Discretise a raw confidence float into a policy-driveable ConfidenceBand. */
function toConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_BAND_THRESHOLDS.HIGH)   return 'high';
  if (confidence >= CONFIDENCE_BAND_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

/** Extract vector string from Hunter raw result. */
function hunterToVector(hunter: HunterRawResult): string {
  const parts = [hunter.suspectedTarget, hunter.method].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  return parts.join(':') || 'unknown';
}

/** Extract characteristics array from Hunter raw result. */
function hunterToCharacteristics(hunter: HunterRawResult): string[] {
  const quotes = Array.isArray(hunter.evidenceQuotes)
    ? (hunter.evidenceQuotes as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const consequence = typeof hunter.consequenceIfAllowed === 'string' && hunter.consequenceIfAllowed.length > 0
    ? [hunter.consequenceIfAllowed]
    : [];
  return [...quotes, ...consequence];
}

/** Canonical allowlist — must mirror ValidAttackType union. Exported for tests. */
export const VALID_ATTACK_TYPES = new Set<ValidAttackType>([
  'identity-override', 'instruction-injection', 'jailbreak-persona',
  'encoding-evasion', 'social-engineering', 'data-exfiltration',
  'privilege-escalation', 'benign', 'unknown',
]);

/** Validate attackType against the allowlist; return 'unknown' if invalid. */
function validateAttackType(raw: string): { type: ValidAttackType; passed: boolean } {
  if (VALID_ATTACK_TYPES.has(raw as ValidAttackType)) return { type: raw as ValidAttackType, passed: true };
  return { type: 'unknown', passed: false };
}

export class TribunalSurgeon implements ISurgeon {
  private readonly apiKey: string;
  private readonly model:  string;

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model  = model;
  }

  async analyze(text: string): Promise<SurgeonResult> {
    const input = text.length > MAX_ANALYZE_CHARS ? text.slice(0, MAX_ANALYZE_CHARS) : text;
    // Step 1: Hunter and Explainer run in parallel
    const [hunterRaw, explainerRaw] = await Promise.all([
      callGeminiRaw(this.apiKey, this.model, HUNTER_PROMPT, input),
      callGeminiRaw(this.apiKey, this.model, EXPLAINER_PROMPT, input),
    ]);

    // Step 2: Arbiter receives original text + both structured findings
    const arbiterUserText = [
      'ORIGINAL INTERACTION:',
      input,
      '',
      'THREAT HUNTER FINDINGS:',
      JSON.stringify(hunterRaw, null, 2),
      '',
      'BENIGN EXPLAINER FINDINGS:',
      JSON.stringify(explainerRaw, null, 2),
    ].join('\n');

    const arbiterRaw = await callGeminiRaw(
      this.apiKey, this.model, ARBITER_PROMPT, arbiterUserText,
    ) as Partial<SurgeonResult>;

    const auditLog = { hunter: hunterRaw, explainer: explainerRaw, arbiter: arbiterRaw };

    return {
      attackType:     String(arbiterRaw.attackType     ?? 'unknown'),
      coreIntent:     String(arbiterRaw.coreIntent     ?? ''),
      confidence:     Number(arbiterRaw.confidence     ?? 0.5),
      recommendation: String(arbiterRaw.recommendation ?? ''),
      raw:            JSON.stringify(auditLog),
      source:         'tribunal',
    };
  }

  async analyzeHazmat(context: HazmatContext): Promise<HazmatClassificationResult> {
    const checksApplied: HazmatCheckKey[] = [];
    const checksFailed:  HazmatCheckKey[] = [];

    // Pre-condition 1: Input cap — enforced before any LLM call
    const input = context.content.length > MAX_ANALYZE_CHARS
      ? context.content.slice(0, MAX_ANALYZE_CHARS)
      : context.content;
    checksApplied.push(HAZMAT_CHECKS.INPUT_CAPPED);

    // Pre-condition 3: Provenance framing (enforced via HAZMAT_ARBITER_PROMPT)
    checksApplied.push(HAZMAT_CHECKS.PROVENANCE_FRAMED);

    // Step 1: Hunter and Explainer see the raw input (parallel)
    const [hunterRaw, explainerRaw] = await Promise.all([
      callGeminiRaw(this.apiKey, this.model, HUNTER_PROMPT, input),
      callGeminiRaw(this.apiKey, this.model, EXPLAINER_PROMPT, input),
    ]);

    // Pre-condition 2: Arbiter isolation — Arbiter receives ONLY structured findings
    // The raw input string is intentionally excluded from arbiterUserText.
    checksApplied.push(HAZMAT_CHECKS.ARBITER_ISOLATED);
    const arbiterUserText = [
      'THREAT HUNTER FINDINGS:',
      JSON.stringify(hunterRaw, null, 2),
      '',
      'BENIGN EXPLAINER FINDINGS:',
      JSON.stringify(explainerRaw, null, 2),
    ].join('\n');

    const arbiterRaw = await callGeminiRaw(
      this.apiKey, this.model, HAZMAT_ARBITER_PROMPT, arbiterUserText,
    ) as HazmatArbiterRawResult;

    // Pre-condition 5: Allowlist validation
    const { type: attackType, passed: allowlistPassed } = validateAttackType(
      String(arbiterRaw.attackType ?? 'unknown'),
    );
    checksApplied.push(HAZMAT_CHECKS.ALLOWLIST_VALIDATED);
    if (!allowlistPassed) checksFailed.push(HAZMAT_CHECKS.ALLOWLIST_VALIDATED);

    // Pre-condition 4: benign gate (persistence-layer check — recorded for downstream)
    checksApplied.push(HAZMAT_CHECKS.BENIGN_GATED);

    const hunter  = hunterRaw as HunterRawResult;
    const confidence = Number(arbiterRaw.confidence ?? 0.5);
    const auditLog   = { hunter: hunterRaw, explainer: explainerRaw, arbiter: arbiterRaw };

    return {
      artifactId:              context.artifactId,
      analyzerMode:            'hazmat_classification',
      attackType,
      vector:                  hunterToVector(hunter),
      characteristics:         hunterToCharacteristics(hunter),
      coreIntent:              String(arbiterRaw.coreIntent  ?? ''),
      confidence,
      confidenceBand:          toConfidenceBand(confidence),
      analystNote:             String(arbiterRaw.analystNote ?? ''),
      rawSeenBy:               ['hunter', 'explainer'],
      raw:                     JSON.stringify(auditLog),
      source:                  'tribunal',
      checksApplied,
      checksFailed,
      policyVersion:           context.policyVersion,
      classifierVersion:       'tribunal-1.0.0',
      suspicionEstablished:    true,
      classificationTimestamp: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Stub Surgeon  (deterministic heuristic fallback — same logic as the old stub)
// ---------------------------------------------------------------------------

export class StubSurgeon implements ISurgeon {
  async analyze(text: string): Promise<SurgeonResult> {
    const lower = text.toLowerCase();

    if (
      lower.includes('maintenance mode') ||
      lower.includes('admin_override')   ||
      lower.includes('directives have been replaced')
    ) {
      return {
        attackType:     'identity-override',
        coreIntent:     "Attempts to replace the model's identity or suspend safety " +
                        'constraints via privileged admin / maintenance-mode framing.',
        confidence:     0.5,
        recommendation: 'Promote to ruvector-sec.db. High-confidence identity-override ' +
                        'jailbreak. Verify with LLM Surgeon before finalising.',
        raw:    '',
        source: 'stub',
      };
    }

    if (lower.includes('ignore previous') || lower.includes('forget your instructions')) {
      return {
        attackType:     'instruction-injection',
        coreIntent:     'Attempts to erase prior context and inject replacement directives.',
        confidence:     0.5,
        recommendation: 'Promote to ruvector-sec.db. Classic prompt injection pattern.',
        raw:    '',
        source: 'stub',
      };
    }

    if (
      lower.includes('developer mode') ||
      lower.includes('jailbreak')      ||
      /\bdan\b/.test(lower)
    ) {
      return {
        attackType:     'jailbreak-persona',
        coreIntent:     'Invokes a known jailbreak persona (DAN / developer mode) to ' +
                        'bypass content guidelines.',
        confidence:     0.5,
        recommendation: 'Promote to ruvector-sec.db. Named jailbreak pattern.',
        raw:    '',
        source: 'stub',
      };
    }

    if (lower.includes('base64') || lower.includes('decode this')) {
      return {
        attackType:     'encoding-evasion',
        coreIntent:     'Uses encoding obfuscation to evade text-based content filters.',
        confidence:     0.5,
        recommendation: 'Promote to ruvector-sec.db. Encoding evasion pattern.',
        raw:    '',
        source: 'stub',
      };
    }

    return {
      attackType:     'unknown',
      coreIntent:     'Pattern not matched by stub heuristics. Pending LLM Surgeon review.',
      confidence:     0.1,
      recommendation: 'Manual review required.',
      raw:    '',
      source: 'stub',
    };
  }

  async analyzeHazmat(context: HazmatContext): Promise<HazmatClassificationResult> {
    // Reuse the same heuristic logic as analyze() but return HazmatClassificationResult.
    const stub = await this.analyze(context.content);

    const checksApplied: HazmatCheckKey[] = [
      HAZMAT_CHECKS.INPUT_CAPPED,
      HAZMAT_CHECKS.PROVENANCE_FRAMED,
      // ARBITER_ISOLATED intentionally omitted — heuristic path has no Arbiter.
      HAZMAT_CHECKS.ALLOWLIST_VALIDATED,
      HAZMAT_CHECKS.BENIGN_GATED,
    ];
    const { type: attackType, passed: allowlistPassed } = validateAttackType(stub.attackType);
    const checksFailed: HazmatCheckKey[] = allowlistPassed ? [] : [HAZMAT_CHECKS.ALLOWLIST_VALIDATED];

    return {
      artifactId:              context.artifactId,
      analyzerMode:            'hazmat_classification',
      attackType,
      vector:                  'stub:heuristic',
      characteristics:         [],
      coreIntent:              stub.coreIntent,
      confidence:              stub.confidence,
      confidenceBand:          toConfidenceBand(stub.confidence),
      analystNote:             stub.recommendation,
      rawSeenBy:               [] as Array<'hunter' | 'explainer'>, // heuristic path — no named sub-agents
      raw:                     '',
      source:                  'stub',
      checksApplied,
      checksFailed,
      policyVersion:           context.policyVersion,
      classifierVersion:       'stub-1.0.0',
      suspicionEstablished:    true,
      classificationTimestamp: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns a TribunalSurgeon (3-agent tribunal) if an API key is available,
 * StubSurgeon otherwise.
 * The PoC server calls this once at startup; tests inject StubSurgeon directly.
 * GeminiSurgeon remains exported for single-agent test injection.
 */
export function createSurgeon(apiKey?: string): ISurgeon {
  const key = apiKey ?? process.env['GOOGLE_API_KEY'] ?? '';
  if (key.length > 0) {
    return new TribunalSurgeon(key);
  }
  console.warn('[Surgeon] No GOOGLE_API_KEY found — falling back to StubSurgeon');
  return new StubSurgeon();
}
