#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::Event;
    use crate::filters::Filter;
    use crate::config::Config;
    use crate::database::Database;
    use secp256k1::{Secp256k1, SecretKey};
    use chrono::Utc;

    #[test]
    fn test_event_creation_and_validation() {
        let secp = Secp256k1::new();
        let secret_key = SecretKey::new(&mut secp256k1::rand::thread_rng());
        let public_key = secret_key.public_key(&secp);
        
        let mut event = Event::new(
            hex::encode(public_key.serialize()),
            1,
            vec![vec!["t".to_string(), "test".to_string()]],
            "Hello, NOSTR!".to_string(),
            None,
        );
        
        // Sign the event
        event.sign(&secret_key).unwrap();
        
        // Verify signature
        assert!(event.verify_signature().unwrap());
        
        // Test validation with default limits
        let config = Config::default();
        assert!(event.validate(&config.limits).is_ok());
    }

    #[test]
    fn test_filter_matching() {
        let event = Event::new(
            "test_pubkey".to_string(),
            1,
            vec![vec!["t".to_string(), "test".to_string()]],
            "Test content".to_string(),
            None,
        );
        
        // Test author filter
        let mut filter = Filter::new();
        filter.authors = Some(vec!["test_pubkey".to_string()]);
        assert!(filter.matches(&event));
        
        // Test kind filter
        let mut filter = Filter::new();
        filter.kinds = Some(vec![1]);
        assert!(filter.matches(&event));
        
        // Test tag filter
        let mut filter = Filter::new();
        filter.tags = Some(vec![vec!["t".to_string(), "test".to_string()]]);
        assert!(filter.matches(&event));
        
        // Test non-matching filter
        let mut filter = Filter::new();
        filter.kinds = Some(vec![2]);
        assert!(!filter.matches(&event));
    }

    #[test]
    fn test_config_loading() {
        let config = Config::default();
        assert_eq!(config.server.port, 8080);
        assert_eq!(config.server.host, "127.0.0.1");
        assert_eq!(config.database.path, "nostr_relay.db");
    }

    #[tokio::test]
    async fn test_database_operations() {
        let config = Config::default();
        let database = Database::new(&config.database).unwrap();
        
        let event = Event::new(
            "test_pubkey".to_string(),
            1,
            vec![vec!["t".to_string(), "test".to_string()]],
            "Test content".to_string(),
            None,
        );
        
        // Store event
        database.store_event(&event).await.unwrap();
        
        // Query event
        let mut filter = Filter::new();
        filter.authors = Some(vec!["test_pubkey".to_string()]);
        let events = database.query_events(&[filter]).await.unwrap();
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].content, "Test content");
        
        // Clean up
        database.delete_event(&event.id).await.unwrap();
    }

    #[test]
    fn test_event_id_calculation() {
        let event1 = Event::new(
            "test_pubkey".to_string(),
            1,
            vec![],
            "Test content".to_string(),
            Some(1234567890),
        );
        
        let event2 = Event::new(
            "test_pubkey".to_string(),
            1,
            vec![],
            "Test content".to_string(),
            Some(1234567890),
        );
        
        // Same event should have same ID
        assert_eq!(event1.id, event2.id);
        
        // Different content should have different ID
        let event3 = Event::new(
            "test_pubkey".to_string(),
            1,
            vec![],
            "Different content".to_string(),
            Some(1234567890),
        );
        
        assert_ne!(event1.id, event3.id);
    }
}
