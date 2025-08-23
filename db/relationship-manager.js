const { hexToNpub, npubToHex } = require('./utils');

/**
 * Relationship manager for Turso DB operations
 */
class RelationshipManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Insert or update a relationship
   */
  async upsertRelationship(relationship) {
    const client = this.dbManager.getClient();
    
    try {
      const followerNpub = hexToNpub(relationship.follower_pubkey);
      const followingNpub = hexToNpub(relationship.following_pubkey);
      const indexedAt = Math.floor(Date.now() / 1000);

      await client.execute({
        sql: `
          INSERT OR REPLACE INTO relationships (
            follower_pubkey, following_pubkey, follower_npub, following_npub,
            relay, petname, created_at, indexed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          relationship.follower_pubkey,
          relationship.following_pubkey,
          followerNpub,
          followingNpub,
          relationship.relay || null,
          relationship.petname || null,
          relationship.created_at || indexedAt,
          indexedAt
        ]
      });

      return true;
    } catch (error) {
      console.error('Failed to upsert relationship:', error);
      throw error;
    }
  }

  /**
   * Get following relationships for a user
   */
  async getFollowing(pubkey, limit = 100) {
    const client = this.dbManager.getClient();
    
    try {
      const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;
      
      const result = await client.execute({
        sql: `
          SELECT follower_pubkey, following_pubkey, follower_npub, following_npub,
                 relay, petname, created_at, indexed_at
          FROM relationships 
          WHERE follower_pubkey = ? 
          ORDER BY created_at DESC 
          LIMIT ?
        `,
        args: [hexPubkey, limit]
      });

      return result.rows.map(row => ({
        follower_pubkey: row.follower_pubkey,
        following_pubkey: row.following_pubkey,
        follower_npub: row.follower_npub,
        following_npub: row.following_npub,
        relay: row.relay,
        petname: row.petname,
        created_at: row.created_at,
        indexed_at: row.indexed_at
      }));
    } catch (error) {
      console.error('Failed to get following:', error);
      throw error;
    }
  }

  /**
   * Get followers for a user
   */
  async getFollowers(pubkey, limit = 100) {
    const client = this.dbManager.getClient();
    
    try {
      const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;
      
      const result = await client.execute({
        sql: `
          SELECT follower_pubkey, following_pubkey, follower_npub, following_npub,
                 relay, petname, created_at, indexed_at
          FROM relationships 
          WHERE following_pubkey = ? 
          ORDER BY created_at DESC 
          LIMIT ?
        `,
        args: [hexPubkey, limit]
      });

      return result.rows.map(row => ({
        follower_pubkey: row.follower_pubkey,
        following_pubkey: row.following_pubkey,
        follower_npub: row.follower_npub,
        following_npub: row.following_npub,
        relay: row.relay,
        petname: row.petname,
        created_at: row.created_at,
        indexed_at: row.indexed_at
      }));
    } catch (error) {
      console.error('Failed to get followers:', error);
      throw error;
    }
  }

  /**
   * Get relationship statistics for a user
   */
  async getRelationshipStats(pubkey) {
    const client = this.dbManager.getClient();
    
    try {
      const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;
      
      const [followingCount] = await client.execute({
        sql: 'SELECT COUNT(*) as count FROM relationships WHERE follower_pubkey = ?',
        args: [hexPubkey]
      });

      const [followersCount] = await client.execute({
        sql: 'SELECT COUNT(*) as count FROM relationships WHERE following_pubkey = ?',
        args: [hexPubkey]
      });

      const [lastUpdate] = await client.execute({
        sql: `
          SELECT MAX(indexed_at) as last_update 
          FROM relationships 
          WHERE follower_pubkey = ? OR following_pubkey = ?
        `,
        args: [hexPubkey, hexPubkey]
      });

      return {
        pubkey: hexPubkey,
        following_count: followingCount.count,
        followers_count: followersCount.count,
        last_contact_update: lastUpdate.last_update ? new Date(lastUpdate.last_update * 1000).toISOString() : null
      };
    } catch (error) {
      console.error('Failed to get relationship stats:', error);
      throw error;
    }
  }

  /**
   * Check if a relationship exists
   */
  async relationshipExists(followerPubkey, followingPubkey) {
    const client = this.dbManager.getClient();
    
    try {
      const result = await client.execute({
        sql: `
          SELECT 1 FROM relationships 
          WHERE follower_pubkey = ? AND following_pubkey = ?
        `,
        args: [followerPubkey, followingPubkey]
      });

      return result.rows.length > 0;
    } catch (error) {
      console.error('Failed to check relationship existence:', error);
      throw error;
    }
  }

  /**
   * Delete a relationship
   */
  async deleteRelationship(followerPubkey, followingPubkey) {
    const client = this.dbManager.getClient();
    
    try {
      await client.execute({
        sql: `
          DELETE FROM relationships 
          WHERE follower_pubkey = ? AND following_pubkey = ?
        `,
        args: [followerPubkey, followingPubkey]
      });

      return true;
    } catch (error) {
      console.error('Failed to delete relationship:', error);
      throw error;
    }
  }

  /**
   * Get mutual followers (users who follow each other)
   */
  async getMutualFollowers(pubkey, limit = 50) {
    const client = this.dbManager.getClient();
    
    try {
      const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;
      
      const result = await client.execute({
        sql: `
          SELECT r1.follower_pubkey, r1.follower_npub
          FROM relationships r1
          INNER JOIN relationships r2 ON r1.follower_pubkey = r2.following_pubkey 
            AND r1.following_pubkey = r2.follower_pubkey
          WHERE r1.following_pubkey = ?
          ORDER BY r1.created_at DESC
          LIMIT ?
        `,
        args: [hexPubkey, limit]
      });

      return result.rows.map(row => ({
        pubkey: row.follower_pubkey,
        npub: row.follower_npub
      }));
    } catch (error) {
      console.error('Failed to get mutual followers:', error);
      throw error;
    }
  }

  /**
   * Get relationship statistics for multiple users
   */
  async getBulkRelationshipStats(pubkeys) {
    const client = this.dbManager.getClient();
    
    try {
      const stats = [];
      
      for (const pubkey of pubkeys) {
        const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;
        
        const [followingCount] = await client.execute({
          sql: 'SELECT COUNT(*) as count FROM relationships WHERE follower_pubkey = ?',
          args: [hexPubkey]
        });

        const [followersCount] = await client.execute({
          sql: 'SELECT COUNT(*) as count FROM relationships WHERE following_pubkey = ?',
          args: [hexPubkey]
        });

        stats.push({
          pubkey: hexPubkey,
          following_count: followingCount.count,
          followers_count: followersCount.count
        });
      }

      return stats;
    } catch (error) {
      console.error('Failed to get bulk relationship stats:', error);
      throw error;
    }
  }

  /**
   * Get relationship statistics
   */
  async getRelationshipStats() {
    const client = this.dbManager.getClient();
    
    try {
      const [totalRelationships] = await client.execute('SELECT COUNT(*) as count FROM relationships');
      const [uniqueFollowers] = await client.execute('SELECT COUNT(DISTINCT follower_pubkey) as count FROM relationships');
      const [uniqueFollowing] = await client.execute('SELECT COUNT(DISTINCT following_pubkey) as count FROM relationships');

      return {
        total_relationships: totalRelationships.count,
        unique_followers: uniqueFollowers.count,
        unique_following: uniqueFollowing.count
      };
    } catch (error) {
      console.error('Failed to get relationship stats:', error);
      throw error;
    }
  }
}

module.exports = { RelationshipManager };
