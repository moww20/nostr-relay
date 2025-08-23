use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};
use tracing::{info, error, warn};

use crate::events::Event;
use crate::RelayError;

/// Profile data extracted from kind 0 events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub pubkey: String,
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub about: Option<String>,
    pub picture: Option<String>,
    pub banner: Option<String>,
    pub website: Option<String>,
    pub lud16: Option<String>,
    pub nip05: Option<String>,
    pub created_at: i64,
    pub indexed_at: DateTime<Utc>,
    pub relay_sources: Vec<String>,
    pub search_terms: Vec<String>,
}

/// Contact relationship extracted from kind 3 events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub follower_pubkey: String,
    pub following_pubkey: String,
    pub relay: Option<String>,
    pub petname: Option<String>,
    pub created_at: i64,
    pub indexed_at: DateTime<Utc>,
}

/// Search result for profiles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSearchResult {
    pub profiles: Vec<Profile>,
    pub total_count: usize,
    pub page: usize,
    pub per_page: usize,
}

/// Relationship statistics for a user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipStats {
    pub pubkey: String,
    pub following_count: usize,
    pub followers_count: usize,
    pub last_contact_update: Option<DateTime<Utc>>,
}

/// Indexer statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerStats {
    pub total_profiles: usize,
    pub total_relationships: usize,
    pub relays_indexed: usize,
    pub last_indexed: Option<DateTime<Utc>>,
    pub search_index_size: usize,
}

/// Main indexer struct for NOSTR profiles and relationships
pub struct Indexer {
    profiles: Arc<RwLock<HashMap<String, Profile>>>,
    relationships: Arc<RwLock<HashMap<(String, String), Contact>>>,
    search_index: Arc<RwLock<HashMap<String, Vec<String>>>>, // term -> pubkeys
    relay_urls: Vec<String>,
    stats: Arc<RwLock<IndexerStats>>,
}

impl Indexer {
    pub fn new(relay_urls: Vec<String>) -> Self {
        Self {
            profiles: Arc::new(RwLock::new(HashMap::new())),
            relationships: Arc::new(RwLock::new(HashMap::new())),
            search_index: Arc::new(RwLock::new(HashMap::new())),
            relay_urls,
            stats: Arc::new(RwLock::new(IndexerStats {
                total_profiles: 0,
                total_relationships: 0,
                relays_indexed: 0,
                last_indexed: None,
                search_index_size: 0,
            })),
        }
    }

    /// Index a profile event (kind 0)
    pub async fn index_profile_event(&self, event: &Event, relay_source: String) -> Result<(), RelayError> {
        if event.kind != 0 {
            return Err(RelayError::InvalidEvent("Expected kind 0 event for profile".to_string()));
        }

        let profile_data: serde_json::Value = serde_json::from_str(&event.content)
            .map_err(|e| RelayError::InvalidEvent(format!("Invalid profile JSON: {}", e)))?;

        let search_terms = self.extract_profile_search_terms(&profile_data);

        let profile = Profile {
            pubkey: event.pubkey.clone(),
            name: profile_data.get("name").and_then(|v| v.as_str()).map(String::from),
            display_name: profile_data.get("display_name").and_then(|v| v.as_str()).map(String::from),
            about: profile_data.get("about").and_then(|v| v.as_str()).map(String::from),
            picture: profile_data.get("picture").and_then(|v| v.as_str()).map(String::from),
            banner: profile_data.get("banner").and_then(|v| v.as_str()).map(String::from),
            website: profile_data.get("website").and_then(|v| v.as_str()).map(String::from),
            lud16: profile_data.get("lud16").and_then(|v| v.as_str()).map(String::from),
            nip05: profile_data.get("nip05").and_then(|v| v.as_str()).map(String::from),
            created_at: event.created_at,
            indexed_at: Utc::now(),
            relay_sources: vec![relay_source],
            search_terms: search_terms.clone(),
        };

        // Store profile in-memory
        {
            let mut profiles = self.profiles.write().await;
            profiles.insert(event.pubkey.clone(), profile.clone());
        }

        // Update memory search index
        {
            let mut search_index = self.search_index.write().await;
            for term in &search_terms {
                search_index.entry(term.clone()).or_insert_with(Vec::new).push(event.pubkey.clone());
            }
        }

        // Persist to Turso if configured
        if std::env::var("TURSO_DATABASE_URL").is_ok() {
            crate::turso_writer::persist_profile(&profile, &search_terms).await;
        }

        // Update stats
        self.update_stats().await;

        info!("Indexed profile for pubkey: {}", event.pubkey);
        Ok(())
    }

    /// Index a contact list event (kind 3)
    pub async fn index_contact_event(&self, event: &Event, relay_source: String) -> Result<(), RelayError> {
        if event.kind != 3 {
            return Err(RelayError::InvalidEvent("Expected kind 3 event for contacts".to_string()));
        }

        let follower_pubkey = event.pubkey.clone();
        let mut contact_count = 0;

        // Parse p tags for contacts
        for tag in &event.tags {
            if tag.len() >= 2 && tag[0] == "p" {
                let following_pubkey = tag[1].clone();
                let relay = tag.get(2).map(String::clone);
                let petname = tag.get(3).map(String::clone);

                let contact = Contact {
                    follower_pubkey: follower_pubkey.clone(),
                    following_pubkey: following_pubkey.clone(),
                    relay,
                    petname,
                    created_at: event.created_at,
                    indexed_at: Utc::now(),
                };

                // Store relationship in-memory
                {
                    let mut relationships = self.relationships.write().await;
                    relationships.insert((follower_pubkey.clone(), following_pubkey.clone()), contact.clone());
                }

                // Persist to Turso if configured
                if std::env::var("TURSO_DATABASE_URL").is_ok() {
                    crate::turso_writer::persist_relationship(&contact).await;
                }

                contact_count += 1;
            }
        }

        // Update stats
        self.update_stats().await;

        info!("Indexed {} contacts for pubkey: {}", contact_count, follower_pubkey);
        Ok(())
    }

    /// Search profiles by query
    pub async fn search_profiles(&self, query: &str, page: usize, per_page: usize) -> Result<ProfileSearchResult, RelayError> {
        let search_terms = self.extract_search_terms(query);
        let mut matching_pubkeys = Vec::new();

        // Search in index
        {
            let search_index = self.search_index.read().await;
            for term in &search_terms {
                if let Some(pubkeys) = search_index.get(term) {
                    for pubkey in pubkeys {
                        if !matching_pubkeys.contains(pubkey) {
                            matching_pubkeys.push(pubkey.clone());
                        }
                    }
                }
            }
        }

        // Get profile details
        let profiles = self.profiles.read().await;
        let mut matching_profiles: Vec<Profile> = matching_pubkeys
            .iter()
            .filter_map(|pubkey| profiles.get(pubkey).cloned())
            .collect();

        // Sort by created_at (newest first)
        matching_profiles.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        // Pagination
        let start = page * per_page;
        let end = (start + per_page).min(matching_profiles.len());
        let paginated_profiles = if start < matching_profiles.len() {
            matching_profiles[start..end].to_vec()
        } else {
            Vec::new()
        };

        Ok(ProfileSearchResult {
            profiles: paginated_profiles,
            total_count: matching_profiles.len(),
            page,
            per_page,
        })
    }

    /// Get profile by pubkey
    pub async fn get_profile(&self, pubkey: &str) -> Option<Profile> {
        self.profiles.read().await.get(pubkey).cloned()
    }

    /// Get following relationships for a user
    pub async fn get_following(&self, pubkey: &str, limit: usize) -> Vec<Contact> {
        let relationships = self.relationships.read().await;
        let mut following: Vec<Contact> = relationships
            .values()
            .filter(|contact| contact.follower_pubkey == pubkey)
            .cloned()
            .collect();

        following.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        following.truncate(limit);
        following
    }

    /// Get followers for a user
    pub async fn get_followers(&self, pubkey: &str, limit: usize) -> Vec<Contact> {
        let relationships = self.relationships.read().await;
        let mut followers: Vec<Contact> = relationships
            .values()
            .filter(|contact| contact.following_pubkey == pubkey)
            .cloned()
            .collect();

        followers.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        followers.truncate(limit);
        followers
    }

    /// Get relationship statistics for a user
    pub async fn get_relationship_stats(&self, pubkey: &str) -> RelationshipStats {
        let relationships = self.relationships.read().await;
        
        let following_count = relationships
            .values()
            .filter(|contact| contact.follower_pubkey == pubkey)
            .count();

        let followers_count = relationships
            .values()
            .filter(|contact| contact.following_pubkey == pubkey)
            .count();

        let last_contact_update = relationships
            .values()
            .filter(|contact| contact.follower_pubkey == pubkey)
            .map(|contact| contact.indexed_at)
            .max();

        RelationshipStats {
            pubkey: pubkey.to_string(),
            following_count,
            followers_count,
            last_contact_update,
        }
    }

    /// Get indexer statistics
    pub async fn get_stats(&self) -> IndexerStats {
        self.stats.read().await.clone()
    }

    /// Extract search terms from profile data
    fn extract_profile_search_terms(&self, profile_data: &serde_json::Value) -> Vec<String> {
        let mut terms = Vec::new();

        // Extract searchable fields
        if let Some(name) = profile_data.get("name").and_then(|v| v.as_str()) {
            terms.extend(self.extract_search_terms(name));
        }
        if let Some(display_name) = profile_data.get("display_name").and_then(|v| v.as_str()) {
            terms.extend(self.extract_search_terms(display_name));
        }
        if let Some(about) = profile_data.get("about").and_then(|v| v.as_str()) {
            terms.extend(self.extract_search_terms(about));
        }
        if let Some(nip05) = profile_data.get("nip05").and_then(|v| v.as_str()) {
            terms.push(nip05.to_lowercase());
        }

        terms.sort();
        terms.dedup();
        terms
    }

    /// Extract search terms from text
    fn extract_search_terms(&self, text: &str) -> Vec<String> {
        text.split_whitespace()
            .filter(|word| word.len() > 2) // Filter out short words
            .map(|word| word.to_lowercase().trim_matches(|c: char| !c.is_alphanumeric()).to_string())
            .filter(|word| !word.is_empty())
            .collect()
    }

    /// Update indexer statistics
    async fn update_stats(&self) {
        let mut stats = self.stats.write().await;
        stats.total_profiles = self.profiles.read().await.len();
        stats.total_relationships = self.relationships.read().await.len();
        stats.last_indexed = Some(Utc::now());
        stats.search_index_size = self.search_index.read().await.len();
    }

    /// Clear all indexed data
    pub async fn clear_all(&self) {
        let mut profiles = self.profiles.write().await;
        profiles.clear();

        let mut relationships = self.relationships.write().await;
        relationships.clear();

        let mut search_index = self.search_index.write().await;
        search_index.clear();

        self.update_stats().await;
        info!("Cleared all indexed data");
    }
}
