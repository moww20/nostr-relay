const { hexToNpub, npubToHex } = require('./utils');

/**
 * Local SQLite Profile manager
 */
class LocalProfileManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Insert or update a profile
   */
  async upsertProfile(profile) {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        const npub = hexToNpub(profile.pubkey);
        const searchVector = this.buildSearchVector(profile);
        const indexedAt = Math.floor(Date.now() / 1000);

        const sql = `
          INSERT OR REPLACE INTO profiles (
            pubkey, npub, name, display_name, about, picture, banner, 
            website, lud16, nip05, created_at, indexed_at, search_vector
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const args = [
          profile.pubkey,
          npub,
          profile.name || null,
          profile.display_name || null,
          profile.about || null,
          profile.picture || null,
          profile.banner || null,
          profile.website || null,
          profile.lud16 || null,
          profile.nip05 || null,
          profile.created_at || indexedAt,
          indexedAt,
          searchVector
        ];

        client.run(
          sql,
          args,
          function (err) {
            if (err) {
              console.error('Failed to upsert profile:', err);
              reject(err);
            } else {
              // Update search index
              this.updateSearchIndex(profile.pubkey, this.extractSearchTerms(profile))
                .then(() => resolve(true))
                .catch(reject);
            }
          }.bind(this)
        );
      } catch (error) {
        console.error('Failed to upsert profile:', error);
        reject(error);
      }
    });
  }

  /**
   * Get profile by pubkey (hex or npub)
   */
  async getProfile(pubkey) {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;

        const sql = `
          SELECT pubkey, npub, name, display_name, about, picture, banner, 
                 website, lud16, nip05, created_at, indexed_at
          FROM profiles 
          WHERE pubkey = ? OR npub = ?
        `;

        client.get(sql, [hexPubkey, pubkey], (err, row) => {
          if (err) {
            console.error('Failed to get profile:', err);
            reject(err);
          } else if (!row) {
            resolve(null);
          } else {
            resolve({
              pubkey: row.pubkey,
              npub: row.npub,
              name: row.name,
              display_name: row.display_name,
              about: row.about,
              picture: row.picture,
              banner: row.banner,
              website: row.website,
              lud16: row.lud16,
              nip05: row.nip05,
              created_at: row.created_at,
              indexed_at: row.indexed_at
            });
          }
        });
      } catch (error) {
        console.error('Failed to get profile:', error);
        reject(error);
      }
    });
  }

  /**
   * Search profiles by text
   */
  async searchProfiles(query, page = 1, perPage = 20) {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        const offset = (page - 1) * perPage;
        const searchTerm = `%${query}%`;

        const sql = `
          SELECT pubkey, npub, name, display_name, about, picture, banner, 
                 website, lud16, nip05, created_at, indexed_at
          FROM profiles 
          WHERE name LIKE ? OR display_name LIKE ? OR about LIKE ? OR nip05 LIKE ?
          ORDER BY indexed_at DESC
          LIMIT ? OFFSET ?
        `;

        const args = [searchTerm, searchTerm, searchTerm, searchTerm, perPage, offset];

        client.all(sql, args, (err, rows) => {
          if (err) {
            console.error('Failed to search profiles:', err);
            reject(err);
          } else {
            const profiles = rows.map((row) => ({
              pubkey: row.pubkey,
              npub: row.npub,
              name: row.name,
              display_name: row.display_name,
              about: row.about,
              picture: row.picture,
              banner: row.banner,
              website: row.website,
              lud16: row.lud16,
              nip05: row.nip05,
              created_at: row.created_at,
              indexed_at: row.indexed_at
            }));
            resolve(profiles);
          }
        });
      } catch (error) {
        console.error('Failed to search profiles:', error);
        reject(error);
      }
    });
  }

  /**
   * Build search vector for full-text search
   */
  buildSearchVector(profile) {
    const terms = [];
    if (profile.name && typeof profile.name === 'string') terms.push(profile.name.toLowerCase());
    if (profile.display_name && typeof profile.display_name === 'string') {
      terms.push(profile.display_name.toLowerCase());
    }
    if (profile.about && typeof profile.about === 'string') terms.push(profile.about.toLowerCase());
    if (profile.nip05 && typeof profile.nip05 === 'string') terms.push(profile.nip05.toLowerCase());
    return terms.join(' ');
  }

  /**
   * Extract search terms from profile
   */
  extractSearchTerms(profile) {
    const terms = [];
    if (profile.name && typeof profile.name === 'string') terms.push(profile.name.toLowerCase());
    if (profile.display_name && typeof profile.display_name === 'string') {
      terms.push(profile.display_name.toLowerCase());
    }
    if (profile.about && typeof profile.about === 'string') terms.push(profile.about.toLowerCase());
    if (profile.nip05 && typeof profile.nip05 === 'string') terms.push(profile.nip05.toLowerCase());
    return terms;
  }

  /**
   * Update search index
   */
  async updateSearchIndex(pubkey, terms) {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        // First, remove existing search terms for this pubkey
        client.run('DELETE FROM search_index WHERE pubkey = ?', [pubkey], (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Then insert new search terms
          const insertPromises = [];
          const uniqueWords = new Set();
          for (const term of terms) {
            const words = term.split(/\s+/).filter((word) => word.length > 2);
            for (const word of words) {
              uniqueWords.add(word);
            }
          }
          for (const word of uniqueWords) {
            insertPromises.push(
              new Promise((resolve, reject) => {
                client.run(
                  'INSERT OR IGNORE INTO search_index (term, pubkey, field_type) VALUES (?, ?, ?)',
                  [word, pubkey, 'profile'],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              })
            );
          }

          Promise.all(insertPromises)
            .then(() => resolve())
            .catch(reject);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = { LocalProfileManager };
