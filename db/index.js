const { createClient } = require('@libsql/client');
const { ProfileManager } = require('./profile-manager');
const { RelationshipManager } = require('./relationship-manager');
const { SearchManager } = require('./search-manager');
const { MigrationManager } = require('./migration-manager');

let client;
let ready;

/**
 * Database manager for Turso DB integration
 */
class DatabaseManager {
  constructor() {
    this.profiles = new ProfileManager(this);
    this.relationships = new RelationshipManager(this);
    this.search = new SearchManager(this);
    this.migrations = new MigrationManager(this);
  }

  /**
   * Get the Turso client instance
   */
  getClient() {
    if (!client) {
      const url = process.env.TURSO_DATABASE_URL;
      const authToken = process.env.TURSO_AUTH_TOKEN;

      if (!url) {
        throw new Error('TURSO_DATABASE_URL environment variable is required');
      }

      if (!authToken) {
        throw new Error('TURSO_AUTH_TOKEN environment variable is required');
      }

      client = createClient({ url, authToken });
    }
    return client;
  }

  /**
   * Ensure database schema is initialized
   */
  async ensureSchema() {
    if (!ready) {
      ready = this.migrations.runMigrations();
    }
    return ready;
  }

  /**
   * Initialize the database connection and schema
   */
  async init() {
    await this.ensureSchema();
    console.log('Database initialized successfully');
  }

  /**
   * Close database connection
   */
  async close() {
    if (client) {
      // Note: libsql client doesn't have a close method, but we can clear the reference
      client = null;
      ready = null;
    }
  }

  /**
   * Health check for database connectivity
   */
  async healthCheck() {
    try {
      const c = this.getClient();
      await c.execute('SELECT 1');
      return { success: true, message: 'Database connection healthy' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    const c = this.getClient();

    const profiles = await c.execute({ sql: 'SELECT COUNT(*) AS c FROM profiles', args: [] });
    const relationships = await c.execute({
      sql: 'SELECT COUNT(*) AS c FROM relationships',
      args: []
    });
    const searchIndex = await c.execute({
      sql: 'SELECT COUNT(*) AS c FROM search_index',
      args: []
    });
    const posts = await c.execute({ sql: 'SELECT COUNT(*) AS c FROM events WHERE kind = 1', args: [] });

    return {
      total_posts: (posts.rows[0] && Number(posts.rows[0].c)) || 0,
      total_profiles: (profiles.rows[0] && Number(profiles.rows[0].c)) || 0,
      total_relationships: (relationships.rows[0] && Number(relationships.rows[0].c)) || 0,
      search_index_size: (searchIndex.rows[0] && Number(searchIndex.rows[0].c)) || 0,
      last_updated: new Date().toISOString()
    };
  }
}

// Create singleton instance
const dbManager = new DatabaseManager();

module.exports = {
  DatabaseManager,
  dbManager,
  // Export individual managers for direct access
  ProfileManager,
  RelationshipManager,
  SearchManager,
  MigrationManager
};
