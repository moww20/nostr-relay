use serde::{Deserialize, Serialize};
use serde_json::Value;
use secp256k1::{Secp256k1, PublicKey, SecretKey, Message, ecdsa::Signature};
use sha2::{Sha256, Digest};
use chrono::Utc;
use crate::RelayError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub pubkey: String,
    pub created_at: i64,
    pub kind: u16,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub event: Event,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoticeMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub event_id: String,
    pub ok: bool,
    pub message: String,
}

impl Event {
    pub fn new(
        pubkey: String,
        kind: u16,
        tags: Vec<Vec<String>>,
        content: String,
        created_at: Option<i64>,
    ) -> Self {
        let created_at = created_at.unwrap_or_else(|| Utc::now().timestamp());
        
        // Create the event without signature first
        let mut event = Self {
            id: String::new(),
            pubkey,
            created_at,
            kind,
            tags,
            content,
            sig: String::new(),
        };
        
        // Calculate the event ID
        event.id = event.calculate_id();
        
        event
    }

    pub fn calculate_id(&self) -> String {
        let serialized = serde_json::to_string(&self.serialize_for_id()).unwrap();
        let mut hasher = Sha256::new();
        hasher.update(serialized.as_bytes());
        hex::encode(hasher.finalize())
    }

    fn serialize_for_id(&self) -> Value {
        serde_json::json!([
            0,
            self.pubkey,
            self.created_at,
            self.kind,
            self.tags,
            self.content
        ])
    }

    pub fn sign(&mut self, secret_key: &SecretKey) -> crate::Result<()> {
        let secp = Secp256k1::new();
        let message = Message::from_slice(&hex::decode(&self.id)?)
            .map_err(|_| RelayError::InvalidEvent("Invalid event ID".to_string()))?;
        
        let signature = secp.sign_ecdsa(&message, secret_key);
        self.sig = hex::encode(signature.serialize_der());
        
        Ok(())
    }

    pub fn verify_signature(&self) -> crate::Result<bool> {
        let secp = Secp256k1::new();
        
        let pubkey = public_key_from_str(&self.pubkey)
            .map_err(|_| RelayError::InvalidEvent("Invalid public key".to_string()))?;
        
        let signature = Signature::from_der(&hex::decode(&self.sig)?)
            .map_err(|_| RelayError::InvalidEvent("Invalid signature".to_string()))?;
        
        let message = Message::from_slice(&hex::decode(&self.id)?)
            .map_err(|_| RelayError::InvalidEvent("Invalid event ID".to_string()))?;
        
        Ok(secp.verify_ecdsa(&message, &signature, &pubkey).is_ok())
    }

    pub fn validate(&self, limits: &crate::config::LimitsConfig) -> crate::Result<()> {
        // Check event size
        let event_size = serde_json::to_string(self)?.len();
        if event_size > limits.max_event_size {
            return Err(RelayError::InvalidEvent(
                format!("Event too large: {} bytes", event_size)
            ));
        }

        // Check if event is not too old (1 hour)
        let now = Utc::now().timestamp();
        if self.created_at < now - 3600 {
            return Err(RelayError::InvalidEvent("Event too old".to_string()));
        }

        // Check if event is not too far in the future (5 minutes)
        if self.created_at > now + 300 {
            return Err(RelayError::InvalidEvent("Event too far in the future".to_string()));
        }

        // Verify signature
        if !self.verify_signature()? {
            return Err(RelayError::InvalidEvent("Invalid signature".to_string()));
        }

        Ok(())
    }
}

impl EventMessage {
    pub fn new(event: Event) -> Self {
        Self {
            message_type: "EVENT".to_string(),
            event,
        }
    }
}

impl NoticeMessage {
    pub fn new(message: String) -> Self {
        Self {
            message_type: "NOTICE".to_string(),
            message,
        }
    }
}

impl OkMessage {
    pub fn new(event_id: String, ok: bool, message: String) -> Self {
        Self {
            message_type: "OK".to_string(),
            event_id,
            ok,
            message,
        }
    }
}

// Helper function to create a public key from string
fn public_key_from_str(s: &str) -> Result<PublicKey, secp256k1::Error> {
    PublicKey::from_slice(&hex::decode(s).map_err(|_| secp256k1::Error::InvalidPublicKey)?)
}
