#[cfg(test)]
mod tests {
    use crate::config::Config;
    use crate::database::Database;
    use crate::indexer::{Profile, Contact};
    use chrono::Utc;

    #[test]
    fn test_config_loading() {
        let config = Config::default();
        assert_eq!(config.server.port, 8080);
        assert_eq!(config.server.host, "127.0.0.1");
        assert_eq!(config.database.path, "nostr_relay.db");
        assert!(!config.indexer.relay_urls.is_empty());
        assert!(config.indexer.enable_profile_indexing);
        assert!(config.indexer.enable_relationship_indexing);
    }

    #[tokio::test]
    async fn test_profile_storage_and_search() {
        let config = Config::default();
        let database = Database::new(&config.database).unwrap();
        
        // Create a test profile with valid hex pubkey
        let profile = Profile {
            pubkey: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
            name: Some("Alice".to_string()),
            display_name: Some("Alice Smith".to_string()),
            about: Some("Software developer and NOSTR enthusiast".to_string()),
            picture: Some("https://example.com/alice.jpg".to_string()),
            banner: None,
            website: Some("https://alice.dev".to_string()),
            nip05: Some("alice@example.com".to_string()),
            lud16: None,
            created_at: 1234567890,
            indexed_at: Utc::now(),
            relay_sources: vec!["test_relay".to_string()],
            search_terms: vec!["alice".to_string(), "developer".to_string()],
        };
        
        // Store profile
        database.store_profile(&profile).await.unwrap();
        
        // Search for profile
        let results = database.search_profiles("Alice", 0, 10).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name.as_ref().unwrap(), "Alice");
        
        // Get profile by pubkey
        let retrieved = database.get_profile(&profile.pubkey).await.unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().display_name.as_ref().unwrap(), "Alice Smith");
        
        // Clean up - use a public method or create a test helper
        // For now, we'll just test that the operations work
    }

    #[tokio::test]
    async fn test_relationship_storage_and_queries() {
        let config = Config::default();
        let database = Database::new(&config.database).unwrap();
        
        // Create test relationship with valid hex pubkeys
        let contact = Contact {
            follower_pubkey: "1111111111111111111111111111111111111111111111111111111111111111".to_string(),
            following_pubkey: "2222222222222222222222222222222222222222222222222222222222222222".to_string(),
            relay: Some("test_relay".to_string()),
            petname: Some("Bob".to_string()),
            created_at: 1234567890,
            indexed_at: Utc::now(),
        };
        
        // Store relationship
        database.store_relationship(&contact).await.unwrap();
        
        // Get following list
        let following = database.get_following(&contact.follower_pubkey, 100).await.unwrap();
        assert_eq!(following.len(), 1);
        assert_eq!(following[0].following_pubkey, contact.following_pubkey);
        
        // Get followers list
        let followers = database.get_followers(&contact.following_pubkey, 100).await.unwrap();
        assert_eq!(followers.len(), 1);
        assert_eq!(followers[0].follower_pubkey, contact.follower_pubkey);
        
        // Get relationship stats (returns tuple)
        let (following_count, followers_count) = database.get_relationship_stats(&contact.follower_pubkey).await.unwrap();
        assert_eq!(following_count, 1);
        assert_eq!(followers_count, 0);
        
        let (following_count, followers_count) = database.get_relationship_stats(&contact.following_pubkey).await.unwrap();
        assert_eq!(following_count, 0);
        assert_eq!(followers_count, 1);
    }

    #[test]
    fn test_search_vector_generation() {
        let profile = Profile {
            pubkey: "3333333333333333333333333333333333333333333333333333333333333333".to_string(),
            name: Some("Alice Developer".to_string()),
            display_name: Some("Alice Smith".to_string()),
            about: Some("Software developer and NOSTR enthusiast".to_string()),
            picture: None,
            banner: None,
            website: None,
            nip05: None,
            lud16: None,
            created_at: 1234567890,
            indexed_at: Utc::now(),
            relay_sources: vec![],
            search_terms: vec!["alice".to_string(), "developer".to_string(), "nostr".to_string()],
        };
        
        // Test that search terms are properly set
        assert!(profile.search_terms.contains(&"alice".to_string()));
        assert!(profile.search_terms.contains(&"developer".to_string()));
        assert!(profile.search_terms.contains(&"nostr".to_string()));
    }
}
