use rusqlite::{Connection, Result as SqliteResult, params, Row};
use crate::events::Event;
use crate::filters::Filter;
use crate::config::DatabaseConfig;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, error};

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
        // Create events table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                pubkey TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                kind INTEGER NOT NULL,
                tags TEXT NOT NULL,
                content TEXT NOT NULL,
                sig TEXT NOT NULL
            )",
            [],
        )?;

        // Create indexes for better query performance
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)",
            [],
        )?;

        // Create tags table for efficient tag-based queries
        conn.execute(
            "CREATE TABLE IF NOT EXISTS event_tags (
                event_id TEXT NOT NULL,
                tag_name TEXT NOT NULL,
                tag_value TEXT NOT NULL,
                FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_tags_name_value ON event_tags(tag_name, tag_value)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_tags_event_id ON event_tags(event_id)",
            [],
        )?;

        Ok(())
    }

    pub async fn store_event(&self, event: &Event) -> crate::Result<()> {
        let mut conn = self.conn.lock().await;
        
        // Begin transaction
        let tx = conn.transaction()?;
        
        // Insert event
        tx.execute(
            "INSERT OR IGNORE INTO events (id, pubkey, created_at, kind, tags, content, sig) 
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                event.id,
                event.pubkey,
                event.created_at,
                event.kind,
                serde_json::to_string(&event.tags)?,
                event.content,
                event.sig,
            ],
        )?;

        // Insert tags
        for tag in &event.tags {
            if tag.len() >= 2 {
                let tag_name = &tag[0];
                for tag_value in tag.iter().skip(1) {
                    tx.execute(
                        "INSERT OR IGNORE INTO event_tags (event_id, tag_name, tag_value) 
                         VALUES (?, ?, ?)",
                        params![event.id, tag_name, tag_value],
                    )?;
                }
            }
        }

        // Commit transaction
        tx.commit()?;
        
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
}
