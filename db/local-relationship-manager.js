const { hexToNpub, npubToHex } = require('./utils');

/**
 * Local SQLite Relationship manager
 */
class LocalRelationshipManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Insert or update a relationship
   */
  async upsertRelationship(relationship) {
    const client = this.dbManager.getClient();
    
    return new Promise((resolve, reject) => {
      try {
        const followerNpub = hexToNpub(relationship.follower_pubkey);
        const followingNpub = hexToNpub(relationship.following_pubkey);

        const sql = `
          INSERT OR REPLACE INTO relationships (
            follower_pubkey, following_pubkey, follower_npub, following_npub,
            relay, petname, created_at, indexed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const args = [
          relationship.follower_pubkey,
          relationship.following_pubkey,
          followerNpub,
          followingNpub,
          relationship.relay || null,
          relationship.petname || null,
          relationship.created_at,
          relationship.indexed_at
        ];

        client.run(sql, args, function(err) {
          if (err) {
            console.error('Failed to upsert relationship:', err);
            reject(err);
          } else {
            resolve(true);
          }
        });
      } catch (error) {
        console.error('Failed to upsert relationship:', error);
        reject(error);
      }
    });
  }

  /**
   * Get who a user follows
   */
  async getFollowing(pubkey, limit = 100) {
    const client = this.dbManager.getClient();
    
    return new Promise((resolve, reject) => {
      try {
        const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;
        
        const sql = `
          SELECT r.following_pubkey, r.following_npub, r.relay, r.petname, r.created_at,
                 p.name, p.display_name, p.picture, p.nip05
          FROM relationships r
          LEFT JOIN profiles p ON r.following_pubkey = p.pubkey
          WHERE r.follower_pubkey = ?
          ORDER BY r.created_at DESC
          LIMIT ?
        `;

        client.all(sql, [hexPubkey, limit], (err, rows) => {
          if (err) {
            console.error('Failed to get following:', err);
            reject(err);
          } else {
            const following = rows.map(row => ({
              pubkey: row.following_pubkey,
              npub: row.following_npub,
              relay: row.relay,
              petname: row.petname,
              created_at: row.created_at,
              profile: row.name ? {
                name: row.name,
                display_name: row.display_name,
                picture: row.picture,
                nip05: row.nip05
              } : null
            }));
            resolve(following);
          }
        });
      } catch (error) {
        console.error('Failed to get following:', error);
        reject(error);
      }
    });
  }

  /**
   * Get who follows a user
   */
  async getFollowers(pubkey, limit = 100) {
    const client = this.dbManager.getClient();
    
    return new Promise((resolve, reject) => {
      try {
        const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;
        
        const sql = `
          SELECT r.follower_pubkey, r.follower_npub, r.relay, r.petname, r.created_at,
                 p.name, p.display_name, p.picture, p.nip05
          FROM relationships r
          LEFT JOIN profiles p ON r.follower_pubkey = p.pubkey
          WHERE r.following_pubkey = ?
          ORDER BY r.created_at DESC
          LIMIT ?
        `;

        client.all(sql, [hexPubkey, limit], (err, rows) => {
          if (err) {
            console.error('Failed to get followers:', err);
            reject(err);
          } else {
            const followers = rows.map(row => ({
              pubkey: row.follower_pubkey,
              npub: row.follower_npub,
              relay: row.relay,
              petname: row.petname,
              created_at: row.created_at,
              profile: row.name ? {
                name: row.name,
                display_name: row.display_name,
                picture: row.picture,
                nip05: row.nip05
              } : null
            }));
            resolve(followers);
          }
        });
      } catch (error) {
        console.error('Failed to get followers:', error);
        reject(error);
      }
    });
  }

  /**
   * Get relationship statistics for a user
   */
  async getRelationshipStats(pubkey) {
    const client = this.dbManager.getClient();
    
    return new Promise((resolve, reject) => {
      try {
        const hexPubkey = pubkey.startsWith('npub') ? npubToHex(pubkey) : pubkey;
        
        // Get following count
        client.get('SELECT COUNT(*) as count FROM relationships WHERE follower_pubkey = ?', 
          [hexPubkey], (err, followingRow) => {
          if (err) {
            reject(err);
            return;
          }

          // Get followers count
          client.get('SELECT COUNT(*) as count FROM relationships WHERE following_pubkey = ?', 
            [hexPubkey], (err, followersRow) => {
            if (err) {
              reject(err);
              return;
            }

            // Get last contact update
            client.get(`
              SELECT MAX(created_at) as last_update 
              FROM relationships 
              WHERE follower_pubkey = ? OR following_pubkey = ?
            `, [hexPubkey, hexPubkey], (err, lastUpdateRow) => {
              if (err) {
                reject(err);
                return;
              }

              resolve({
                following_count: followingRow.count,
                followers_count: followersRow.count,
                last_contact_update: lastUpdateRow.last_update
              });
            });
          });
        });
      } catch (error) {
        console.error('Failed to get relationship stats:', error);
        reject(error);
      }
    });
  }

  /**
   * Check if one user follows another
   */
  async isFollowing(followerPubkey, followingPubkey) {
    const client = this.dbManager.getClient();
    
    return new Promise((resolve, reject) => {
      try {
        const followerHex = followerPubkey.startsWith('npub') ? npubToHex(followerPubkey) : followerPubkey;
        const followingHex = followingPubkey.startsWith('npub') ? npubToHex(followingPubkey) : followingPubkey;
        
        const sql = `
          SELECT COUNT(*) as count 
          FROM relationships 
          WHERE follower_pubkey = ? AND following_pubkey = ?
        `;

        client.get(sql, [followerHex, followingHex], (err, row) => {
          if (err) {
            console.error('Failed to check following status:', err);
            reject(err);
          } else {
            resolve(row.count > 0);
          }
        });
      } catch (error) {
        console.error('Failed to check following status:', error);
        reject(error);
      }
    });
  }
}

module.exports = { LocalRelationshipManager };
