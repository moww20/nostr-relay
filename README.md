# NOSTR Relay in Rust

A high-performance NOSTR relay implementation written in Rust, supporting core NOSTR NIPs (NIP-01, NIP-11, NIP-42) with SQLite database backend.

## Features

- **Core NOSTR Support**: Implements NIP-01 for events, NIP-11 for relay information, and NIP-42 for authentication
- **WebSocket Communication**: Real-time event handling via WebSocket connections
- **SQLite Database**: Efficient event storage and querying with proper indexing
- **Configurable**: TOML-based configuration for relay settings, limits, and database options
- **High Performance**: Built with Rust and Tokio for excellent performance and concurrency
- **Event Validation**: Cryptographic signature verification and event validation
- **Filter Support**: Full NOSTR filter implementation for event querying
- **Rate Limiting**: Configurable rate limiting to prevent abuse

## Architecture

The relay consists of several key components:

- **WebSocket Server**: Handles client connections and NOSTR protocol messages
- **Database Layer**: SQLite-based storage with optimized queries and indexing
- **Event Processor**: Validates events and applies relay policies
- **Filter Engine**: Processes NOSTR filters for event matching and retrieval

## Installation

### Prerequisites

- Rust toolchain (install via [rustup](https://rustup.rs/))
- SQLite (included with rusqlite bundled feature)

### Building

```bash
# Clone the repository
git clone <your-repo-url>
cd nostr-rs-relay

# Build the project
cargo build --release

# Run the relay
cargo run --release
```

## Configuration

The relay is configured via a `config.toml` file. Here's an example configuration:

```toml
[server]
host = "127.0.0.1"
port = 8080
max_connections = 1000

[database]
path = "nostr_relay.db"
max_connections = 10

[limits]
max_event_size = 16384
max_events_per_request = 1000
max_filters_per_subscription = 10
max_subscriptions_per_connection = 10
rate_limit_events_per_second = 100

[relay]
name = "nostr-rs-relay"
description = "A NOSTR relay implementation in Rust"
pubkey = null
contact = null
supported_nips = [1, 11, 42]
software = "nostr-rs-relay"
version = "0.1.0"
```

### Configuration Options

#### Server
- `host`: Server host address
- `port`: Server port number
- `max_connections`: Maximum number of concurrent connections

#### Database
- `path`: SQLite database file path
- `max_connections`: Maximum database connections

#### Limits
- `max_event_size`: Maximum event size in bytes
- `max_events_per_request`: Maximum events returned per request
- `max_filters_per_subscription`: Maximum filters per subscription
- `max_subscriptions_per_connection`: Maximum subscriptions per connection
- `rate_limit_events_per_second`: Rate limit for events per second

#### Relay
- `name`: Relay name
- `description`: Relay description
- `pubkey`: Relay operator public key (optional)
- `contact`: Contact information (optional)
- `supported_nips`: List of supported NIPs
- `software`: Software name
- `version`: Software version

## Usage

### Starting the Relay

```bash
# Use default configuration
cargo run

# Use custom configuration file
cargo run -- --config /path/to/config.toml
```

### HTTP Endpoints

The relay provides several HTTP endpoints:

- `GET /`: Relay information (NIP-11)
- `GET /health`: Health check endpoint

### WebSocket Endpoints

The relay accepts WebSocket connections for NOSTR protocol communication.

## NOSTR Protocol Support

### Supported NIPs

- **NIP-01**: Basic protocol flow
- **NIP-11**: Relay information metadata
- **NIP-42**: Authentication of clients to relays

### Message Types

- `EVENT`: Publish events to the relay
- `REQ`: Request events from the relay
- `CLOSE`: Close a subscription

### Event Validation

The relay validates all events according to NIP-01:
- Cryptographic signature verification
- Event size limits
- Timestamp validation
- Required field validation

## Database Schema

The relay uses SQLite with the following schema:

```sql
-- Events table
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    kind INTEGER NOT NULL,
    tags TEXT NOT NULL,
    content TEXT NOT NULL,
    sig TEXT NOT NULL
);

-- Event tags table for efficient filtering
CREATE TABLE event_tags (
    event_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    tag_value TEXT NOT NULL,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
);
```

## Development

### Project Structure

```
src/
├── main.rs          # Application entry point
├── lib.rs           # Library root
├── config.rs        # Configuration management
├── database.rs      # Database operations
├── events.rs        # NOSTR event handling
├── filters.rs       # Event filtering
├── server.rs        # HTTP/WebSocket server
├── websocket.rs     # WebSocket connection handling
└── error.rs         # Error types
```

### Building for Development

```bash
# Development build
cargo build

# Run with logging
RUST_LOG=info cargo run

# Run tests
cargo test
```

### Testing

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_name

# Run with output
cargo test -- --nocapture
```

## Deployment

### Docker

```dockerfile
FROM rust:1.70 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bullseye-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/nostr-rs-relay /usr/local/bin/
COPY --from=builder /app/config.toml /etc/nostr-relay/
EXPOSE 8080
CMD ["nostr-rs-relay", "--config", "/etc/nostr-relay/config.toml"]
```

### Systemd Service

Create `/etc/systemd/system/nostr-relay.service`:

```ini
[Unit]
Description=NOSTR Relay
After=network.target

[Service]
Type=simple
User=nostr
WorkingDirectory=/opt/nostr-relay
ExecStart=/opt/nostr-relay/nostr-rs-relay
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [NOSTR Protocol](https://github.com/nostr-protocol/nostr) for the protocol specification
- [scsibug/nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay) for inspiration
- The Rust community for excellent tooling and libraries
