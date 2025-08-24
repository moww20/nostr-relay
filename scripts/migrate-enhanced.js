#!/usr/bin/env node

require('dotenv').config();
const { localDbManager } = require('../db/local-index');

async function migrateToEnhanced() {
  try {
    console.log('🔄 Migrating database to enhanced schema...\n');
    
    // Initialize database connection
    await localDbManager.ensureSchema();
    const client = localDbManager.getClient();
    
    console.log('📋 Checking current schema...');
    
    // Check if location column exists
    const tableInfo = await new Promise((resolve, reject) => {
      client.all("PRAGMA table_info(profiles)", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    const hasLocation = tableInfo.some(col => col.name === 'location');
    const hasProfileStats = tableInfo.some(col => col.name === 'profile_stats');
    
    console.log(`📍 Location column exists: ${hasLocation}`);
    console.log(`📊 Profile stats table exists: ${hasProfileStats}`);
    
    // Add location column if it doesn't exist
    if (!hasLocation) {
      console.log('➕ Adding location column to profiles table...');
      await new Promise((resolve, reject) => {
        client.run("ALTER TABLE profiles ADD COLUMN location TEXT", (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log('✅ Location column added successfully');
    }
    
    // Check if profile_stats table exists
    const tables = await new Promise((resolve, reject) => {
      client.all("SELECT name FROM sqlite_master WHERE type='table' AND name='profile_stats'", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    if (tables.length === 0) {
      console.log('➕ Creating profile_stats table...');
      await new Promise((resolve, reject) => {
        client.run(`
          CREATE TABLE profile_stats (
            pubkey TEXT PRIMARY KEY,
            followers_count INTEGER DEFAULT 0,
            following_count INTEGER DEFAULT 0,
            last_updated INTEGER NOT NULL
          )
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log('✅ Profile stats table created successfully');
    }
    
    // Create new indexes
    console.log('🔍 Creating enhanced indexes...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles(location)',
      'CREATE INDEX IF NOT EXISTS idx_profiles_website ON profiles(website)',
      'CREATE INDEX IF NOT EXISTS idx_profiles_lud16 ON profiles(lud16)',
      'CREATE INDEX IF NOT EXISTS idx_profile_stats_followers ON profile_stats(followers_count)',
      'CREATE INDEX IF NOT EXISTS idx_profile_stats_following ON profile_stats(following_count)',
      'CREATE INDEX IF NOT EXISTS idx_profile_stats_updated ON profile_stats(last_updated)'
    ];
    
    for (const index of indexes) {
      try {
        await new Promise((resolve, reject) => {
          client.run(index, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (error) {
        console.warn(`⚠️  Warning: ${error.message}`);
      }
    }
    
    console.log('✅ Enhanced indexes created');
    
    // Update existing profiles with follower/following counts
    console.log('📊 Updating profile statistics...');
    const profiles = await new Promise((resolve, reject) => {
      client.all("SELECT pubkey FROM profiles", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    let updatedCount = 0;
    for (const profile of profiles) {
      try {
        await localDbManager.migrations.updateProfileStats(profile.pubkey);
        updatedCount++;
      } catch (error) {
        console.warn(`⚠️  Warning updating stats for ${profile.pubkey}: ${error.message}`);
      }
    }
    
    console.log(`✅ Updated statistics for ${updatedCount} profiles`);
    
    // Get final stats
    const stats = await localDbManager.getStats();
    console.log('\n📈 Migration completed successfully!');
    console.log('📊 Final Database Stats:');
    console.log(`  Profiles: ${stats.total_profiles}`);
    console.log(`  Relationships: ${stats.total_relationships}`);
    console.log(`  Search Index: ${stats.search_index_size}`);
    
    await localDbManager.close();
    console.log('\n🎉 Database migration completed!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateToEnhanced();
