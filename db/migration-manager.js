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
