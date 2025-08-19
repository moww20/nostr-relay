use rusqlite::{Connection, Result as SqliteResult, params, Row};
use crate::events::Event;
use crate::filters::Filter;
use crate::config::DatabaseConfig;
use crate::indexer::{Profile, Contact};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, error};
use bech32::{self, ToBase32, FromBase32};

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(config: &DatabaseConfig) -> crate::Result<Self> {
        let conn = Connection::open(&config.path)?;
        
        // Initialize the database with tables
        Self::init_database(&conn)?;
        
        info!("Database initialized at {}", config.path);
        
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn init_database(conn: &Connection) -> SqliteResult<()> {
        // Create profiles table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS profiles (
                pubkey TEXT PRIMARY KEY,
                npub TEXT NOT NULL,
                name TEXT,
                display_name TEXT,
                about TEXT,
                picture TEXT,
                banner TEXT,
                website TEXT,
                lud16 TEXT,
                nip05 TEXT,
                created_at INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL,
                search_vector TEXT
            )",
            [],
        )?;

        // Create relationships table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS relationships (
                follower_pubkey TEXT NOT NULL,
                following_pubkey TEXT NOT NULL,
                follower_npub TEXT NOT NULL,
                following_npub TEXT NOT NULL,
                relay TEXT,
                petname TEXT,
                created_at INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL,
                PRIMARY KEY (follower_pubkey, following_pubkey)
            )",
            [],
        )?;

        // Create search index table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS search_index (
                term TEXT NOT NULL,
                pubkey TEXT NOT NULL,
                field_type TEXT NOT NULL,
                PRIMARY KEY (term, pubkey, field_type)
            )",
            [],
        )?;

        // Create indexes for better query performance
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_profiles_npub ON profiles(npub)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON profiles(display_name)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_profiles_nip05 ON profiles(nip05)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_relationships_follower ON relationships(follower_pubkey)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_relationships_following ON relationships(following_pubkey)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_relationships_follower_npub ON relationships(follower_npub)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_relationships_following_npub ON relationships(following_npub)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_search_index_term ON search_index(term)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_search_index_pubkey ON search_index(pubkey)",
            [],
        )?;

        Ok(())
    }

    /// Convert hex pubkey to npub format
    fn hex_to_npub(hex_pubkey: &str) -> Result<String, crate::RelayError> {
        let pubkey_bytes = hex::decode(hex_pubkey)
            .map_err(|e| crate::RelayError::HexDecode(e))?;
        
        let npub = bech32::encode("npub", pubkey_bytes.to_base32(), bech32::Variant::Bech32)
            .map_err(|e| crate::RelayError::Internal(format!("Failed to encode npub: {}", e)))?;
        
        Ok(npub)
    }

    /// Convert npub to hex format
    fn npub_to_hex(npub: &str) -> Result<String, crate::RelayError> {
        let (_, data, _) = bech32::decode(npub)
            .map_err(|e| crate::RelayError::Internal(format!("Failed to decode npub: {}", e)))?;
        
        let pubkey_bytes = Vec::<u8>::from_base32(&data)
            .map_err(|e| crate::RelayError::Internal(format!("Failed to convert npub data: {}", e)))?;
        
        Ok(hex::encode(pubkey_bytes))
    }

    /// Store a profile in the database
    pub async fn store_profile(&self, profile: &Profile) -> crate::Result<()> {
        let mut conn = self.conn.lock().await;
        
        let npub = Self::hex_to_npub(&profile.pubkey)?;
        let search_vector = format!("{} {} {}", 
            profile.name.as_deref().unwrap_or(""),
            profile.display_name.as_deref().unwrap_or(""),
            profile.about.as_deref().unwrap_or("")
        ).to_lowercase();

        conn.execute(
            "INSERT OR REPLACE INTO profiles (
                pubkey, npub, name, display_name, about, picture, banner, 
                website, lud16, nip05, created_at, indexed_at, search_vector
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                profile.pubkey,
                npub,
                profile.name,
                profile.display_name,
                profile.about,
                profile.picture,
                profile.banner,
                profile.website,
                profile.lud16,
                profile.nip05,
                profile.created_at,
                profile.indexed_at.timestamp(),
                search_vector,
            ],
        )?;

        // Update search index
        self.update_search_index(&profile.pubkey, &profile.search_terms).await?;
        
        Ok(())
    }

    /// Store a relationship in the database
    pub async fn store_relationship(&self, contact: &Contact) -> crate::Result<()> {
        let mut conn = self.conn.lock().await;
        
        let follower_npub = Self::hex_to_npub(&contact.follower_pubkey)?;
        let following_npub = Self::hex_to_npub(&contact.following_pubkey)?;

        conn.execute(
            "INSERT OR REPLACE INTO relationships (
                follower_pubkey, following_pubkey, follower_npub, following_npub,
                relay, petname, created_at, indexed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                contact.follower_pubkey,
                contact.following_pubkey,
                follower_npub,
                following_npub,
                contact.relay,
                contact.petname,
                contact.created_at,
                contact.indexed_at.timestamp(),
            ],
        )?;
        
        Ok(())
    }

    /// Update search index for a profile
    async fn update_search_index(&self, pubkey: &str, terms: &[String]) -> crate::Result<()> {
        let mut conn = self.conn.lock().await;
        
        // Remove old search terms for this pubkey
        conn.execute("DELETE FROM search_index WHERE pubkey = ?", params![pubkey])?;
        
        // Insert new search terms
        for term in terms {
            conn.execute(
                "INSERT INTO search_index (term, pubkey, field_type) VALUES (?, ?, ?)",
                params![term, pubkey, "profile"],
            )?;
        }
        
        Ok(())
    }

    pub async fn query_events(&self, filters: &[Filter]) -> crate::Result<Vec<Event>> {
        let conn = self.conn.lock().await;
        
        if filters.is_empty() {
            return Ok(vec![]);
        }

        // Build query based on filters
        let mut query = String::from(
            "SELECT DISTINCT e.id, e.pubkey, e.created_at, e.kind, e.tags, e.content, e.sig 
             FROM events e"
        );
        
        let mut conditions = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut param_count = 0;

        // Apply filters
        for filter in filters {
            if let Some(ids) = &filter.ids {
                let placeholders = (0..ids.len())
                    .map(|_| {
                        param_count += 1;
                        format!("?{}", param_count)
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                conditions.push(format!("e.id IN ({})", placeholders));
                for id in ids {
                    params.push(Box::new(id.clone()));
                }
            }

            if let Some(authors) = &filter.authors {
                let placeholders = (0..authors.len())
                    .map(|_| {
                        param_count += 1;
                        format!("?{}", param_count)
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                conditions.push(format!("e.pubkey IN ({})", placeholders));
                for author in authors {
                    params.push(Box::new(author.clone()));
                }
            }

            if let Some(kinds) = &filter.kinds {
                let placeholders = (0..kinds.len())
                    .map(|_| {
                        param_count += 1;
                        format!("?{}", param_count)
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                conditions.push(format!("e.kind IN ({})", placeholders));
                for kind in kinds {
                    params.push(Box::new(*kind));
                }
            }

            if let Some(since) = filter.since {
                param_count += 1;
                conditions.push(format!("e.created_at >= ?{}", param_count));
                params.push(Box::new(since));
            }

            if let Some(until) = filter.until {
                param_count += 1;
                conditions.push(format!("e.created_at <= ?{}", param_count));
                params.push(Box::new(until));
            }

            // Handle tag filters
            if let Some(filter_tags) = &filter.tags {
                for filter_tag in filter_tags {
                    if filter_tag.len() >= 2 {
                        let tag_name = &filter_tag[0];
                        let tag_values = &filter_tag[1..];
                        
                        let tag_placeholders = (0..tag_values.len())
                            .map(|_| {
                                param_count += 1;
                                format!("?{}", param_count)
                            })
                            .collect::<Vec<_>>()
                            .join(",");
                        
                        conditions.push(format!(
                            "EXISTS (SELECT 1 FROM event_tags et 
                             WHERE et.event_id = e.id 
                             AND et.tag_name = ?{} 
                             AND et.tag_value IN ({}))",
                            param_count + 1,
                            tag_placeholders
                        ));
                        
                        param_count += 1;
                        params.push(Box::new(tag_name.clone()));
                        for tag_value in tag_values {
                            params.push(Box::new(tag_value.clone()));
                        }
                    }
                }
            }
        }

        // Add WHERE clause if we have conditions
        if !conditions.is_empty() {
            query.push_str(" WHERE ");
            query.push_str(&conditions.join(" AND "));
        }

        // Add ORDER BY and LIMIT
        query.push_str(" ORDER BY e.created_at DESC");
        
        // Find the minimum limit across all filters
        let min_limit = filters.iter()
            .map(|f| f.get_limit())
            .min()
            .unwrap_or(100);
        
        query.push_str(&format!(" LIMIT {}", min_limit));

        // Execute query
        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| Self::row_to_event(row),
        )?;

        let mut events = Vec::new();
        for row_result in rows {
            match row_result {
                Ok(event) => events.push(event),
                Err(e) => {
                    error!("Error parsing event from database: {}", e);
                }
            }
        }

        Ok(events)
    }

    fn row_to_event(row: &Row) -> SqliteResult<Event> {
        let tags_json: String = row.get(4)?;
        let tags: Vec<Vec<String>> = serde_json::from_str(&tags_json)
            .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;

        Ok(Event {
            id: row.get(0)?,
            pubkey: row.get(1)?,
            created_at: row.get(2)?,
            kind: row.get(3)?,
            tags,
            content: row.get(5)?,
            sig: row.get(6)?,
        })
    }

    pub async fn get_event_by_id(&self, event_id: &str) -> crate::Result<Option<Event>> {
        let conn = self.conn.lock().await;
        
        let mut stmt = conn.prepare(
            "SELECT id, pubkey, created_at, kind, tags, content, sig 
             FROM events WHERE id = ?"
        )?;
        
        let mut rows = stmt.query_map([event_id], |row| Self::row_to_event(row))?;
        
        Ok(rows.next().transpose()?)
    }

    pub async fn delete_event(&self, event_id: &str) -> crate::Result<()> {
        let conn = self.conn.lock().await;
        
        conn.execute("DELETE FROM events WHERE id = ?", [event_id])?;
        
        Ok(())
    }

    /// Search profiles by query
    pub async fn search_profiles(&self, query: &str, page: usize, per_page: usize) -> crate::Result<Vec<Profile>> {
        let conn = self.conn.lock().await;
        let mut profiles = Vec::new();

        let search_terms: Vec<String> = query
            .split_whitespace()
            .filter(|word| word.len() > 2)
            .map(|word| word.to_lowercase())
            .collect();

        if search_terms.is_empty() {
            return Ok(profiles);
        }

        let mut sql = String::from(
            "SELECT DISTINCT p.pubkey, p.npub, p.name, p.display_name, p.about, p.picture, 
             p.banner, p.website, p.lud16, p.nip05, p.created_at, p.indexed_at
             FROM profiles p
             JOIN search_index si ON p.pubkey = si.pubkey
             WHERE "
        );

        for (i, term) in search_terms.iter().enumerate() {
            if i > 0 {
                sql.push_str(" OR ");
            }
            sql.push_str("(si.term LIKE ? OR p.search_vector LIKE ?)");
        }

        sql.push_str(" ORDER BY p.created_at DESC LIMIT ? OFFSET ?");

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        for term in &search_terms {
            let like_term = format!("%{}%", term);
            params.push(Box::new(like_term.clone()));
            params.push(Box::new(like_term));
        }
        params.push(Box::new(per_page));
        params.push(Box::new(page * per_page));

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
            Ok(Profile {
                pubkey: row.get(0)?,
                name: row.get(2)?,
                display_name: row.get(3)?,
                about: row.get(4)?,
                picture: row.get(5)?,
                banner: row.get(6)?,
                website: row.get(7)?,
                lud16: row.get(8)?,
                nip05: row.get(9)?,
                created_at: row.get(10)?,
                indexed_at: chrono::DateTime::from_timestamp(row.get::<_, i64>(11)?, 0)
                    .unwrap_or_else(|| chrono::Utc::now()),
                relay_sources: vec![],
                search_terms: vec![],
            })
        })?;

        for row in rows {
            profiles.push(row?);
        }

        Ok(profiles)
    }

    /// Get profile by pubkey (hex or npub)
    pub async fn get_profile(&self, pubkey: &str) -> crate::Result<Option<Profile>> {
        let conn = self.conn.lock().await;
        
        let hex_pubkey = if pubkey.starts_with("npub") {
            Self::npub_to_hex(pubkey)?
        } else {
            pubkey.to_string()
        };

        let mut stmt = conn.prepare(
            "SELECT pubkey, npub, name, display_name, about, picture, banner, 
             website, lud16, nip05, created_at, indexed_at
             FROM profiles WHERE pubkey = ? OR npub = ?"
        )?;

        let mut rows = stmt.query_map(params![hex_pubkey, pubkey], |row| {
            Ok(Profile {
                pubkey: row.get(0)?,
                name: row.get(2)?,
                display_name: row.get(3)?,
                about: row.get(4)?,
                picture: row.get(5)?,
                banner: row.get(6)?,
                website: row.get(7)?,
                lud16: row.get(8)?,
                nip05: row.get(9)?,
                created_at: row.get(10)?,
                indexed_at: chrono::DateTime::from_timestamp(row.get::<_, i64>(11)?, 0)
                    .unwrap_or_else(|| chrono::Utc::now()),
                relay_sources: vec![],
                search_terms: vec![],
            })
        })?;

        Ok(rows.next().transpose()?)
    }

    /// Get following relationships for a pubkey
    pub async fn get_following(&self, pubkey: &str, limit: usize) -> crate::Result<Vec<Contact>> {
        let conn = self.conn.lock().await;
        
        let hex_pubkey = if pubkey.starts_with("npub") {
            Self::npub_to_hex(pubkey)?
        } else {
            pubkey.to_string()
        };

        let mut stmt = conn.prepare(
            "SELECT follower_pubkey, following_pubkey, relay, petname, created_at, indexed_at
             FROM relationships WHERE follower_pubkey = ? ORDER BY created_at DESC LIMIT ?"
        )?;

        let rows = stmt.query_map(params![hex_pubkey, limit], |row| {
            Ok(Contact {
                follower_pubkey: row.get(0)?,
                following_pubkey: row.get(1)?,
                relay: row.get(2)?,
                petname: row.get(3)?,
                created_at: row.get(4)?,
                indexed_at: chrono::DateTime::from_timestamp(row.get::<_, i64>(5)?, 0)
                    .unwrap_or_else(|| chrono::Utc::now()),
            })
        })?;

        let mut contacts = Vec::new();
        for row in rows {
            contacts.push(row?);
        }

        Ok(contacts)
    }

    /// Get followers for a pubkey
    pub async fn get_followers(&self, pubkey: &str, limit: usize) -> crate::Result<Vec<Contact>> {
        let conn = self.conn.lock().await;
        
        let hex_pubkey = if pubkey.starts_with("npub") {
            Self::npub_to_hex(pubkey)?
        } else {
            pubkey.to_string()
        };

        let mut stmt = conn.prepare(
            "SELECT follower_pubkey, following_pubkey, relay, petname, created_at, indexed_at
             FROM relationships WHERE following_pubkey = ? ORDER BY created_at DESC LIMIT ?"
        )?;

        let rows = stmt.query_map(params![hex_pubkey, limit], |row| {
            Ok(Contact {
                follower_pubkey: row.get(0)?,
                following_pubkey: row.get(1)?,
                relay: row.get(2)?,
                petname: row.get(3)?,
                created_at: row.get(4)?,
                indexed_at: chrono::DateTime::from_timestamp(row.get::<_, i64>(5)?, 0)
                    .unwrap_or_else(|| chrono::Utc::now()),
            })
        })?;

        let mut contacts = Vec::new();
        for row in rows {
            contacts.push(row?);
        }

        Ok(contacts)
    }

    /// Get relationship statistics
    pub async fn get_relationship_stats(&self, pubkey: &str) -> crate::Result<(usize, usize)> {
        let conn = self.conn.lock().await;
        
        let hex_pubkey = if pubkey.starts_with("npub") {
            Self::npub_to_hex(pubkey)?
        } else {
            pubkey.to_string()
        };

        let following_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM relationships WHERE follower_pubkey = ?",
            params![hex_pubkey],
            |row| row.get(0)
        )?;

        let followers_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM relationships WHERE following_pubkey = ?",
            params![hex_pubkey],
            |row| row.get(0)
        )?;

        Ok((following_count as usize, followers_count as usize))
    }
}
