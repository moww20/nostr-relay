use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub limits: LimitsConfig,
    pub relay: RelayConfig,
    pub indexer: IndexerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub max_connections: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    pub path: String,
    pub max_connections: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitsConfig {
    pub max_event_size: usize,
    pub max_events_per_request: usize,
    pub max_filters_per_subscription: usize,
    pub max_subscriptions_per_connection: usize,
    pub rate_limit_events_per_second: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayConfig {
    pub name: String,
    pub description: String,
    pub pubkey: Option<String>,
    pub contact: Option<String>,
    pub supported_nips: Vec<u16>,
    pub software: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerConfig {
    pub relay_urls: Vec<String>,
    pub index_interval_seconds: u64,
    pub max_events_per_index: usize,
    pub enable_profile_indexing: bool,
    pub enable_relationship_indexing: bool,
}

impl Config {
    pub fn from_file<P: AsRef<Path>>(path: P) -> crate::Result<Self> {
        let content = fs::read_to_string(path)
            .map_err(|e| crate::RelayError::Config(format!("Failed to read config file: {}", e)))?;
        
        toml::from_str(&content)
            .map_err(|e| crate::RelayError::Config(format!("Failed to parse config file: {}", e)))
    }

    pub fn default() -> Self {
        Self {
            server: ServerConfig {
                host: "127.0.0.1".to_string(),
                port: 8080,
                max_connections: 1000,
            },
            database: DatabaseConfig {
                path: "nostr_relay.db".to_string(),
                max_connections: 10,
            },
            limits: LimitsConfig {
                max_event_size: 16384,
                max_events_per_request: 1000,
                max_filters_per_subscription: 10,
                max_subscriptions_per_connection: 10,
                rate_limit_events_per_second: 100,
            },
            relay: RelayConfig {
                name: "nostr-rs-indexer".to_string(),
                description: "A NOSTR indexer implementation in Rust".to_string(),
                pubkey: None,
                contact: None,
                supported_nips: vec![1, 11, 42],
                software: "nostr-rs-indexer".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            indexer: IndexerConfig {
                relay_urls: vec![
                    "wss://relay.damus.io".to_string(),
                    "wss://nostr.wine".to_string(),
                    "wss://relay.snort.social".to_string(),
                    "wss://nos.lol".to_string(),
                    "wss://relay.nostr.band".to_string(),
                    "wss://purplepag.es".to_string(),
                ],
                index_interval_seconds: 300, // 5 minutes
                max_events_per_index: 1000,
                enable_profile_indexing: true,
                enable_relationship_indexing: true,
            },
        }
    }
}
