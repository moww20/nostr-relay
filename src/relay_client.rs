use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_tungstenite::{WebSocketStream, MaybeTlsStream, connect_async};
use tungstenite::Message;
use futures_util::{SinkExt, StreamExt};
use serde_json;
use tracing::{info, error, warn, debug};

use crate::events::Event;
use crate::filters::{Filter, RequestMessage};
use crate::indexer::Indexer;
use crate::RelayError;

/// Client to connect to NOSTR relays and index events
pub struct RelayClient {
    url: String,
    indexer: Arc<Indexer>,
}

impl RelayClient {
    pub fn new(url: String, indexer: Arc<Indexer>) -> Self {
        Self { url, indexer }
    }

    /// Connect to relay and start indexing
    pub async fn start_indexing(&self) -> Result<(), RelayError> {
        info!("Connecting to relay: {}", self.url);

        let (ws_stream, _) = connect_async(&self.url).await
            .map_err(|e| RelayError::Internal(format!("Failed to connect to {}: {}", self.url, e)))?;

        info!("Connected to relay: {}", self.url);

        let (mut write, mut read) = ws_stream.split();

        // Subscribe to profile events (kind 0)
        let profile_subscription = RequestMessage {
            message_type: "REQ".to_string(),
            subscription_id: "profiles".to_string(),
            filters: vec![Filter {
                ids: None,
                authors: None,
                kinds: Some(vec![0]), // Profile events
                since: None,
                until: None,
                limit: Some(1000),
                tags: None,
            }],
        };

        let profile_msg = serde_json::to_string(&profile_subscription)
            .map_err(|e| RelayError::Serialization(e))?;
        
        write.send(Message::Text(profile_msg)).await
            .map_err(|e| RelayError::Internal(format!("Failed to send profile subscription: {}", e)))?;

        // Subscribe to contact events (kind 3)
        let contact_subscription = RequestMessage {
            message_type: "REQ".to_string(),
            subscription_id: "contacts".to_string(),
            filters: vec![Filter {
                ids: None,
                authors: None,
                kinds: Some(vec![3]), // Contact list events
                since: None,
                until: None,
                limit: Some(1000),
                tags: None,
            }],
        };

        let contact_msg = serde_json::to_string(&contact_subscription)
            .map_err(|e| RelayError::Serialization(e))?;
        
        write.send(Message::Text(contact_msg)).await
            .map_err(|e| RelayError::Internal(format!("Failed to send contact subscription: {}", e)))?;

        info!("Sent subscriptions to relay: {}", self.url);

        // Process incoming messages
        let mut indexed_count = 0;
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Err(e) = self.process_message(&text).await {
                        error!("Error processing message from {}: {}", self.url, e);
                    } else {
                        indexed_count += 1;
                        if indexed_count % 100 == 0 {
                            info!("Indexed {} events from {}", indexed_count, self.url);
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    warn!("Relay {} closed connection", self.url);
                    break;
                }
                Err(e) => {
                    error!("WebSocket error from {}: {}", self.url, e);
                    break;
                }
                _ => {}
            }
        }

        info!("Disconnected from relay: {} (indexed {} events)", self.url, indexed_count);
        Ok(())
    }

    /// Process a message from the relay
    async fn process_message(&self, text: &str) -> Result<(), RelayError> {
        debug!("Processing message: {}", text);

        // Parse the message as JSON array
        let msg: serde_json::Value = serde_json::from_str(text)
            .map_err(|e| RelayError::Serialization(e))?;

        if let Some(array) = msg.as_array() {
            if array.len() >= 2 {
                match array[0].as_str() {
                    Some("EVENT") => {
                        // Parse event message: ["EVENT", subscription_id, event]
                        if array.len() >= 3 {
                            if let Ok(event) = serde_json::from_value::<Event>(array[2].clone()) {
                                self.index_event(event).await?;
                            }
                        }
                    }
                    Some("EOSE") => {
                        // End of stored events - subscription complete
                        debug!("End of stored events for subscription: {:?}", array.get(1));
                    }
                    Some("NOTICE") => {
                        // Notice message
                        if let Some(notice) = array.get(1).and_then(|v| v.as_str()) {
                            info!("Notice from {}: {}", self.url, notice);
                        }
                    }
                    _ => {
                        debug!("Unknown message type: {:?}", array[0]);
                    }
                }
            }
        }

        Ok(())
    }

    /// Index an event based on its kind
    async fn index_event(&self, event: Event) -> Result<(), RelayError> {
        match event.kind {
            0 => {
                // Profile event
                self.indexer.index_profile_event(&event, self.url.clone()).await?;
                debug!("Indexed profile event for pubkey: {}", event.pubkey);
            }
            3 => {
                // Contact list event
                self.indexer.index_contact_event(&event, self.url.clone()).await?;
                debug!("Indexed contact event for pubkey: {}", event.pubkey);
            }
            _ => {
                // Skip other event types
                debug!("Skipping event kind {} from pubkey: {}", event.kind, event.pubkey);
            }
        }

        Ok(())
    }
}

/// Manager for multiple relay clients
pub struct RelayManager {
    clients: Vec<RelayClient>,
}

impl RelayManager {
    pub fn new(relay_urls: Vec<String>, indexer: Arc<Indexer>) -> Self {
        let clients = relay_urls
            .into_iter()
            .map(|url| RelayClient::new(url, indexer.clone()))
            .collect();

        Self { clients }
    }

    /// Start indexing from all relays concurrently
    pub async fn start_all(&self) -> Result<(), RelayError> {
        info!("Starting indexing from {} relays", self.clients.len());

        let mut handles = Vec::new();

        for client in &self.clients {
            let client_url = client.url.clone();
            let client_indexer = client.indexer.clone();
            let relay_client = RelayClient::new(client_url.clone(), client_indexer);

            let handle = tokio::spawn(async move {
                loop {
                    match relay_client.start_indexing().await {
                        Ok(_) => {
                            info!("Relay {} finished indexing", client_url);
                            break;
                        }
                        Err(e) => {
                            error!("Error indexing from relay {}: {}", client_url, e);
                            info!("Retrying connection to {} in 30 seconds...", client_url);
                            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                        }
                    }
                }
            });

            handles.push(handle);
        }

        // Wait for all clients to complete (they run indefinitely)
        for handle in handles {
            if let Err(e) = handle.await {
                error!("Relay client task failed: {}", e);
            }
        }

        Ok(())
    }
}
