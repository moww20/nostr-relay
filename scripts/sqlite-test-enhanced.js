#!/usr/bin/env node

require('dotenv').config();
const { localDbManager } = require('../db/local-index');
const { EnhancedProfileManager } = require('../db/enhanced-profile-manager');

async function testEnhancedFunctionality() {
  try {
    console.log('🧪 Testing Enhanced NOSTR Indexer Functionality...\n');

    // Initialize database connection
    await localDbManager.ensureSchema();

    // Test enhanced profile manager
    const enhancedProfileManager = new EnhancedProfileManager(localDbManager);

    // Test profile with all metadata fields
    const testProfile = {
      pubkey: 'test123456789abcdef',
      name: 'Test User',
      display_name: 'Test Display Name',
      about: 'This is a test profile with enhanced metadata',
      picture: 'https://example.com/picture.jpg',
      banner: 'https://example.com/banner.jpg',
      website: 'https://example.com',
      lud16: 'test@example.com',
      nip05: 'test@example.com',
      location: 'Test City, Test Country',
      created_at: Math.floor(Date.now() / 1000),
      indexed_at: Math.floor(Date.now() / 1000)
    };

    console.log('📝 Testing enhanced profile upsert...');
    await enhancedProfileManager.upsertProfile(testProfile);
    console.log('✅ Profile upsert successful');

    console.log('\n🔍 Testing enhanced profile retrieval...');
    const retrievedProfile = await enhancedProfileManager.getCompleteProfile(testProfile.pubkey);
    console.log('✅ Profile retrieval successful');
    console.log('📋 Retrieved profile data:');
    console.log(`  Name: ${retrievedProfile.name}`);
    console.log(`  Display Name: ${retrievedProfile.display_name}`);
    console.log(`  About: ${retrievedProfile.about}`);
    console.log(`  Picture: ${retrievedProfile.picture}`);
    console.log(`  Banner: ${retrievedProfile.banner}`);
    console.log(`  Website: ${retrievedProfile.website}`);
    console.log(`  Bitcoin Wallet: ${retrievedProfile.lud16}`);
    console.log(`  NIP-05: ${retrievedProfile.nip05}`);
    console.log(`  Location: ${retrievedProfile.location}`);
    console.log(`  Followers: ${retrievedProfile.followers_count}`);
    console.log(`  Following: ${retrievedProfile.following_count}`);

    console.log('\n🔍 Testing enhanced search...');
    const searchResults = await enhancedProfileManager.searchProfiles('test', 1, 5);
    console.log(`✅ Search successful - found ${searchResults.length} results`);

    console.log('\n📈 Testing trending profiles...');
    const trendingProfiles = await enhancedProfileManager.getTrendingProfiles(5);
    console.log(`✅ Trending profiles successful - found ${trendingProfiles.length} results`);

    console.log('\n📊 Testing database statistics...');
    const stats = await localDbManager.getStats();
    console.log('✅ Database stats:');
    console.log(`  Total Profiles: ${stats.total_profiles}`);
    console.log(`  Total Relationships: ${stats.total_relationships}`);
    console.log(`  Search Index Size: ${stats.search_index_size}`);

    console.log('\n🎉 All enhanced functionality tests passed!');

    await localDbManager.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testEnhancedFunctionality();
