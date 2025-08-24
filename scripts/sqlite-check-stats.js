#!/usr/bin/env node

require('dotenv').config();
const { localDbManager } = require('../db/local-index');

async function checkStats() {
  try {
    console.log('📊 Checking NOSTR Indexer Statistics...\n');

    // Initialize database connection
    await localDbManager.ensureSchema();

    // Get database statistics
    const stats = await localDbManager.getStats();

    console.log('📈 Current Database Statistics:');
    console.log(`  📝 Total Profiles: ${stats.total_profiles.toLocaleString()}`);
    console.log(`  🔗 Total Relationships: ${stats.total_relationships.toLocaleString()}`);
    console.log(`  🔍 Search Index Entries: ${stats.search_index_size.toLocaleString()}`);
    console.log(`  ⏰ Last Updated: ${stats.last_updated}`);

    // Get some sample profiles
    const client = localDbManager.getClient();

    console.log('\n📋 Sample Profiles:');
    client.all(
      `
      SELECT name, display_name, about, nip05, indexed_at 
      FROM profiles 
      WHERE name IS NOT NULL OR display_name IS NOT NULL
      ORDER BY indexed_at DESC 
      LIMIT 5
    `,
      (err, rows) => {
        if (err) {
          console.error('Error fetching sample profiles:', err);
        } else {
          rows.forEach((row, index) => {
            const name = row.display_name || row.name || 'Anonymous';
            const about = row.about
              ? row.about.length > 50
                ? row.about.substring(0, 50) + '...'
                : row.about
              : '';
            const nip05 = row.nip05 || 'No NIP-05';
            const date = new Date(row.indexed_at * 1000).toLocaleString();

            console.log(`  ${index + 1}. ${name}`);
            console.log(`     About: ${about}`);
            console.log(`     NIP-05: ${nip05}`);
            console.log(`     Indexed: ${date}`);
            console.log('');
          });
        }

        // Close database connection
        localDbManager.close().then(() => {
          console.log('✅ Statistics check completed!');
          process.exit(0);
        });
      }
    );
  } catch (error) {
    console.error('❌ Error checking statistics:', error);
    process.exit(1);
  }
}

checkStats();
