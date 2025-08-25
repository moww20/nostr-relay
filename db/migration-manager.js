/**
 * Migration manager for Turso DB schema management
 */
class MigrationManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Run all database migrations
   */
  async runMigrations() {
    const client = this.dbManager.getClient();

    try {
      console.log('Running database migrations...');

      // Create profiles table
      await client.execute(`
        CREATE TABLE IF NOT EXISTS profiles (
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
        )
      `);

      // Create relationships table
      await client.execute(`
        CREATE TABLE IF NOT EXISTS relationships (
          follower_pubkey TEXT NOT NULL,
          following_pubkey TEXT NOT NULL,
          follower_npub TEXT NOT NULL,
          following_npub TEXT NOT NULL,
          relay TEXT,
          petname TEXT,
          created_at INTEGER NOT NULL,
          indexed_at INTEGER NOT NULL,
          PRIMARY KEY (follower_pubkey, following_pubkey)
        )
      `);

      // Create search_index table
      await client.execute(`
        CREATE TABLE IF NOT EXISTS search_index (
          term TEXT NOT NULL,
          pubkey TEXT NOT NULL,
          field_type TEXT NOT NULL,
          PRIMARY KEY (term, pubkey, field_type)
        )
      `);

      // Create indexer_state table
      await client.execute(`
        CREATE TABLE IF NOT EXISTS indexer_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // Trending and engagement tables
      await client.execute(`
        CREATE TABLE IF NOT EXISTS engagement_counts (
          event_id TEXT PRIMARY KEY,
          likes INTEGER DEFAULT 0,
          reposts INTEGER DEFAULT 0,
          replies INTEGER DEFAULT 0,
          zaps INTEGER DEFAULT 0,
          updated_at INTEGER NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS trending_snapshots (
          id TEXT PRIMARY KEY,
          window_start INTEGER NOT NULL,
          window_end INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS trending_items (
          snapshot_id TEXT NOT NULL,
          rank INTEGER NOT NULL,
          event_id TEXT NOT NULL,
          pubkey TEXT NOT NULL,
          kind INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          score REAL NOT NULL,
          likes INTEGER DEFAULT 0,
          reposts INTEGER DEFAULT 0,
          replies INTEGER DEFAULT 0,
          zaps INTEGER DEFAULT 0,
          PRIMARY KEY (snapshot_id, rank)
        )
      `);

      // Events storage for search/threads
      await client.execute(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          kind INTEGER NOT NULL,
          pubkey TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          content TEXT,
          tags_json TEXT,
          deleted INTEGER DEFAULT 0
        )
      `);

      // FTS5 for events (content + tags)
      await client.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
          id UNINDEXED,
          content,
          tags,
          tokenize='porter'
        )
      `);

      // Triggers to keep FTS in sync
      await client.execute(`
        CREATE TRIGGER IF NOT EXISTS trg_events_ai AFTER INSERT ON events BEGIN
          INSERT INTO events_fts(rowid, id, content, tags) VALUES (new.rowid, new.id, new.content, COALESCE(new.tags_json,''));
        END;
      `);
      await client.execute(`
        CREATE TRIGGER IF NOT EXISTS trg_events_ad AFTER DELETE ON events BEGIN
          INSERT INTO events_fts(events_fts, rowid, id, content, tags) VALUES('delete', old.rowid, old.id, old.content, COALESCE(old.tags_json,''));
        END;
      `);
      await client.execute(`
        CREATE TRIGGER IF NOT EXISTS trg_events_au AFTER UPDATE ON events BEGIN
          INSERT INTO events_fts(events_fts, rowid, id, content, tags) VALUES('delete', old.rowid, old.id, old.content, COALESCE(old.tags_json,''));
          INSERT INTO events_fts(rowid, id, content, tags) VALUES (new.rowid, new.id, new.content, COALESCE(new.tags_json,''));
        END;
      `);

      // Create indexes for better performance
      await this.createIndexes(client);

      console.log('Database migrations completed successfully');
      return true;
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Create database indexes for better query performance
   */
  async createIndexes(client) {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_profiles_npub ON profiles(npub)',
      'CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name)',
      'CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON profiles(display_name)',
      'CREATE INDEX IF NOT EXISTS idx_profiles_nip05 ON profiles(nip05)',
      'CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_profiles_indexed_at ON profiles(indexed_at)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_follower ON relationships(follower_pubkey)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_following ON relationships(following_pubkey)',
      'CREATE INDEX IF NOT EXISTS idx_relationships_created_at ON relationships(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_search_index_term ON search_index(term)',
      'CREATE INDEX IF NOT EXISTS idx_search_index_pubkey ON search_index(pubkey)',
      'CREATE INDEX IF NOT EXISTS idx_search_index_field_type ON search_index(field_type)'
      , 'CREATE INDEX IF NOT EXISTS idx_engagement_updated ON engagement_counts(updated_at)'
      , 'CREATE INDEX IF NOT EXISTS idx_trend_items_snapshot ON trending_items(snapshot_id)'
      , 'CREATE INDEX IF NOT EXISTS idx_trend_items_event ON trending_items(event_id)'
      , 'CREATE INDEX IF NOT EXISTS idx_trend_snap_created ON trending_snapshots(created_at)'
      , 'CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)'
      , 'CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey)'
    ];

    for (const index of indexes) {
      try {
        await client.execute(index);
      } catch (error) {
        console.warn(`Failed to create index: ${index}`, error.message);
      }
    }
  }

  /**
   * Reset database (drop all tables) - use with caution!
   */
  async resetDatabase() {
    const client = this.dbManager.getClient();

    try {
      console.log('Resetting database...');

      await client.execute('DROP TABLE IF EXISTS search_index');
      await client.execute('DROP TABLE IF EXISTS relationships');
      await client.execute('DROP TABLE IF EXISTS profiles');

      console.log('Database reset completed');
    } catch (error) {
      console.error('Database reset failed:', error);
      throw error;
    }
  }

  /**
   * Get database schema information
   */
  async getSchemaInfo() {
    const client = this.dbManager.getClient();

    try {
      const tables = await client.execute(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `);

      const schemaInfo = {};

      for (const table of tables.rows) {
        const tableName = table.name;
        const columns = await client.execute(`PRAGMA table_info(${tableName})`);
        schemaInfo[tableName] = columns.rows;
      }

      return schemaInfo;
    } catch (error) {
      console.error('Failed to get schema info:', error);
      throw error;
    }
  }
}

module.exports = { MigrationManager };
