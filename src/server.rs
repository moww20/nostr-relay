use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::io::AsyncWriteExt;
use serde_json::json;
use tracing::{info, error};

use crate::config::Config;
use crate::database::Database;
use crate::websocket::handle_websocket_connection;

pub struct Server {
    config: Config,
    database: Arc<Database>,
}

impl Server {
    pub fn new(config: Config) -> Self {
        let database = Arc::new(
            Database::new(&config.database)
                .expect("Failed to initialize database")
        );

        Self {
            config,
            database,
        }
    }

    pub async fn run(&self) -> crate::Result<()> {
        let addr = format!("{}:{}", self.config.server.host, self.config.server.port);
        let listener = TcpListener::bind(&addr).await?;
        
        info!("NOSTR relay server listening on {}", addr);

        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    info!("New connection from {}", addr);
                    
                    let database = Arc::clone(&self.database);
                    let limits = self.config.limits.clone();
                    
                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_connection(stream, database, limits).await {
                            error!("Connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Accept error: {}", e);
                }
            }
        }
    }

    async fn handle_connection(
        stream: TcpStream,
        database: Arc<Database>,
        limits: crate::config::LimitsConfig,
    ) -> crate::Result<()> {
        // For now, assume all connections are WebSocket
        // In a production implementation, you'd want to properly detect HTTP vs WebSocket
        handle_websocket_connection(stream, database, limits).await
    }

    async fn handle_http_request(mut stream: TcpStream, request: String) -> crate::Result<()> {
        let lines: Vec<&str> = request.lines().collect();
        if lines.is_empty() {
            return Err(crate::RelayError::Internal("Empty request".to_string()));
        }

        let request_line = lines[0];
        let parts: Vec<&str> = request_line.split_whitespace().collect();
        
        if parts.len() < 2 {
            return Err(crate::RelayError::Internal("Invalid request line".to_string()));
        }

        let method = parts[0];
        let path = parts[1];

        match (method, path) {
            ("GET", "/") => {
                // Return relay information (NIP-11)
                let relay_info = json!({
                    "name": "nostr-rs-relay",
                    "description": "A NOSTR relay implementation in Rust",
                    "pubkey": null,
                    "contact": null,
                    "supported_nips": [1, 11, 42],
                    "software": "nostr-rs-relay",
                    "version": env!("CARGO_PKG_VERSION")
                });

                let response = format!(
                    "HTTP/1.1 200 OK\r\n\
                     Content-Type: application/json\r\n\
                     Content-Length: {}\r\n\
                     Access-Control-Allow-Origin: *\r\n\
                     \r\n\
                     {}",
                    relay_info.to_string().len(),
                    relay_info
                );

                stream.write_all(response.as_bytes()).await?;
            }
            ("GET", "/health") => {
                let health_response = json!({
                    "status": "healthy",
                    "timestamp": chrono::Utc::now().timestamp()
                });

                let response = format!(
                    "HTTP/1.1 200 OK\r\n\
                     Content-Type: application/json\r\n\
                     Content-Length: {}\r\n\
                     \r\n\
                     {}",
                    health_response.to_string().len(),
                    health_response
                );

                stream.write_all(response.as_bytes()).await?;
            }
            _ => {
                // Return 404 for unknown paths
                let response = "HTTP/1.1 404 Not Found\r\n\
                               Content-Type: text/plain\r\n\
                               Content-Length: 13\r\n\
                               \r\n\
                               404 Not Found";
                stream.write_all(response.as_bytes()).await?;
            }
        }

        Ok(())
    }
}
