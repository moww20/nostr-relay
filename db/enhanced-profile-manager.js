const { hexToNpub, npubToHex } = require('./utils');

/**
 * Enhanced Local SQLite Profile manager with complete NOSTR metadata
 */
class EnhancedProfileManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Insert or update a profile with all metadata fields
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
            website, lud16, nip05, location, created_at, indexed_at, search_vector
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          profile.location || null,
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
   * Get complete profile by pubkey (hex or npub) with stats
   */
  async getCompleteProfile(pubkey) {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;

        // Get profile data
        const profileSql = `
          SELECT pubkey, npub, name, display_name, about, picture, banner, 
                 website, lud16, nip05, location, created_at, indexed_at
          FROM profiles 
          WHERE pubkey = ? OR npub = ?
        `;

        client.get(profileSql, [hexPubkey, pubkey], (err, profileRow) => {
          if (err) {
            console.error('Failed to get profile:', err);
            reject(err);
          } else if (!profileRow) {
            resolve(null);
          } else {
            // Get profile stats
            client.get(
              'SELECT followers_count, following_count, last_updated FROM profile_stats WHERE pubkey = ?',
              [profileRow.pubkey],
              (err, statsRow) => {
                if (err) {
                  console.error('Failed to get profile stats:', err);
                  // Continue without stats
                  resolve({
                    pubkey: profileRow.pubkey,
                    npub: profileRow.npub,
                    name: profileRow.name,
                    display_name: profileRow.display_name,
                    about: profileRow.about,
                    picture: profileRow.picture,
                    banner: profileRow.banner,
                    website: profileRow.website,
                    lud16: profileRow.lud16,
                    nip05: profileRow.nip05,
                    location: profileRow.location,
                    created_at: profileRow.created_at,
                    indexed_at: profileRow.indexed_at,
                    followers_count: 0,
                    following_count: 0,
                    last_updated: null
                  });
                } else {
                  resolve({
                    pubkey: profileRow.pubkey,
                    npub: profileRow.npub,
                    name: profileRow.name,
                    display_name: profileRow.display_name,
                    about: profileRow.about,
                    picture: profileRow.picture,
                    banner: profileRow.banner,
                    website: profileRow.website,
                    lud16: profileRow.lud16,
                    nip05: profileRow.nip05,
                    location: profileRow.location,
                    created_at: profileRow.created_at,
                    indexed_at: profileRow.indexed_at,
                    followers_count: statsRow ? statsRow.followers_count : 0,
                    following_count: statsRow ? statsRow.following_count : 0,
                    last_updated: statsRow ? statsRow.last_updated : null
                  });
                }
              }
            );
          }
        });
      } catch (error) {
        console.error('Failed to get complete profile:', error);
        reject(error);
      }
    });
  }

  /**
   * Search profiles by text with enhanced search capabilities
   */
  async searchProfiles(query, page = 1, perPage = 20) {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        const offset = (page - 1) * perPage;
        const searchTerm = `%${query}%`;

        const sql = `
          SELECT p.pubkey, p.npub, p.name, p.display_name, p.about, p.picture, p.banner, 
                 p.website, p.lud16, p.nip05, p.location, p.created_at, p.indexed_at,
                 COALESCE(ps.followers_count, 0) as followers_count,
                 COALESCE(ps.following_count, 0) as following_count
          FROM profiles p
          LEFT JOIN profile_stats ps ON p.pubkey = ps.pubkey
          WHERE p.name LIKE ? OR p.display_name LIKE ? OR p.about LIKE ? OR p.nip05 LIKE ? OR p.location LIKE ?
          ORDER BY p.indexed_at DESC
          LIMIT ? OFFSET ?
        `;

        const args = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, perPage, offset];

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
              location: row.location,
              created_at: row.created_at,
              indexed_at: row.indexed_at,
              followers_count: row.followers_count,
              following_count: row.following_count
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
   * Get profiles by follower count (for trending users)
   */
  async getTrendingProfiles(limit = 20) {
    const client = this.dbManager.getClient();

    return new Promise((resolve, reject) => {
      try {
        const sql = `
          SELECT p.pubkey, p.npub, p.name, p.display_name, p.about, p.picture, p.banner, 
                 p.website, p.lud16, p.nip05, p.location, p.created_at, p.indexed_at,
                 COALESCE(ps.followers_count, 0) as followers_count,
                 COALESCE(ps.following_count, 0) as following_count
          FROM profiles p
          LEFT JOIN profile_stats ps ON p.pubkey = ps.pubkey
          WHERE ps.followers_count > 0
          ORDER BY ps.followers_count DESC, p.indexed_at DESC
          LIMIT ?
        `;

        client.all(sql, [limit], (err, rows) => {
          if (err) {
            console.error('Failed to get trending profiles:', err);
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
              location: row.location,
              created_at: row.created_at,
              indexed_at: row.indexed_at,
              followers_count: row.followers_count,
              following_count: row.following_count
            }));
            resolve(profiles);
          }
        });
      } catch (error) {
        console.error('Failed to get trending profiles:', error);
        reject(error);
      }
    });
  }

  /**
   * Build enhanced search vector for full-text search
   */
  buildSearchVector(profile) {
    const terms = [];
    if (profile.name && typeof profile.name === 'string') terms.push(profile.name.toLowerCase());
    if (profile.display_name && typeof profile.display_name === 'string')
      terms.push(profile.display_name.toLowerCase());
    if (profile.about && typeof profile.about === 'string') terms.push(profile.about.toLowerCase());
    if (profile.nip05 && typeof profile.nip05 === 'string') terms.push(profile.nip05.toLowerCase());
    if (profile.location && typeof profile.location === 'string')
      terms.push(profile.location.toLowerCase());
    if (profile.website && typeof profile.website === 'string')
      terms.push(profile.website.toLowerCase());
    return terms.join(' ');
  }

  /**
   * Extract enhanced search terms from profile
   */
  extractSearchTerms(profile) {
    const terms = [];
    if (profile.name && typeof profile.name === 'string') terms.push(profile.name.toLowerCase());
    if (profile.display_name && typeof profile.display_name === 'string')
      terms.push(profile.display_name.toLowerCase());
    if (profile.about && typeof profile.about === 'string') terms.push(profile.about.toLowerCase());
    if (profile.nip05 && typeof profile.nip05 === 'string') terms.push(profile.nip05.toLowerCase());
    if (profile.location && typeof profile.location === 'string')
      terms.push(profile.location.toLowerCase());
    if (profile.website && typeof profile.website === 'string')
      terms.push(profile.website.toLowerCase());
    return terms;
  }

  /**
   * Update enhanced search index
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
          for (const term of terms) {
            const words = term.split(/\s+/).filter((word) => word.length > 2);
            for (const word of words) {
              insertPromises.push(
                new Promise((resolve, reject) => {
                  client.run(
                    'INSERT INTO search_index (term, pubkey, field_type) VALUES (?, ?, ?)',
                    [word, pubkey, 'profile'],
                    (err) => {
                      if (err) reject(err);
                      else resolve();
                    }
                  );
                })
              );
            }
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

module.exports = { EnhancedProfileManager };
