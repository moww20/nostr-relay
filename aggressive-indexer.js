require('dotenv').config();
const { dbManager } = require('./db');

async function checkCurrentStats() {
  const client = dbManager.getClient();
  const profiles = await client.execute('SELECT COUNT(*) as count FROM profiles');
  const relationships = await client.execute('SELECT COUNT(*) as count FROM relationships');
  const searchIndex = await client.execute('SELECT COUNT(*) as count FROM search_index');
  
  return {
    profiles: profiles.rows[0].count,
    relationships: relationships.rows[0].count,
    searchIndex: searchIndex.rows[0].count
  };
}

async function runAggressiveIndexer() {
  console.log('🚀 Starting AGGRESSIVE NOSTR Indexer...');
  console.log('📊 Collecting ALL metadata from beginning of time...\n');
  
  // Check initial stats
  const initialStats = await checkCurrentStats();
  console.log('📈 Initial Database State:');
  console.log(`  Profiles: ${initialStats.profiles}`);
  console.log(`  Relationships: ${initialStats.relationships}`);
  console.log(`  Search Index: ${initialStats.searchIndex}\n`);
  
  let round = 1;
  const startTime = Date.now();
  
  while (true) {
    console.log(`🔄 Round ${round} - Starting aggressive indexing...`);
    console.log(`⏱️  Total runtime: ${Math.floor((Date.now() - startTime) / 1000)}s\n`);
    
    try {
      // Run the indexer with maximum settings
      const { spawn } = require('child_process');
      const indexer = spawn('node', ['scripts/local-index.js'], {
        stdio: 'pipe',
        env: process.env
      });
      
      indexer.stdout.on('data', (data) => {
        console.log(data.toString().trim());
      });
      
      indexer.stderr.on('data', (data) => {
        console.error(data.toString().trim());
      });
      
      await new Promise((resolve, reject) => {
        indexer.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Indexer exited with code ${code}`));
          }
        });
      });
      
      // Check stats after this round
      const currentStats = await checkCurrentStats();
      const newProfiles = currentStats.profiles - initialStats.profiles;
      const newRelationships = currentStats.relationships - initialStats.relationships;
      
      console.log('\n📊 Round Results:');
      console.log(`  New profiles: +${newProfiles}`);
      console.log(`  New relationships: +${newRelationships}`);
      console.log(`  Total profiles: ${currentStats.profiles}`);
      console.log(`  Total relationships: ${currentStats.relationships}`);
      console.log(`  Total search index: ${currentStats.searchIndex}`);
      
      // Update initial stats for next round
      initialStats.profiles = currentStats.profiles;
      initialStats.relationships = currentStats.relationships;
      initialStats.searchIndex = currentStats.searchIndex;
      
      console.log('\n⏳ Waiting 30 seconds before next round...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      round++;
      
    } catch (error) {
      console.error('❌ Error in indexing round:', error.message);
      console.log('🔄 Retrying in 60 seconds...\n');
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down aggressive indexer...');
  const finalStats = await checkCurrentStats();
  console.log('\n📊 Final Database State:');
  console.log(`  Profiles: ${finalStats.profiles}`);
  console.log(`  Relationships: ${finalStats.relationships}`);
  console.log(`  Search Index: ${finalStats.searchIndex}`);
  process.exit(0);
});

runAggressiveIndexer().catch(console.error);
