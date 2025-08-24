const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { LocalProfileManager } = require('./local-profile-manager');
const { LocalRelationshipManager } = require('./local-relationship-manager');
const { SearchManager } = require('./search-manager');
const { EnhancedMigrationManager } = require('./enhanced-migration-manager');

let client;
let ready;

/**
 * Local SQLite database manager for development
 */
class LocalDatabaseManager {
  constructor() {
    this.profiles = new LocalProfileManager(this);
    this.relationships = new LocalRelationshipManager(this);
    this.search = new SearchManager(this);
    this.migrations = new EnhancedMigrationManager(this);
  }

  /**
   * Get the SQLite client instance
   */
  getClient() {
    if (!client) {
      const dbPath = process.env.LOCAL_DB_PATH || path.join(__dirname, '..', 'nostr_indexer.db');
      client = new sqlite3.Database(dbPath);

      // Enable foreign keys
      client.run('PRAGMA foreign_keys = ON');

      console.log(`Using local SQLite database: ${dbPath}`);
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
    console.log('Local database initialized successfully');
  }

  /**
   * Close database connection
   */
  async close() {
    if (client) {
      return new Promise((resolve, reject) => {
        client.close((err) => {
          if (err) reject(err);
          else {
            client = null;
            ready = null;
            resolve();
          }
        });
      });
    }
  }

  /**
   * Health check for database connectivity
   */
  async healthCheck() {
    try {
      const c = this.getClient();
      return new Promise((resolve, reject) => {
        c.get('SELECT 1', (err, row) => {
          if (err) reject(err);
          else resolve({ success: true, message: 'Database connection healthy' });
        });
      });
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    const c = this.getClient();

    return new Promise((resolve, reject) => {
      c.get('SELECT COUNT(*) as count FROM profiles', (err, profileRow) => {
        if (err) return reject(err);

        c.get('SELECT COUNT(*) as count FROM relationships', (err, relationshipRow) => {
          if (err) return reject(err);

          c.get('SELECT COUNT(*) as count FROM search_index', (err, searchRow) => {
            if (err) return reject(err);

            resolve({
              total_profiles: profileRow.count,
              total_relationships: relationshipRow.count,
              search_index_size: searchRow.count,
              last_updated: new Date().toISOString()
            });
          });
        });
      });
    });
  }
}

// Export singleton instance
const localDbManager = new LocalDatabaseManager();
module.exports = { localDbManager };
