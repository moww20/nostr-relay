/**
 * Local SQLite Migration manager
 */
class LocalMigrationManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Run all database migrations
   */
  async runMigrations() {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        console.log('Running database migrations...');

        // Create profiles table
        client.run(
          `
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
        `,
          (err) => {
            if (err) {
              console.error('Failed to create profiles table:', err);
              reject(err);
              return;
            }

            // Create relationships table
            client.run(
              `
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
          `,
              (err) => {
                if (err) {
                  console.error('Failed to create relationships table:', err);
                  reject(err);
                  return;
                }

                // Create search_index table
                client.run(
                  `
              CREATE TABLE IF NOT EXISTS search_index (
                term TEXT NOT NULL,
                pubkey TEXT NOT NULL,
                field_type TEXT NOT NULL,
                PRIMARY KEY (term, pubkey, field_type)
              )
            `,
                  (err) => {
                    if (err) {
                      console.error('Failed to create search_index table:', err);
                      reject(err);
                      return;
                    }

                    // Create indexer_state table
                    client.run(
                      `
                CREATE TABLE IF NOT EXISTS indexer_state (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                )
              `,
                      (err) => {
                        if (err) {
                          console.error('Failed to create indexer_state table:', err);
                          reject(err);
                          return;
                        }

                        // Create indexes for better performance
                        this.createIndexes(client)
                          .then(() => {
                            console.log('Database migrations completed successfully');
                            resolve(true);
                          })
                          .catch(reject);
                      }
                    );
                  }
                );
              }
            );
          }
        );
      } catch (error) {
        console.error('Migration failed:', error);
        reject(error);
      }
    });
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

    const createIndexPromises = indexes.map((index) => {
      return new Promise((resolve) => {
        client.run(index, (err) => {
          if (err) {
            console.warn(`Failed to create index: ${index}`, err.message);
            // Don't reject, just resolve with warning
            resolve();
          } else {
            resolve();
          }
        });
      });
    });

    await Promise.all(createIndexPromises);
  }

  /**
   * Reset database (drop all tables) - use with caution!
   */
  async resetDatabase() {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        console.log('Resetting database...');

        client.run('DROP TABLE IF EXISTS search_index', (err) => {
          if (err) {
            reject(err);
            return;
          }

          client.run('DROP TABLE IF EXISTS relationships', (err) => {
            if (err) {
              reject(err);
              return;
            }

            client.run('DROP TABLE IF EXISTS profiles', (err) => {
              if (err) {
                reject(err);
                return;
              }

              console.log('Database reset completed');
              resolve();
            });
          });
        });
      } catch (error) {
        console.error('Database reset failed:', error);
        reject(error);
      }
    });
  }

  /**
   * Get database schema information
   */
  async getSchemaInfo() {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        client.all(
          `
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
          (err, tables) => {
            if (err) {
              reject(err);
              return;
            }

            const schemaInfo = {};
            let processedTables = 0;

            if (tables.length === 0) {
              resolve(schemaInfo);
              return;
            }

            tables.forEach((table) => {
              const tableName = table.name;
              client.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
                if (err) {
                  console.warn(`Failed to get columns for table ${tableName}:`, err.message);
                } else {
                  schemaInfo[tableName] = columns;
                }

                processedTables++;
                if (processedTables === tables.length) {
                  resolve(schemaInfo);
                }
              });
            });
          }
        );
      } catch (error) {
        console.error('Failed to get schema info:', error);
        reject(error);
      }
    });
  }
}

module.exports = { LocalMigrationManager };
