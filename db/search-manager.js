/**
 * Search manager for Turso DB operations
 */
class SearchManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Search across profiles with advanced filtering
   */
  async searchProfiles(query, options = {}) {
    const client = this.dbManager.getClient();
    
    try {
      const {
        page = 0,
        perPage = 20,
        sortBy = 'created_at',
        sortOrder = 'DESC',
        filters = {}
      } = options;

      const offset = page * perPage;
      const searchTerms = this.tokenizeQuery(query);
      
      // Build base query
      let sql = `
        SELECT DISTINCT p.pubkey, p.npub, p.name, p.display_name, p.about, 
               p.picture, p.banner, p.website, p.lud16, p.nip05, 
               p.created_at, p.indexed_at
        FROM profiles p
        LEFT JOIN search_index si ON p.pubkey = si.pubkey
        WHERE 1=1
      `;

      const args = [];

      // Add search conditions
      if (searchTerms.length > 0) {
        sql += ' AND (';
        const searchConditions = [];
        
        for (const term of searchTerms) {
          searchConditions.push(`
            p.name LIKE ? OR 
            p.display_name LIKE ? OR 
            p.about LIKE ? OR 
            si.term LIKE ?
          `);
          const likeTerm = `%${term}%`;
          args.push(likeTerm, likeTerm, likeTerm, likeTerm);
        }
        
        sql += searchConditions.join(' OR ') + ')';
      }

      // Add filters
      if (filters.hasPicture) {
        sql += ' AND p.picture IS NOT NULL';
      }
      
      if (filters.hasBanner) {
        sql += ' AND p.banner IS NOT NULL';
      }
      
      if (filters.hasNip05) {
        sql += ' AND p.nip05 IS NOT NULL';
      }
      
      if (filters.minCreatedAt) {
        sql += ' AND p.created_at >= ?';
        args.push(filters.minCreatedAt);
      }
      
      if (filters.maxCreatedAt) {
        sql += ' AND p.created_at <= ?';
        args.push(filters.maxCreatedAt);
      }

      // Add sorting
      const validSortFields = ['created_at', 'indexed_at', 'name', 'display_name'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
      const validSortOrders = ['ASC', 'DESC'];
      const order = validSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
      
      sql += ` ORDER BY p.${sortField} ${order} LIMIT ? OFFSET ?`;
      args.push(perPage, offset);

      const result = await client.execute({
        sql,
        args
      });

      // Get total count
      let countSql = `
        SELECT COUNT(DISTINCT p.pubkey) as count
        FROM profiles p
        LEFT JOIN search_index si ON p.pubkey = si.pubkey
        WHERE 1=1
      `;

      const countArgs = [];
      
      if (searchTerms.length > 0) {
        countSql += ' AND (';
        const searchConditions = [];
        
        for (const term of searchTerms) {
          searchConditions.push(`
            p.name LIKE ? OR 
            p.display_name LIKE ? OR 
            p.about LIKE ? OR 
            si.term LIKE ?
          `);
          const likeTerm = `%${term}%`;
          countArgs.push(likeTerm, likeTerm, likeTerm, likeTerm);
        }
        
        countSql += searchConditions.join(' OR ') + ')';
      }

      // Add same filters to count query
      if (filters.hasPicture) {
        countSql += ' AND p.picture IS NOT NULL';
      }
      
      if (filters.hasBanner) {
        countSql += ' AND p.banner IS NOT NULL';
      }
      
      if (filters.hasNip05) {
        countSql += ' AND p.nip05 IS NOT NULL';
      }
      
      if (filters.minCreatedAt) {
        countSql += ' AND p.created_at >= ?';
        countArgs.push(filters.minCreatedAt);
      }
      
      if (filters.maxCreatedAt) {
        countSql += ' AND p.created_at <= ?';
        countArgs.push(filters.maxCreatedAt);
      }

      const countResult = await client.execute({
        sql: countSql,
        args: countArgs
      });

      const profiles = result.rows.map(row => ({
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
        per_page: perPage,
        total_pages: Math.ceil(countResult.rows[0].count / perPage)
      };
    } catch (error) {
      console.error('Failed to search profiles:', error);
      throw error;
    }
  }

  /**
   * Get search suggestions based on partial query
   */
  async getSearchSuggestions(query, limit = 10) {
    const client = this.dbManager.getClient();
    
    try {
      const searchTerms = this.tokenizeQuery(query);
      
      if (searchTerms.length === 0) {
        return [];
      }

      const sql = `
        SELECT DISTINCT term, COUNT(*) as count
        FROM search_index
        WHERE term LIKE ?
        GROUP BY term
        ORDER BY count DESC, term ASC
        LIMIT ?
      `;

      const suggestions = [];
      
      for (const term of searchTerms) {
        const result = await client.execute({
          sql,
          args: [`${term}%`, limit]
        });

        suggestions.push(...result.rows.map(row => ({
          term: row.term,
          count: row.count
        })));
      }

      // Remove duplicates and sort by count
      const uniqueSuggestions = suggestions
        .filter((suggestion, index, self) => 
          index === self.findIndex(s => s.term === suggestion.term)
        )
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

      return uniqueSuggestions;
    } catch (error) {
      console.error('Failed to get search suggestions:', error);
      throw error;
    }
  }

  /**
   * Get popular search terms
   */
  async getPopularSearchTerms(limit = 20) {
    const client = this.dbManager.getClient();
    
    try {
      const result = await client.execute({
        sql: `
          SELECT term, COUNT(*) as count
          FROM search_index
          GROUP BY term
          ORDER BY count DESC
          LIMIT ?
        `,
        args: [limit]
      });

      return result.rows.map(row => ({
        term: row.term,
        count: row.count
      }));
    } catch (error) {
      console.error('Failed to get popular search terms:', error);
      throw error;
    }
  }

  /**
   * Get search statistics
   */
  async getSearchStats() {
    const client = this.dbManager.getClient();
    
    try {
      const [totalTerms] = await client.execute('SELECT COUNT(DISTINCT term) as count FROM search_index');
      const [totalIndexEntries] = await client.execute('SELECT COUNT(*) as count FROM search_index');
      const [avgTermsPerProfile] = await client.execute(`
        SELECT AVG(term_count) as avg_terms
        FROM (
          SELECT pubkey, COUNT(*) as term_count
          FROM search_index
          GROUP BY pubkey
        )
      `);

      return {
        total_unique_terms: totalTerms.count,
        total_index_entries: totalIndexEntries.count,
        avg_terms_per_profile: Math.round(avgTermsPerProfile.avg_terms || 0)
      };
    } catch (error) {
      console.error('Failed to get search stats:', error);
      throw error;
    }
  }

  /**
   * Tokenize search query into terms
   */
  tokenizeQuery(query) {
    if (!query || typeof query !== 'string') {
      return [];
    }

    return query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(term => term.length >= 2)
      .slice(0, 10); // Limit to 10 terms
  }

  /**
   * Build search index for a profile
   */
  async buildSearchIndex(pubkey, profile) {
    const client = this.dbManager.getClient();
    
    try {
      // Remove existing search terms
      await client.execute({
        sql: 'DELETE FROM search_index WHERE pubkey = ?',
        args: [pubkey]
      });

      // Extract search terms from profile
      const searchText = [
        profile.name || '',
        profile.display_name || '',
        profile.about || ''
      ].join(' ').toLowerCase();

      const terms = this.tokenizeQuery(searchText);

      // Insert new search terms
      for (const term of terms) {
        await client.execute({
          sql: 'INSERT INTO search_index (term, pubkey, field_type) VALUES (?, ?, ?)',
          args: [term, pubkey, 'profile']
        });
      }

      return terms.length;
    } catch (error) {
      console.error('Failed to build search index:', error);
      throw error;
    }
  }

  /**
   * Clean up orphaned search index entries
   */
  async cleanupSearchIndex() {
    const client = this.dbManager.getClient();
    
    try {
      const result = await client.execute(`
        DELETE FROM search_index 
        WHERE pubkey NOT IN (SELECT pubkey FROM profiles)
      `);

      return result.rowsAffected;
    } catch (error) {
      console.error('Failed to cleanup search index:', error);
      throw error;
    }
  }
}

module.exports = { SearchManager };
