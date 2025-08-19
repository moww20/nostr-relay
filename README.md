# NOSTR Indexer in Rust

A high-performance NOSTR indexer implementation written in Rust, focused on indexing profiles and relationships from multiple NOSTR relays. Provides fast search functionality for NOSTR users and their social connections.

## Features

- **Focused Indexing**: Indexes profiles (kind 0) and relationships (kind 3) from multiple relays
- **Fast Search**: Real-time profile search across all indexed relays
- **Relationship Mapping**: Track following/followers relationships
- **HTTP API**: RESTful API endpoints for search and profile retrieval
- **Multi-Relay Support**: Indexes from 6 popular NOSTR relays
- **Efficient Storage**: Optimized for minimal storage requirements (~1-5 GB)
- **High Performance**: Built with Rust and Tokio for excellent performance
- **Configurable**: TOML-based configuration for indexer settings

## Architecture

The indexer consists of several key components:

- **Relay Clients**: Connect to multiple NOSTR relays and subscribe to events
- **Indexer Engine**: Processes and indexes profile and relationship data
- **Search Engine**: Fast full-text search across indexed profiles
- **HTTP API Server**: RESTful endpoints for search and data retrieval
- **In-Memory Storage**: Efficient in-memory storage with optional persistence

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

# Run the indexer
cargo run --release
```

## Configuration

The indexer is configured via a `config.toml` file. Here's an example configuration:

```toml
[server]
host = "127.0.0.1"
port = 8080
max_connections = 1000

[database]
path = "nostr_indexer.db"
max_connections = 10

[limits]
max_event_size = 16384
max_events_per_request = 1000
max_filters_per_subscription = 10
max_subscriptions_per_connection = 10
rate_limit_events_per_second = 100

[relay]
name = "nostr-rs-indexer"
description = "A NOSTR indexer implementation in Rust"
pubkey = null
contact = null
supported_nips = [1, 11, 42]
software = "nostr-rs-indexer"
version = "0.1.0"

[indexer]
relay_urls = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.snort.social",
    "wss://nostr.wine",
    "wss://eden.nostr.land",
    "wss://relay.primal.net"
]
index_interval_seconds = 300
max_events_per_index = 1000
enable_profile_indexing = true
enable_relationship_indexing = true
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

#### Indexer
- `relay_urls`: List of NOSTR relay URLs to index from
- `index_interval_seconds`: How often to re-index (in seconds)
- `max_events_per_index`: Maximum events to fetch per indexing session
- `enable_profile_indexing`: Whether to index profile events (kind 0)
- `enable_relationship_indexing`: Whether to index contact events (kind 3)

## API Endpoints

The indexer provides the following HTTP API endpoints:

### Search and Profiles
- `GET /api/search?q=alice&page=0&per_page=20` - Search profiles by name, display name, or about text
- `GET /api/profile/{pubkey}` - Get detailed profile information for a specific pubkey

### Relationships
- `GET /api/following/{pubkey}?limit=100` - Get list of users that a pubkey follows
- `GET /api/followers/{pubkey}?limit=100` - Get list of users following a pubkey
- `GET /api/stats/{pubkey}` - Get relationship statistics (following/followers count)

### System
- `GET /api/indexer-stats` - Get overall indexer statistics
- `GET /api/health` - Health check endpoint

### Example API Usage

```bash
# Search for profiles containing "alice"
curl "http://localhost:8080/api/search?q=alice&page=0&per_page=10"

# Get profile details
curl "http://localhost:8080/api/profile/02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5"

# Get following list
curl "http://localhost:8080/api/following/02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5?limit=50"

# Get indexer statistics
curl "http://localhost:8080/api/indexer-stats"
```
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

The indexer uses SQLite with the following optimized schema for profiles and relationships:

```sql
-- Profiles table with npub support
CREATE TABLE profiles (
    pubkey TEXT PRIMARY KEY,           -- Hex format public key
    npub TEXT NOT NULL,                -- Bech32 npub format
    name TEXT,                         -- Profile name
    display_name TEXT,                 -- Display name
    about TEXT,                        -- About text
    picture TEXT,                      -- Profile picture URL
    banner TEXT,                       -- Banner image URL
    website TEXT,                      -- Website URL
    lud16 TEXT,                        -- Lightning address
    nip05 TEXT,                        -- NIP-05 identifier
    created_at INTEGER NOT NULL,       -- Event creation timestamp
    indexed_at INTEGER NOT NULL,       -- Indexing timestamp
    search_vector TEXT                 -- Full-text search vector
);

-- Relationships table with npub support
CREATE TABLE relationships (
    follower_pubkey TEXT NOT NULL,     -- Hex format follower pubkey
    following_pubkey TEXT NOT NULL,    -- Hex format following pubkey
    follower_npub TEXT NOT NULL,       -- Bech32 npub follower
    following_npub TEXT NOT NULL,      -- Bech32 npub following
    relay TEXT,                        -- Preferred relay
    petname TEXT,                      -- Petname for the contact
    created_at INTEGER NOT NULL,       -- Relationship creation timestamp
    indexed_at INTEGER NOT NULL,       -- Indexing timestamp
    PRIMARY KEY (follower_pubkey, following_pubkey)
);

-- Search index for fast profile search
CREATE TABLE search_index (
    term TEXT NOT NULL,                -- Search term
    pubkey TEXT NOT NULL,              -- Profile pubkey
    field_type TEXT NOT NULL,          -- Field type (name, about, etc.)
    PRIMARY KEY (term, pubkey, field_type)
);
```

### Key Features:
- **Dual Format Support**: Both hex and npub (bech32) formats for better compatibility
- **Full-Text Search**: Optimized search across names, display names, and about text
- **Relationship Mapping**: Efficient following/followers tracking
- **Indexed Queries**: Fast lookups with proper database indexes

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

# Test API endpoints (requires indexer to be running)
python test_indexer.py
```

## Testing the Indexer

### 1. Start the Indexer

```bash
cargo run --release
```

The indexer will:
- Start the HTTP API server on port 8080
- Connect to 6 NOSTR relays and begin indexing profiles and relationships
- Log indexing progress and statistics

### 2. Test the API

```bash
# Test health endpoint
curl http://localhost:8080/api/health

# Search for profiles
curl "http://localhost:8080/api/search?q=alice&page=0&per_page=10"

# Get indexer statistics
curl http://localhost:8080/api/indexer-stats

# Get profile by pubkey (hex or npub)
curl http://localhost:8080/api/profile/02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5

# Get following list
curl "http://localhost:8080/api/following/02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5?limit=50"
```

### 3. Monitor Indexing Progress

The indexer will log:
- Connection status to each relay
- Number of profiles and relationships indexed
- Search statistics and performance metrics

## Vercel Deployment

This indexer is optimized for Vercel deployment:

1. **Focused Indexing**: Only indexes profiles and relationships (~1-5 GB storage)
2. **HTTP API**: RESTful endpoints perfect for serverless functions
3. **Efficient Storage**: SQLite with optimized indexes
4. **Fast Search**: In-memory search with database persistence

### Environment Variables

```bash
# Database path (for Vercel)
DATABASE_PATH=/tmp/nostr_indexer.db

# Relay URLs (comma-separated)
RELAY_URLS=wss://relay.damus.io,wss://nos.lol,wss://relay.snort.social,wss://nostr.wine,wss://eden.nostr.land,wss://relay.primal.net
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
