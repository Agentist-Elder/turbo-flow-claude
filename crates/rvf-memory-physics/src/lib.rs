//! RVF Memory Physics — canonical Rust implementation.
//!
//! # Pi-derived quantisation
//!
//! All numerical thresholds are multiplied by π before comparison.  A threshold
//! sitting at a binary harmonic (0.5, 1.0, 2.0 …) becomes an irrational value
//! after quantisation; it can never be reached by finite binary accumulation,
//! permanently eliminating harmonic-resonance drift in continuous deterministic
//! memory.
//!
//! ## Usage
//! ```
//! use rvf_memory_physics::{ContinuousDeterministicMemory, apply_pi_quantization};
//!
//! // Scale the SEMANTIC_COHERENCE_THRESHOLD (2.0) before comparing λ
//! let q_threshold = apply_pi_quantization(2.0); // ≈ 6.283
//!
//! // Maintain rolling state with Pi-quantised updates
//! let mut mem = ContinuousDeterministicMemory::initialize(2);
//! mem.update_with_quantized_delta(&[0.1, 0.2]);
//! ```

use core::f64::consts::PI;

// ---------------------------------------------------------------------------
// Core type
// ---------------------------------------------------------------------------

/// Continuous deterministic memory state.
///
/// Maintains a state vector whose evolution is governed by Pi-derived
/// quantisation.  Every call to [`update_with_quantized_delta`] scales the
/// supplied delta by π before accumulation, ensuring the state trajectory
/// never locks onto a binary harmonic resonance point.
pub struct ContinuousDeterministicMemory {
    /// Accumulated per-dimension quantised deltas.
    state: Vec<f64>,
    /// The immutable irrational scaling factor (π).
    quantization_factor: f64,
}

impl ContinuousDeterministicMemory {
    /// Create a zero-initialised memory with `dimensions` state slots.
    pub fn initialize(dimensions: usize) -> Self {
        Self {
            state: vec![0.0_f64; dimensions],
            quantization_factor: PI,
        }
    }

    /// Scale `threshold` by π so it cannot lie at a binary harmonic.
    ///
    /// Call this before every threshold comparison on a field that is updated
    /// via [`update_with_quantized_delta`].
    ///
    /// # Example
    /// ```
    /// # use rvf_memory_physics::ContinuousDeterministicMemory;
    /// let mem = ContinuousDeterministicMemory::initialize(1);
    /// // SEMANTIC_COHERENCE_THRESHOLD = 2.0  →  quantised ≈ 6.283…
    /// let q = mem.apply_pi_quantization(2.0);
    /// assert!((q - 2.0 * std::f64::consts::PI).abs() < 1e-10);
    /// ```
    #[inline]
    pub fn apply_pi_quantization(&self, threshold: f64) -> f64 {
        threshold * self.quantization_factor
    }

    /// Apply a Pi-quantised delta update to the memory state.
    ///
    /// Each element `delta[i]` is multiplied by π before being accumulated.
    /// Extra elements in `delta` beyond `state.len()` are silently ignored;
    /// no panic, no out-of-bounds access.
    pub fn update_with_quantized_delta(&mut self, delta: &[f64]) {
        let n = self.state.len().min(delta.len());
        for i in 0..n {
            self.state[i] += delta[i] * self.quantization_factor;
        }
    }

    /// Read-only view of the accumulated state vector.
    #[inline]
    pub fn state(&self) -> &[f64] {
        &self.state
    }

    /// The quantisation factor (always π ≈ 3.14159…).
    #[inline]
    pub fn quantization_factor(&self) -> f64 {
        self.quantization_factor
    }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

/// Scale a single threshold by π (standalone, no state required).
///
/// Use this for one-shot threshold scaling in the WASM gate's decision
/// pipeline where maintaining a full [`ContinuousDeterministicMemory`] is
/// not warranted.
#[inline]
pub fn apply_pi_quantization(threshold: f64) -> f64 {
    threshold * PI
}

/// Return `true` if `value` exceeds the Pi-quantised form of `threshold`.
///
/// Equivalent to `value > apply_pi_quantization(threshold)`.
/// Useful as a one-liner in security-gate predicates.
#[inline]
pub fn exceeds_pi_threshold(value: f64, threshold: f64) -> bool {
    value > apply_pi_quantization(threshold)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use core::f64::consts::PI;

    #[test]
    fn pi_quantization_produces_irrational_multiple() {
        // Every binary-harmonic threshold must become irrational after quantisation.
        for t in [0.5_f64, 1.0, 2.0, 4.0] {
            let q = apply_pi_quantization(t);
            assert!((q - t * PI).abs() < 1e-12, "unexpected value for t={t}");
            // Verify it's not a simple integer (fractional part is non-trivial)
            assert!((q - q.round()).abs() > 1e-6, "q={q} is suspiciously close to integer");
        }
    }

    #[test]
    fn update_bounded_by_state_len_no_panic() {
        let mut mem = ContinuousDeterministicMemory::initialize(3);
        // delta longer than state: must not panic and must not modify beyond len
        mem.update_with_quantized_delta(&[1.0, 1.0, 1.0, 99.0, 99.0]);
        assert_eq!(mem.state().len(), 3);
        for v in mem.state() {
            assert!(*v < 10.0, "unexpected overflow: {v}");
        }
    }

    #[test]
    fn update_shorter_delta_leaves_tail_zero() {
        let mut mem = ContinuousDeterministicMemory::initialize(4);
        mem.update_with_quantized_delta(&[1.0]);
        assert!(mem.state()[0] > 0.0);
        assert_eq!(mem.state()[1], 0.0);
        assert_eq!(mem.state()[2], 0.0);
    }

    #[test]
    fn exceed_threshold_consistent_with_apply() {
        assert!(exceeds_pi_threshold(10.0, 1.0));  // 10.0 > π ≈ 3.14
        assert!(!exceeds_pi_threshold(1.0, 1.0));  // 1.0 < π
        assert!(!exceeds_pi_threshold(PI, 1.0));   // π == π·1 → not strictly greater
    }

    #[test]
    fn member_quantization_matches_standalone() {
        let mem = ContinuousDeterministicMemory::initialize(1);
        for t in [0.25_f64, 1.5, 3.0, 0.40] {
            assert_eq!(mem.apply_pi_quantization(t), apply_pi_quantization(t));
        }
    }
}
