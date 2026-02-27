//! Generated FlatBuffers Rust bindings — single source of truth for Rust serialisation.
//!
//! DO NOT EDIT the `*_generated.rs` files directly.
//! Regenerate with:
//!   flatc --rust --gen-mutable -o crates/flatbuffers-schemas-rust/src \
//!         -I schemas/ schemas/*.fbs
//! (run from the workspace root)

#![allow(
    unused_imports,
    dead_code,
    non_snake_case,
    clippy::all,
    clippy::pedantic
)]

pub mod common_generated;
pub mod wasm_gate_generated;
pub mod rpc_bridge_generated;
pub mod unix_sentinel_generated;
pub mod l3_gateway_generated;
