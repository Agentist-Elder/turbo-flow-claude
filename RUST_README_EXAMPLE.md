# Turbo Flow - Rust Edition

A high-performance agentic development environment built in Rust with async-first architecture and multi-agent orchestration capabilities.

[![Crates.io](https://img.shields.io/crates/v/turbo-flow.svg)](https://crates.io/crates/turbo-flow)
[![Docs.rs](https://docs.rs/turbo-flow/badge.svg)](https://docs.rs/turbo-flow)
[![License](https://img.shields.io/crates/l/turbo-flow.svg)](https://github.com/marcuspat/turbo-flow-claude#license)

## Features

- **Async Multi-Agent Orchestration** - Coordinate 610+ specialized agents with tokio-based concurrency
- **DevPod Integration** - First-class support for cloud development environments
- **Type-Safe Configuration** - Leverage Rust's type system for reliable agent coordination
- **High Performance** - Minimal overhead with zero-cost abstractions
- **Spec-Driven Development** - Integration with spec-kit for specification-driven workflows
- **MCP Protocol Support** - Seamless AI model coordination via Model Context Protocol

## Installation

### From Crates.io

```bash
cargo install turbo-flow
```

### From Source

```bash
git clone https://github.com/marcuspat/turbo-flow-claude
cd turbo-flow-claude
cargo install --path .
```

### Requirements

- Rust 1.70 or later
- Tokio runtime (async executor)
- Optional: DevPod for cloud environments

## Quick Start

### Basic Usage

```rust
use turbo_flow::{SwarmCoordinator, Agent, Task};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize coordinator
    let mut coordinator = SwarmCoordinator::new();

    // Register agents
    coordinator.register_agent(Agent::new("analyzer")).await?;
    coordinator.register_agent(Agent::new("executor")).await?;

    // Create and execute task
    let task = Task::new("process_workflow");
    let result = coordinator.execute(task).await?;

    println!("Task result: {:?}", result);
    Ok(())
}
```

### Command-Line Interface

```bash
# Initialize a new project
turbo-flow init my-project
cd my-project

# Run with default configuration
turbo-flow run

# Run with custom config
turbo-flow run --config custom.toml

# List registered agents
turbo-flow agents list

# Execute specific task
turbo-flow task execute my-task
```

## Project Structure

```
turbo-flow/
├── src/
│   ├── lib.rs              # Library root
│   ├── coordinator.rs      # Multi-agent orchestration
│   ├── agent.rs            # Agent trait and implementations
│   ├── task.rs             # Task scheduling and execution
│   ├── mcp/                # Model Context Protocol support
│   └── config.rs           # Configuration management
├── examples/               # Example programs
├── tests/                  # Integration tests
├── benches/                # Performance benchmarks
├── Cargo.toml              # Package manifest
└── README.md               # This file
```

## Configuration

Create a `Turbo.toml` file in your project root:

```toml
[coordinator]
max_agents = 16
execution_timeout = 300  # seconds

[logging]
level = "info"
format = "json"

[[agents]]
name = "analyzer"
max_concurrent_tasks = 4
priority = "high"

[[agents]]
name = "executor"
max_concurrent_tasks = 8
priority = "normal"

[mcp]
enabled = true
models = ["claude", "gpt-4"]
```

## API Documentation

### Core Types

- **`SwarmCoordinator`** - Main orchestration engine for managing multiple agents
- **`Agent`** - Individual agent with capability set and execution context
- **`Task`** - Work unit to be executed by agents
- **`Result<T>`** - Standard Rust result type for error handling
- **`MCPClient`** - Protocol client for multi-model coordination

### Key Methods

```rust
impl SwarmCoordinator {
    pub async fn new() -> Self
    pub async fn register_agent(&mut self, agent: Agent) -> Result<()>
    pub async fn execute(&mut self, task: Task) -> Result<TaskResult>
    pub async fn execute_parallel(&mut self, tasks: Vec<Task>) -> Result<Vec<TaskResult>>
    pub fn list_agents(&self) -> Vec<&Agent>
}

impl Agent {
    pub fn new(name: &str) -> Self
    pub fn with_capability(mut self, cap: Capability) -> Self
    pub async fn execute(&self, task: &Task) -> Result<TaskOutput>
}

impl Task {
    pub fn new(name: &str) -> Self
    pub fn with_timeout(mut self, duration: Duration) -> Self
    pub fn with_priority(mut self, priority: Priority) -> Self
}
```

## Examples

### Example 1: Parallel Task Execution

```rust
use turbo_flow::{SwarmCoordinator, Agent, Task, Priority};

#[tokio::main]
async fn main() -> Result<()> {
    let mut coord = SwarmCoordinator::new();

    // Register multiple agents
    for i in 0..4 {
        coord.register_agent(Agent::new(&format!("worker-{}", i))).await?;
    }

    // Create parallel tasks
    let tasks = vec![
        Task::new("task-1").with_priority(Priority::High),
        Task::new("task-2").with_priority(Priority::Normal),
        Task::new("task-3").with_priority(Priority::Normal),
    ];

    let results = coord.execute_parallel(tasks).await?;
    println!("Completed {} tasks", results.len());

    Ok(())
}
```

### Example 2: Agent Specialization

```rust
use turbo_flow::{Agent, Capability};

fn create_specialized_agents() -> Vec<Agent> {
    vec![
        Agent::new("analyzer")
            .with_capability(Capability::CodeAnalysis)
            .with_capability(Capability::TypeChecking),
        Agent::new("formatter")
            .with_capability(Capability::CodeFormatting)
            .with_capability(Capability::Refactoring),
        Agent::new("deployer")
            .with_capability(Capability::Deployment)
            .with_capability(Capability::Monitoring),
    ]
}
```

## Testing

Run the full test suite:

```bash
# Unit tests
cargo test

# Integration tests
cargo test --test '*'

# With logging
RUST_LOG=debug cargo test -- --nocapture

# Benchmark suite
cargo bench
```

## Performance

Benchmark results on a 4-core system:

| Operation | Time | Memory |
|-----------|------|--------|
| Agent registration | < 1ms | ~100KB |
| Task execution | 5-50ms | ~200KB |
| Parallel (8 tasks) | 20-100ms | ~1MB |

Run benchmarks locally:

```bash
cargo bench --bench coordinator_bench
```

## Debugging

Enable debug logging:

```bash
RUST_LOG=turbo_flow=debug cargo run
```

## Error Handling

The library uses standard Rust error handling with the `?` operator:

```rust
use turbo_flow::{Result, Error};

match coordinator.execute(task).await {
    Ok(result) => println!("Success: {:?}", result),
    Err(Error::Timeout) => eprintln!("Task timed out"),
    Err(Error::AgentNotFound) => eprintln!("Agent not available"),
    Err(e) => eprintln!("Error: {}", e),
}
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Security

Security is important to us. If you find a vulnerability, please see [SECURITY.md](SECURITY.md) for responsible disclosure.

## License

Licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Community

- **Issues**: [GitHub Issues](https://github.com/marcuspat/turbo-flow-claude/issues)
- **Discussions**: [GitHub Discussions](https://github.com/marcuspat/turbo-flow-claude/discussions)
- **Documentation**: [Docs.rs](https://docs.rs/turbo-flow)

## Resources

- [Tokio Documentation](https://tokio.rs) - Async runtime
- [Rust Book](https://doc.rust-lang.org/book/) - Rust fundamentals
- [Cargo Guide](https://doc.rust-lang.org/cargo/) - Package management
- [The Rustonomicon](https://doc.rust-lang.org/nomicon/) - Unsafe Rust

## Roadmap

- [ ] WebAssembly support
- [ ] Distributed agent coordination
- [ ] Enhanced MCP protocol support
- [ ] Performance optimization (SIMD)
- [ ] Kubernetes integration
- [ ] Dashboard UI

## Acknowledgments

This project builds on the Rust ecosystem:

- [Tokio](https://tokio.rs) for async runtime
- [Serde](https://serde.rs) for serialization
- [Tracing](https://tokio.rs/tokio/tutorial/tracing) for observability
