use tokio_tungstenite::{accept_async, WebSocketStream};
use tokio_tungstenite::tungstenite::Message;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn, error, debug};

use crate::events::{Event, EventMessage, NoticeMessage, OkMessage};
use crate::filters::{Filter, RequestMessage, CloseMessage};
use crate::database::Database;
use crate::config::LimitsConfig;

pub struct WebSocketHandler {
    database: Arc<Database>,
    limits: LimitsConfig,
    subscriptions: Arc<Mutex<HashMap<String, Vec<Filter>>>>,
}

impl WebSocketHandler {
    pub fn new(database: Arc<Database>, limits: LimitsConfig) -> Self {
        Self {
            database,
            limits,
            subscriptions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn handle_connection(
        &self,
        stream: WebSocketStream<tokio::net::TcpStream>,
    ) -> crate::Result<()> {
        let (mut write, mut read) = stream.split();
        
        info!("New WebSocket connection established");

        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    debug!("Received message: {}", text);
                    if let Err(e) = self.handle_message(&text, &mut write).await {
                        error!("Error handling message: {}", e);
                        let notice = NoticeMessage::new(format!("Error: {}", e));
                        let notice_json = serde_json::to_string(&notice)?;
                        write.send(Message::Text(notice_json)).await?;
                    }
                }
                Ok(Message::Close(_)) => {
                    info!("WebSocket connection closed");
                    break;
                }
                Ok(Message::Ping(data)) => {
                    write.send(Message::Pong(data)).await?;
                }
                Ok(Message::Pong(_)) => {
                    // Ignore pong messages
                }
                Ok(Message::Binary(_)) => {
                    warn!("Received binary message, ignoring");
                }
                Ok(Message::Frame(_)) => {
                    warn!("Received raw frame, ignoring");
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    async fn handle_message(
        &self,
        text: &str,
        write: &mut futures_util::stream::SplitSink<WebSocketStream<tokio::net::TcpStream>, Message>,
    ) -> crate::Result<()> {
        let value: Value = serde_json::from_str(text)?;
        
        if let Some(msg_type) = value.get("type").and_then(|v| v.as_str()) {
            match msg_type {
                "EVENT" => self.handle_event_message(text, write).await,
                "REQ" => self.handle_request_message(text, write).await,
                "CLOSE" => self.handle_close_message(text, write).await,
                _ => {
                    warn!("Unknown message type: {}", msg_type);
                    let notice = NoticeMessage::new(format!("Unknown message type: {}", msg_type));
                    let notice_json = serde_json::to_string(&notice)?;
                    write.send(Message::Text(notice_json)).await?;
                    Ok(())
                }
            }
        } else {
            Err(crate::RelayError::InvalidEvent("Missing message type".to_string()))
        }
    }

    async fn handle_event_message(
        &self,
        text: &str,
        write: &mut futures_util::stream::SplitSink<WebSocketStream<tokio::net::TcpStream>, Message>,
    ) -> crate::Result<()> {
        let event_msg: EventMessage = serde_json::from_str(text)?;
        let event = event_msg.event;

        // Validate event
        event.validate(&self.limits)?;

        // Store event in database
        // Store event in database (commented out for indexer)
        // self.database.store_event(&event).await?;

        // Send OK response
        let ok_msg = OkMessage::new(event.id.clone(), true, "Event stored".to_string());
        let ok_json = serde_json::to_string(&ok_msg)?;
        write.send(Message::Text(ok_json)).await?;

        // Broadcast event to subscribers
        self.broadcast_event(&event).await?;

        info!("Event stored and broadcast: {}", event.id);
        Ok(())
    }

    async fn handle_request_message(
        &self,
        text: &str,
        write: &mut futures_util::stream::SplitSink<WebSocketStream<tokio::net::TcpStream>, Message>,
    ) -> crate::Result<()> {
        let req_msg: RequestMessage = serde_json::from_str(text)?;
        
        // Validate subscription limits
        if req_msg.filters.len() > self.limits.max_filters_per_subscription {
            return Err(crate::RelayError::Subscription(
                format!("Too many filters: {}", req_msg.filters.len())
            ));
        }

        // Store subscription
        {
            let mut subscriptions = self.subscriptions.lock().await;
            subscriptions.insert(req_msg.subscription_id.clone(), req_msg.filters.clone());
        }

        // Query events from database
        let events = self.database.query_events(&req_msg.filters).await?;

        // Send events to client
        let event_count = events.len();
        for event in events {
            let event_msg = EventMessage::new(event);
            let event_json = serde_json::to_string(&event_msg)?;
            write.send(Message::Text(event_json)).await?;
        }

        info!("Subscription created: {} with {} events", req_msg.subscription_id, event_count);
        Ok(())
    }

    async fn handle_close_message(
        &self,
        text: &str,
        _write: &mut futures_util::stream::SplitSink<WebSocketStream<tokio::net::TcpStream>, Message>,
    ) -> crate::Result<()> {
        let close_msg: CloseMessage = serde_json::from_str(text)?;
        
        // Remove subscription
        {
            let mut subscriptions = self.subscriptions.lock().await;
            subscriptions.remove(&close_msg.subscription_id);
        }

        info!("Subscription closed: {}", close_msg.subscription_id);
        Ok(())
    }

    async fn broadcast_event(&self, event: &Event) -> crate::Result<()> {
        let subscriptions = self.subscriptions.lock().await;
        
        for (subscription_id, filters) in subscriptions.iter() {
            // Check if any filter matches the event
            let matches = filters.iter().any(|filter| filter.matches(event));
            
            if matches {
                // TODO: Send event to the specific subscription
                // This would require maintaining a mapping of subscription_id to WebSocket connections
                debug!("Event {} matches subscription {}", event.id, subscription_id);
            }
        }

        Ok(())
    }
}

pub async fn handle_websocket_connection(
    stream: tokio::net::TcpStream,
    database: Arc<Database>,
    limits: LimitsConfig,
) -> crate::Result<()> {
    let ws_stream = accept_async(stream).await?;
    let handler = WebSocketHandler::new(database, limits);
    handler.handle_connection(ws_stream).await
}
