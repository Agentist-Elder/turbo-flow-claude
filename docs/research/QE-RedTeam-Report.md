# SPARC Pseudocode Document
> Generated: 2026-02-27T21:40:27.112Z
> AIDefence: PASSED

---

As a senior engineering thought-partner in Red-Team mode, I've reviewed the provided `common.fbs` schema with the objective of identifying critical vulnerabilities at the contract level that could "break the Tri-System." My analysis focuses on the four areas you've highlighted.

Here are the critical vulnerabilities identified:

### 1. Provenance Spoofing (XXH3 digest vs ED25519 signature replay)

**Vulnerability:** Critical - Replay Attack Vector

The `ProvenanceRecord` table (LINE 99-106) defines a `signature` field (LINE 103) which is an `Ed25519Signature` over `(digest ‖ timestamp_ns)`. While the inclusion of `timestamp_ns` (LINE 104) in the signed data is a good practice to mitigate simple replay, the schema itself does not enforce *how* this timestamp should be validated by the consuming system.

If the receiving system (e.g., the Unix Adaptive Sentinel) does not implement strict freshness or monotonic checks on `timestamp_ns` for a given `(origin_system, public_key)` pair, an attacker can intercept a valid `ProvenanceRecord` and replay it at a later time. This could lead to:
*   **Double-spending or double-action**: If the record authorizes an action, replaying it could trigger the action again.
*   **Stale state injection**: An attacker could reintroduce old, valid state changes, potentially rolling back or confusing system state.

Furthermore, the `witness_chain_height` field (LINE 105) is part of the `ProvenanceRecord` but is *not* included in the data signed by the `Ed25519Signature`. This means an attacker could potentially modify the `witness_chain_height` value of an otherwise valid `ProvenanceRecord` without invalidating the signature. While this would likely be caught by higher-level chain validation logic, it introduces a logical inconsistency at the contract level that could be exploited if validation is incomplete or delayed.

The explicit warning in the schema at LINE 71:
```fbs
LINE│ /// Vulnerability flag: do NOT use XXH3 alone for origin verification;
LINE│ /// this key authenticates the originating system via ED25519.
```
...correctly identifies that `Xxh3Digest` (XXH3-128) is not for authentication. However, the replay vulnerability stems from the handling of the signed `timestamp_ns` and the unsigned `witness_chain_height`, not the digest itself.

**Example Attack Scenario:**
1.  A legitimate `WasmSecurityGate` sends a `ProvenanceRecord` authorizing a critical policy update.
2.  An attacker intercepts this record.
3.  Later, the attacker replays the exact same `ProvenanceRecord` to the `UnixAdaptiveSentinel`.
4.  If the `Sentinel` only validates the signature and `content_digest` but not the recency of `timestamp_ns`, it might re-apply the old policy update, potentially overwriting a newer one or causing a denial of service by repeatedly applying the same update.

**Mitigation (Implementation-level):**
*   The receiving system *must* implement strict validation of `timestamp_ns`, ensuring it is within an acceptable freshness window or strictly monotonic for the given `(origin_system, public_key)`.
*   The `witness_chain_height` must be validated against the current state of the append-only chain, independent of the signature, to prevent logical inconsistencies.

### 2. Memory Exhaustion on Pi Zero via massive DomainContext 768-dim embeddings

**Vulnerability:** High - Denial of Service (DoS)

The `DomainContext` table (LINE 112-118) includes an `embedding` field (LINE 115) defined as `[float32]`, with the comment specifying it as a "768-element ONNX embedding vector."

```fbs
LINE│ table DomainContext {
LINE│   source_domain   : DomainId;
LINE│   target_domain   : DomainId;
LINE│   embedding       : [float32];   // 768-element ONNX embedding vector
LINE│   confidence      : float32;     // Model confidence in source classification
LINE│   transfer_score  : float32;     // Cosine similarity between domain embeddings
LINE│ }
```

Each `float32` occupies 4 bytes. Therefore, a single `embedding` vector consumes `768 * 4 = 3072 bytes` (approximately 3KB). While 3KB is not "massive" in isolation for a typical server, the target environment is a Raspberry Pi Zero, which typically has 512MB of RAM.

The vulnerability arises from the potential for an attacker to send a large *quantity* of `DomainContext` messages, or a single FlatBuffers message containing a vector of `DomainContext` objects (e.g., `vector_of_contexts: [DomainContext];` in a parent table). If the Node.js Unix Sentinel (running on the Pi Zero) is designed to accumulate these `DomainContext` objects in memory for processing, caching, or analysis, a malicious actor could flood the system with these 3KB objects, rapidly exhausting the Pi Zero's limited memory.

**Example Attack Scenario:**
1.  An attacker crafts a FlatBuffers message containing a vector of, say, 100,000 `DomainContext` objects. This single message would require `100,000 * 3KB = 300MB` of memory just for the embeddings, plus FlatBuffers overhead.
2.  The `WasmSecurityGate` or `L3ApiGateway` forwards this message to the `UnixAdaptiveSentinel`.
3.  The `Sentinel` attempts to deserialize and process this message, leading to rapid memory consumption and a potential Out-Of-Memory (OOM) error, causing the service to crash or become unresponsive.

**Mitigation (Application-level):**
*   Implement strict message size limits at the RPC bridge and within the Node.js Unix Sentinel.
*   Apply rate limiting on incoming `DomainContext` messages per source.
*   Enforce memory quotas for processing incoming data streams and for any accumulated state on the Pi Zero.
*   Avoid unbounded accumulation of `DomainContext` objects in memory; process them in a streaming fashion or with strict batch size limits.

### 3. Toxic Injection via XXH3-64 path hash collisions

**Vulnerability:** Critical - Data Integrity / Access Control Bypass

The schema defines `Xxh3Digest` (LINE 63-67) as a 128-bit hash:
```fbs
LINE│ struct Xxh3Digest {
LINE│   lo : uint64;   // low  64 bits
LINE│   hi : uint64;   // high 64 bits
LINE│ }
```
This is explicitly `XXH3-128`. The prompt, however, specifically mentions "XXH3-64 path hash collisions."

The vulnerability here is not in the schema's definition of a 128-bit hash, but in the *potential for an implementation to implicitly or explicitly truncate this 128-bit digest to 64 bits* when used for security-sensitive operations, particularly "path hashing" or other forms of resource identification/access control.

XXH3-64 has a significantly higher collision probability than XXH3-128. If a system component (e.g., in the Node.js Sentinel or Rust WASM Gate) uses only the `lo` (low 64 bits) of the `Xxh3Digest` for path resolution, caching keys, or access control decisions, an attacker could craft two different inputs (e.g., file paths, resource identifiers) that produce the same 64-bit hash.

**Example Attack Scenario:**
1.  A legitimate path `/safe/resource.txt` has an `Xxh3Digest` where `lo` is `0xDEADBEEF...`.
2.  An attacker crafts a malicious path `/malicious/payload.sh` such that its `Xxh3Digest` also has `lo` as `0xDEADBEEF...` (a 64-bit collision).
3.  If the system uses only the 64-bit `lo` part of the digest to identify or authorize access to resources, the attacker's malicious path could be mistakenly treated as the legitimate path, leading to:
    *   **Unauthorized access**: Accessing a restricted file.
    *   **Data corruption**: Overwriting a legitimate file.
    *   **Privilege escalation**: Executing an unauthorized script.

**Mitigation (Implementation-level):**
*   Any security-sensitive operation that relies on `Xxh3Digest` for uniqueness, integrity, or access control *must* use the full 128-bit value (`lo` and `hi`).
*   Conduct a thorough code audit to ensure no implicit or explicit truncation of `Xxh3Digest` to 64 bits occurs in critical paths, especially those involving file system interactions, resource lookups, or access control lists.

### 4. Type confusion between Rust ubyte and TS Uint8Array across the RPC bridge

**Vulnerability:** High - Memory Corruption / Remote Code Execution (RCE)

The `WitnessEntry` table (LINE 120-132) includes an `optional` field `pq_signature` (LINE 131) defined as `[ubyte]`:
```fbs
LINE│   pq_signature   : [ubyte];           // Optional: post-quantum wrapper (Decoupled Hardware CA)
```
In FlatBuffers, `[ubyte]` translates to `&[u8]` in Rust and `Uint8Array` in TypeScript. While FlatBuffers handles the serialization and deserialization of these types correctly at a low level, the vulnerability lies in the *application-level handling* of this variable-length byte array.

If the Rust WASM Gate or Node.js Unix Sentinel code expects `pq_signature` to be of a specific, fixed length (e.g., based on the requirements of a particular post-quantum signature algorithm) but does not explicitly validate the received length, it could lead to:
*   **Buffer Overflows**: If the application allocates a fixed-size buffer for the `pq_signature` and an attacker sends a `pq_signature` that is larger than expected, writing past the end of the allocated buffer could corrupt adjacent memory, leading to crashes or RCE.
*   **Buffer Underflows**: If the received `pq_signature` is shorter than expected, and the application attempts to read beyond its bounds (e.g., assuming a fixed structure), it could read uninitialized memory, leading to information leakage or unpredictable behavior.
*   **Incorrect Interpretation**: Without length validation, the application might misinterpret the bytes, leading to cryptographic failures or logical errors.
*   **Optional Field Handling**: The field is marked `Optional`. If the consuming code does not correctly handle the `null` or `None` case for an optional vector, it could lead to null pointer dereferences or crashes.

**Example Attack Scenario:**
1.  The post-quantum signature scheme used expects a `pq_signature` of exactly 256 bytes.
2.  The Rust or Node.js code allocates a 256-byte buffer and then copies the incoming `pq_signature` into it, *without checking the length* provided by FlatBuffers.
3.  An attacker crafts a `WitnessEntry` with a `pq_signature` that is 512 bytes long.
4.  When the application attempts to copy the 512-byte signature into the 256-byte buffer, it overflows the buffer, potentially overwriting critical data on the stack or heap, leading to RCE.

**Mitigation (Implementation-level):**
*   All code paths that process `pq_signature` in both Rust and TypeScript *must* explicitly validate its length against the expected size for the specific post-quantum signature algorithm in use.
*   Ensure robust handling of the `Optional` nature of the field, gracefully managing cases where `pq_signature` is absent.
*   Avoid unchecked memory access or fixed-size buffer assumptions when dealing with variable-length FlatBuffers vectors. Use safe Rust slice operations and TypeScript array methods with bounds checking.

These vulnerabilities represent significant risks to the Tri-System's security and stability at the contract and implementation boundary. Addressing them requires careful review of the consuming code in both Rust and Node.js, beyond just the schema definition.

Please respond using the continuation_id from this response - your input is needed to proceed.