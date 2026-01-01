# --- Stage 1: The Factory (Builder) ---
FROM rust:1.84-slim-bookworm as builder
WORKDIR /app

# FIX: Install the missing build tools FIRST
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY . .
# Build the high-performance release binary
RUN cargo build --release

# --- Stage 2: The Shipping Container (Runner) ---
FROM debian:bookworm-slim
WORKDIR /app

# Install security certificates for the runner too
RUN apt-get update && apt-get install -y ca-certificates libssl-dev && rm -rf /var/lib/apt/lists/*

# 1. Copy the compiled binary
COPY --from=builder /app/target/release/aimds-rust .

# 2. Copy the AI Brain
COPY model ./model

# 3. Open the port
EXPOSE 3000

# 4. Run the Engine
CMD ["./aimds-rust"]
