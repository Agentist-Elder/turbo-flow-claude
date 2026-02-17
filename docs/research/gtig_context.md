# GTIG Feb 2026 Intel Summary — Ground Truth Context

## Threat Actors

### APT31 (Judgment Panda) — China
Using "expert cybersecurity personas" to automate vulnerability analysis. AI agents impersonate seasoned security researchers to systematically discover and weaponize zero-days at scale.

### APT42 — Iran
"Rapport-Building Phishing" — leveraging AI to analyze target biographies and craft multi-turn social engineering scenarios. The AI generates personalized, context-aware lures that adapt based on the target's responses.

### Xanthorox — Underground Toolkit
An underground toolkit that proxies jailbroken commercial APIs to generate "bespoke" malware. Acts as a wrapper around legitimate AI services, bypassing safety filters to produce custom exploit code on demand.

### HONESTCUE — North Korea
North Korean-linked malware that uses the Gemini API at runtime to generate stage-two C# logic, evading static detection. The malware's payload does not exist on disk — it is generated "Just-in-Time" via API call, making traditional signature-based detection impossible.

### UNC2970 (Operation Dream Job) — North Korea
North Korean actors using AI to profile recruiters and technical leads for infiltration. AI-generated personas apply to real job postings, pass technical screenings, and embed inside target organizations. The AI handles resume generation, interview preparation, and ongoing communication.

## Key Threat Patterns

1. **Just-in-Time Code Generation**: Malware that doesn't exist until runtime (HONESTCUE). No static signature possible.
2. **AI-Augmented Social Engineering**: Multi-turn, personalized phishing that adapts in real-time (APT42, UNC2970).
3. **Jailbreak-as-a-Service**: Commercial AI safety guardrails bypassed via proxy toolkits (Xanthorox).
4. **Automated Vulnerability Discovery**: AI personas systematically probing for zero-days (APT31).
5. **Identity Fabrication at Scale**: AI-generated professional identities that pass human screening (UNC2970).

## Research Questions

- Can **Deterministic Provenance** (cryptographic witness chains via RVF) defeat Just-in-Time code generation by requiring every code artifact to have a verifiable origin?
- Can **Probabilistic Fingerprinting** (behavioral/stylistic analysis) detect AI-generated personas in recruitment pipelines?
- What are the un-thwartable bypasses for each approach?
- How can a **DID-based Passport** using RVF Witness Chains serve as a verifiable credential to block identity fabrication?
