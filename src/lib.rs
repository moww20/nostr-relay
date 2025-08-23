pub mod config;
pub mod database;
pub mod events;
pub mod filters;
pub mod server;
pub mod websocket;
pub mod error;
pub mod indexer;
pub mod api;
pub mod relay_client;
pub mod turso;
pub mod turso_writer;

#[cfg(test)]
mod tests;

pub use error::RelayError;
pub type Result<T> = std::result::Result<T, RelayError>;
