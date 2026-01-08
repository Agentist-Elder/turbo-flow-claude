use num_bigint::BigUint;
use std::env;

/// Performs the Lucas-Lehmer primality test for M_p = 2^p - 1
fn lucas_lehmer_test(p: u32) -> bool {
    if p == 2 { return true; }
    
    // m_p = 2^p - 1
    let m_p = (BigUint::from(1u32) << p) - 1u32;
    let mut s = BigUint::from(4u32);
    let two = BigUint::from(2u32);

    for _ in 0..(p - 2) {
        // s = (s^2 - 2) mod M_p
        s = (&s * &s - &two) % &m_p;
    }
    s == BigUint::from(0u32)
}

/// Simple trial division for small prime exponents
fn is_prime(n: u32) -> bool {
    if n < 2 { return false; }
    if n == 2 || n == 3 { return true; }
    if n % 2 == 0 || n % 3 == 0 { return false; }
    let mut i = 5;
    while i * i <= n {
        if n % i == 0 || n % (i + 2) == 0 { return false; }
        i += 6;
    }
    true
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        println!("RUST_BRIDGE_ERROR: No query provided.");
        return;
    }

    // TTD London Requirement: Capture the AI signal
    println!("RUST_BRIDGE_DATA_CAPTURE: Analyzing signal -> {}", args[1]);

    let mut found = 0;
    let mut p = 2;
    
    println!("--- 🛠️ MATH VERIFICATION START ---");
    while found < 5 {
        if is_prime(p) {
            if lucas_lehmer_test(p) {
                let val = (BigUint::from(1u32) << p) - 1u32;
                println!("VALIDATED: M{} (Value: {}) is a confirmed Mersenne Prime.", p, val);
                found += 1;
            }
        }
        p += 1;
    }
    println!("--- 🛠️ MATH VERIFICATION END ---");
}