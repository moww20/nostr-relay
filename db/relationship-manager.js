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

      return result.rows.map((row) => ({
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

      return result.rows.map((row) => ({
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

      const followingRes = await client.execute({
        sql: 'SELECT COUNT(*) AS c FROM relationships WHERE follower_pubkey = ?1',
        args: [hexPubkey]
      });
      const followersRes = await client.execute({
        sql: 'SELECT COUNT(*) AS c FROM relationships WHERE following_pubkey = ?1',
        args: [hexPubkey]
      });
      const lastUpdateRes = await client.execute({
        sql: 'SELECT MAX(indexed_at) AS last_update FROM relationships WHERE follower_pubkey = ?1 OR following_pubkey = ?1',
        args: [hexPubkey]
      });

      return {
        pubkey: hexPubkey,
        following_count: (followingRes.rows[0] && Number(followingRes.rows[0].c)) || 0,
        followers_count: (followersRes.rows[0] && Number(followersRes.rows[0].c)) || 0,
        last_contact_update:
          lastUpdateRes.rows[0] && lastUpdateRes.rows[0].last_update
            ? new Date(Number(lastUpdateRes.rows[0].last_update) * 1000).toISOString()
            : null
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

      return result.rows.map((row) => ({
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

        const followingRes = await client.execute({
          sql: 'SELECT COUNT(*) AS c FROM relationships WHERE follower_pubkey = ?1',
          args: [hexPubkey]
        });
        const followersRes = await client.execute({
          sql: 'SELECT COUNT(*) AS c FROM relationships WHERE following_pubkey = ?1',
          args: [hexPubkey]
        });

        stats.push({
          pubkey: hexPubkey,
          following_count: (followingRes.rows[0] && Number(followingRes.rows[0].c)) || 0,
          followers_count: (followersRes.rows[0] && Number(followersRes.rows[0].c)) || 0
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
      const totalRes = await client.execute({
        sql: 'SELECT COUNT(*) AS c FROM relationships',
        args: []
      });
      const uniqueFollowersRes = await client.execute({
        sql: 'SELECT COUNT(DISTINCT follower_pubkey) AS c FROM relationships',
        args: []
      });
      const uniqueFollowingRes = await client.execute({
        sql: 'SELECT COUNT(DISTINCT following_pubkey) AS c FROM relationships',
        args: []
      });

      return {
        total_relationships: (totalRes.rows[0] && Number(totalRes.rows[0].c)) || 0,
        unique_followers: (uniqueFollowersRes.rows[0] && Number(uniqueFollowersRes.rows[0].c)) || 0,
        unique_following: (uniqueFollowingRes.rows[0] && Number(uniqueFollowingRes.rows[0].c)) || 0
      };
    } catch (error) {
      console.error('Failed to get relationship stats:', error);
      throw error;
    }
  }
}

module.exports = { RelationshipManager };
