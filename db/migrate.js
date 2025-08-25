#!/usr/bin/env node

require('dotenv').config();
const { dbManager } = require('./index');

async function runMigrations() {
  try {
    console.log('🚀 Starting database migrations...');

    // Initialize database
    await dbManager.init();

    console.log('✅ Database migrations completed successfully!');

    // Get schema info
    const schemaInfo = await dbManager.migrations.getSchemaInfo();
    console.log('\n📊 Database Schema:');
    Object.keys(schemaInfo).forEach((table) => {
      console.log(`  - ${table}: ${schemaInfo[table].length} columns`);
    });

    // Get initial stats
    const stats = await dbManager.getStats();
    console.log('\n📈 Database Statistics:');
    console.log(`  - Total profiles: ${stats.total_profiles}`);
    console.log(`  - Total relationships: ${stats.total_relationships}`);
    console.log(`  - Total posts: ${stats.total_posts}`);
    console.log(`  - Search index size: ${stats.search_index_size}`);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

async function resetDatabase() {
  try {
    console.log('⚠️  Resetting database...');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise((resolve) => {
      rl.question(
        'Are you sure you want to reset the database? This will delete ALL data! (yes/no): ',
        resolve
      );
    });

    rl.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Database reset cancelled.');
      return;
    }

    await dbManager.migrations.resetDatabase();
    console.log('✅ Database reset completed!');
  } catch (error) {
    console.error('❌ Database reset failed:', error.message);
    process.exit(1);
  }
}

async function showStats() {
  try {
    console.log('📊 Database Statistics:');

    const stats = await dbManager.getStats();
    console.log(`  - Total profiles: ${stats.total_profiles}`);
    console.log(`  - Total relationships: ${stats.total_relationships}`);
    console.log(`  - Total posts: ${stats.total_posts}`);
    console.log(`  - Search index size: ${stats.search_index_size}`);
    console.log(`  - Last updated: ${stats.last_updated}`);

    // Get profile stats
    const profileStats = await dbManager.profiles.getProfileStats();
    console.log('\n👥 Profile Statistics:');
    console.log(`  - Profiles with pictures: ${profileStats.profiles_with_pictures}`);
    console.log(`  - Profiles with banners: ${profileStats.profiles_with_banners}`);
    console.log(`  - Profiles with NIP-05: ${profileStats.profiles_with_nip05}`);

    // Get relationship stats
    const relationshipStats = await dbManager.relationships.getRelationshipStats();
    console.log('\n🔗 Relationship Statistics:');
    console.log(`  - Total relationships: ${relationshipStats.total_relationships}`);
    console.log(`  - Unique followers: ${relationshipStats.unique_followers}`);
    console.log(`  - Unique following: ${relationshipStats.unique_following}`);

    // Get search stats
    const searchStats = await dbManager.search.getSearchStats();
    console.log('\n🔍 Search Statistics:');
    console.log(`  - Unique search terms: ${searchStats.total_unique_terms}`);
    console.log(`  - Total index entries: ${searchStats.total_index_entries}`);
    console.log(`  - Avg terms per profile: ${searchStats.avg_terms_per_profile}`);
  } catch (error) {
    console.error('❌ Failed to get statistics:', error.message);
    process.exit(1);
  }
}

async function healthCheck() {
  try {
    console.log('🏥 Database Health Check:');

    const health = await dbManager.healthCheck();
    if (health.success) {
      console.log('✅ Database connection: HEALTHY');
    } else {
      console.log('❌ Database connection: UNHEALTHY');
      console.log(`   Error: ${health.message}`);
    }
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const command = process.argv[2];

switch (command) {
  case 'migrate':
  case undefined:
    runMigrations();
    break;
  case 'reset':
    resetDatabase();
    break;
  case 'stats':
    showStats();
    break;
  case 'health':
    healthCheck();
    break;
  default:
    console.log(`
Usage: node migrate.js [command]

Commands:
  migrate  Run database migrations (default)
  reset    Reset database (delete all data)
  stats    Show database statistics
  health   Check database health

Examples:
  node migrate.js
  node migrate.js stats
  node migrate.js health
    `);
    process.exit(1);
}
