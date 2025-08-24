#!/usr/bin/env node

require('dotenv').config();
const express = require('express');
const { localDbManager } = require('../db/local-index');
const { EnhancedProfileManager } = require('../db/enhanced-profile-manager');
const { LocalRelationshipManager } = require('../db/local-relationship-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize enhanced managers
const enhancedProfileManager = new EnhancedProfileManager(localDbManager);
const relationshipManager = new LocalRelationshipManager(localDbManager);

app.use(express.json());
app.use(express.static('public'));

// Enable CORS for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await localDbManager.ensureSchema();
    const health = await localDbManager.healthCheck();
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get complete profile with all metadata
app.get('/api/profile/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params;
    await localDbManager.ensureSchema();
    
    const profile = await enhancedProfileManager.getCompleteProfile(pubkey);
    
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }
    
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search profiles with enhanced search
app.get('/api/search', async (req, res) => {
  try {
    const { q, page = 1, per_page = 20 } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Search query is required' });
    }
    
    await localDbManager.ensureSchema();
    
    const profiles = await enhancedProfileManager.searchProfiles(q.trim(), parseInt(page), parseInt(per_page));
    
    res.json({
      success: true,
      data: {
        profiles,
        query: q,
        page: parseInt(page),
        per_page: parseInt(per_page),
        total_count: profiles.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trending profiles (by follower count)
app.get('/api/trending', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    await localDbManager.ensureSchema();
    
    const profiles = await enhancedProfileManager.getTrendingProfiles(parseInt(limit));
    
    res.json({ success: true, data: profiles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get followers list
app.get('/api/profile/:pubkey/followers', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { limit = 100 } = req.query;
    
    await localDbManager.ensureSchema();
    
    const followers = await relationshipManager.getFollowers(pubkey, parseInt(limit));
    
    res.json({ success: true, data: followers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get following list
app.get('/api/profile/:pubkey/following', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { limit = 100 } = req.query;
    
    await localDbManager.ensureSchema();
    
    const following = await relationshipManager.getFollowing(pubkey, parseInt(limit));
    
    res.json({ success: true, data: following });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get relationship stats
app.get('/api/profile/:pubkey/stats', async (req, res) => {
  try {
    const { pubkey } = req.params;
    
    await localDbManager.ensureSchema();
    
    const stats = await relationshipManager.getRelationshipStats(pubkey);
    
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get database statistics
app.get('/api/stats', async (req, res) => {
  try {
    await localDbManager.ensureSchema();
    
    const stats = await localDbManager.getStats();
    
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search by specific field (for advanced search)
app.get('/api/search/field', async (req, res) => {
  try {
    const { field, value, page = 1, per_page = 20 } = req.query;
    
    if (!field || !value) {
      return res.status(400).json({ success: false, error: 'Field and value are required' });
    }
    
    await localDbManager.ensureSchema();
    
    const client = localDbManager.getClient();
    const offset = (parseInt(page) - 1) * parseInt(per_page);
    const searchTerm = `%${value}%`;
    
    const sql = `
      SELECT p.pubkey, p.npub, p.name, p.display_name, p.about, p.picture, p.banner, 
             p.website, p.lud16, p.nip05, p.location, p.created_at, p.indexed_at,
             COALESCE(ps.followers_count, 0) as followers_count,
             COALESCE(ps.following_count, 0) as following_count
      FROM profiles p
      LEFT JOIN profile_stats ps ON p.pubkey = ps.pubkey
      WHERE p.${field} LIKE ?
      ORDER BY p.indexed_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const profiles = await new Promise((resolve, reject) => {
      client.all(sql, [searchTerm, parseInt(per_page), offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({
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
        })));
      });
    });
    
    res.json({
      success: true,
      data: {
        profiles,
        field,
        value,
        page: parseInt(page),
        per_page: parseInt(per_page),
        total_count: profiles.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, async () => {
  try {
    await localDbManager.ensureSchema();
    console.log(`🚀 Fast Query API running on http://localhost:${PORT}`);
    console.log(`📊 Database initialized successfully`);
    console.log(`🔍 Available endpoints:`);
    console.log(`  GET /api/health - Health check`);
    console.log(`  GET /api/profile/:pubkey - Get complete profile`);
    console.log(`  GET /api/search?q=query - Search profiles`);
    console.log(`  GET /api/trending - Get trending profiles`);
    console.log(`  GET /api/profile/:pubkey/followers - Get followers`);
    console.log(`  GET /api/profile/:pubkey/following - Get following`);
    console.log(`  GET /api/profile/:pubkey/stats - Get relationship stats`);
    console.log(`  GET /api/stats - Get database stats`);
    console.log(`  GET /api/search/field?field=name&value=query - Search by specific field`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Fast Query API...');
  await localDbManager.close();
  process.exit(0);
});
