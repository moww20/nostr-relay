use thiserror::Error;

#[derive(Error, Debug)]
pub enum RelayError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("WebSocket error: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),

    #[error("JSON serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid event: {0}")]
    InvalidEvent(String),

    #[error("Authentication error: {0}")]
    Authentication(String),

    #[error("Rate limit exceeded")]
    RateLimit,

    #[error("Event rejected: {0}")]
    EventRejected(String),

    #[error("Subscription error: {0}")]
    Subscription(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Hex decoding error: {0}")]
    HexDecode(#[from] hex::FromHexError),
}
