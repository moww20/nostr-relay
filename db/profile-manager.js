const { hexToNpub, npubToHex } = require('./utils');

/**
 * Profile manager for Turso DB operations
 */
class ProfileManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Insert or update a profile
   */
  async upsertProfile(profile) {
    const client = this.dbManager.getClient();

    try {
      const npub = hexToNpub(profile.pubkey);
      const searchVector = this.buildSearchVector(profile);
      const indexedAt = Math.floor(Date.now() / 1000);

      await client.execute({
        sql: `
          INSERT OR REPLACE INTO profiles (
            pubkey, npub, name, display_name, about, picture, banner, 
            website, lud16, nip05, created_at, indexed_at, search_vector
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
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
        ]
      });

      // Update search index
      await this.updateSearchIndex(profile.pubkey, this.extractSearchTerms(profile));

      return true;
    } catch (error) {
      console.error('Failed to upsert profile:', error);
      throw error;
    }
  }

  /**
   * Get profile by pubkey (hex or npub)
   */
  async getProfile(pubkey) {
    const client = this.dbManager.getClient();

    try {
      const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;

      const result = await client.execute({
        sql: `
          SELECT pubkey, npub, name, display_name, about, picture, banner, 
                 website, lud16, nip05, created_at, indexed_at
          FROM profiles 
          WHERE pubkey = ? OR npub = ?
        `,
        args: [hexPubkey, pubkey]
      });

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
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
      };
    } catch (error) {
      console.error('Failed to get profile:', error);
      throw error;
    }
  }

  /**
   * Search profiles by query
   */
  async searchProfiles(query, page = 0, perPage = 20) {
    const client = this.dbManager.getClient();

    try {
      const searchTerms = this.tokenizeQuery(query);
      const offset = page * perPage;

      // Build search query
      let searchQuery = `
        SELECT DISTINCT p.pubkey, p.npub, p.name, p.display_name, p.about, 
               p.picture, p.banner, p.website, p.lud16, p.nip05, 
               p.created_at, p.indexed_at
        FROM profiles p
        LEFT JOIN search_index si ON p.pubkey = si.pubkey
        WHERE 1=0
      `;

      const args = [];
      for (const term of searchTerms) {
        searchQuery += `
          OR p.name LIKE ? 
          OR p.display_name LIKE ? 
          OR p.about LIKE ? 
          OR si.term LIKE ?
        `;
        const likeTerm = `%${term}%`;
        args.push(likeTerm, likeTerm, likeTerm, likeTerm);
      }

      searchQuery += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
      args.push(perPage, offset);

      const result = await client.execute({
        sql: searchQuery,
        args
      });

      // Get total count
      let countQuery = `
        SELECT COUNT(DISTINCT p.pubkey) as count
        FROM profiles p
        LEFT JOIN search_index si ON p.pubkey = si.pubkey
        WHERE 1=0
      `;

      const countArgs = [];
      for (const term of searchTerms) {
        countQuery += `
          OR p.name LIKE ? 
          OR p.display_name LIKE ? 
          OR p.about LIKE ? 
          OR si.term LIKE ?
        `;
        const likeTerm = `%${term}%`;
        countArgs.push(likeTerm, likeTerm, likeTerm, likeTerm);
      }

      const countResult = await client.execute({
        sql: countQuery,
        args: countArgs
      });

      const profiles = result.rows.map((row) => ({
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

      return {
        profiles,
        total_count: countResult.rows[0].count,
        page,
        per_page: perPage
      };
    } catch (error) {
      console.error('Failed to search profiles:', error);
      throw error;
    }
  }

  /**
   * Get profiles by NIP-05 identifier
   */
  async getProfilesByNip05(nip05) {
    const client = this.dbManager.getClient();

    try {
      const result = await client.execute({
        sql: `
          SELECT pubkey, npub, name, display_name, about, picture, banner, 
                 website, lud16, nip05, created_at, indexed_at
          FROM profiles 
          WHERE nip05 = ?
          ORDER BY created_at DESC
        `,
        args: [nip05]
      });

      return result.rows.map((row) => ({
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
    } catch (error) {
      console.error('Failed to get profiles by NIP-05:', error);
      throw error;
    }
  }

  /**
   * Delete a profile
   */
  async deleteProfile(pubkey) {
    const client = this.dbManager.getClient();

    try {
      await client.execute({
        sql: 'DELETE FROM profiles WHERE pubkey = ?',
        args: [pubkey]
      });

      // Clean up search index
      await client.execute({
        sql: 'DELETE FROM search_index WHERE pubkey = ?',
        args: [pubkey]
      });

      return true;
    } catch (error) {
      console.error('Failed to delete profile:', error);
      throw error;
    }
  }

  /**
   * Get profile statistics
   */
  async getProfileStats() {
    const client = this.dbManager.getClient();

    try {
      const total = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM profiles', args: [] });
      const withPictures = await client.execute({
        sql: 'SELECT COUNT(*) AS c FROM profiles WHERE picture IS NOT NULL',
        args: []
      });
      const withBanners = await client.execute({
        sql: 'SELECT COUNT(*) AS c FROM profiles WHERE banner IS NOT NULL',
        args: []
      });
      const withNip05 = await client.execute({
        sql: 'SELECT COUNT(*) AS c FROM profiles WHERE nip05 IS NOT NULL',
        args: []
      });

      return {
        total_profiles: (total.rows[0] && Number(total.rows[0].c)) || 0,
        profiles_with_pictures: (withPictures.rows[0] && Number(withPictures.rows[0].c)) || 0,
        profiles_with_banners: (withBanners.rows[0] && Number(withBanners.rows[0].c)) || 0,
        profiles_with_nip05: (withNip05.rows[0] && Number(withNip05.rows[0].c)) || 0
      };
    } catch (error) {
      console.error('Failed to get profile stats:', error);
      throw error;
    }
  }

  /**
   * Build search vector for profile
   */
  buildSearchVector(profile) {
    return [profile.name || '', profile.display_name || '', profile.about || '']
      .join(' ')
      .toLowerCase();
  }

  /**
   * Extract search terms from profile
   */
  extractSearchTerms(profile) {
    const text = this.buildSearchVector(profile);
    return this.tokenizeQuery(text);
  }

  /**
   * Tokenize search query into terms
   */
  tokenizeQuery(query) {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2)
      .slice(0, 10); // Limit to 10 terms
  }

  /**
   * Update search index for a profile
   */
  async updateSearchIndex(pubkey, terms) {
    const client = this.dbManager.getClient();

    try {
      // Remove old search terms
      await client.execute({
        sql: 'DELETE FROM search_index WHERE pubkey = ?',
        args: [pubkey]
      });

      // Insert new search terms (deduplicated and idempotent)
      const uniqueTerms = Array.from(new Set(terms));
      for (const term of uniqueTerms) {
        await client.execute({
          sql: 'INSERT OR IGNORE INTO search_index (term, pubkey, field_type) VALUES (?, ?, ?)',
          args: [term, pubkey, 'profile']
        });
      }
    } catch (error) {
      console.error('Failed to update search index:', error);
      throw error;
    }
  }
}

module.exports = { ProfileManager };
