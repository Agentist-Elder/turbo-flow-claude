//! Runtime Behavioural Detection — macOS Endpoint Security Framework stubs.
//!
//! Phase D stubs. Real implementation requires:
//!   - macOS 10.15+
//!   - SIP exemption (csrutil enable --without-fs)
//!   - `com.apple.developer.endpoint-security.client` entitlement
//!
//! On non-macOS platforms the module compiles to no-ops so the library
//! can be developed and tested on Linux (the devcontainer).

/// Events we subscribe to on macOS.
/// Values match the ESF event type constants from endpoint-sec 0.4.3.
#[derive(Debug, Clone, Copy)]
pub enum MonitoredEvent {
    /// Intercept process execution — deny execution from /tmp/
    AuthExec,
    /// Observe anonymous memory mappings with executable permissions
    NotifyMmap,
    /// Observe W→X mprotect transitions (JIT attack pattern)
    NotifyMprotect,
}

/// Error type for endpoint monitor operations.
pub type MonitorError = Box<dyn std::error::Error + Send + Sync>;

/// Build and return a running Endpoint Security client subscribed to
/// AUTH_EXEC, NOTIFY_MMAP, and NOTIFY_MPROTECT.
///
/// The returned handle must stay alive for monitoring to continue.
/// Drop it to unsubscribe.
///
/// UNVERIFIED: endpoint_sec::Client API shape in 0.4.3.
#[cfg(target_os = "macos")]
pub fn build_es_client() -> Result<endpoint_sec::Client, MonitorError> {
    // Phase D stub — real implementation in Phase I
    Err("Phase D stub — not implemented".into())
}

/// Linux / other platforms: monitoring is not available.
/// Returns an error so callers can degrade gracefully.
#[cfg(not(target_os = "macos"))]
pub fn build_es_client() -> Result<(), MonitorError> {
    Err("endpoint-sec requires macOS with ESF entitlement".into())
}

/// ESF event handler — called by the client for each subscribed event.
///
/// Policy decisions:
///   - AUTH_EXEC from /tmp/ or /var/tmp/ → DENY
///   - NOTIFY_MPROTECT with new_protection including EXEC → log alert
///   - NOTIFY_MMAP anonymous + executable → log alert
///
/// UNVERIFIED: es_message_t pointer type and safety contract in 0.4.3.
#[cfg(target_os = "macos")]
pub unsafe fn handle_es_event(
    _message: *const std::ffi::c_void, // placeholder — real type: *const es_message_t
) {
    // Phase D stub — real implementation in Phase I
}
