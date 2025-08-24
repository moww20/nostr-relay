const { dbManager } = require('../db');

let ready;

/**
 * Legacy database interface for backward compatibility
 */
async function ensureSchema() {
  if (!ready) {
    ready = dbManager.ensureSchema();
  }
  return ready;
}

function getClient() {
  return dbManager.getClient();
}

/**
 * Legacy profile operations
 */
async function getProfile(pubkey) {
  await ensureSchema();
  return dbManager.profiles.getProfile(pubkey);
}

async function searchProfiles(query, page = 0, perPage = 20) {
  await ensureSchema();
  return dbManager.profiles.searchProfiles(query, page, perPage);
}

async function upsertProfile(profile) {
  await ensureSchema();
  return dbManager.profiles.upsertProfile(profile);
}

/**
 * Legacy relationship operations
 */
async function getFollowing(pubkey, limit = 100) {
  await ensureSchema();
  return dbManager.relationships.getFollowing(pubkey, limit);
}

async function getFollowers(pubkey, limit = 100) {
  await ensureSchema();
  return dbManager.relationships.getFollowers(pubkey, limit);
}

async function getRelationshipStats(pubkey) {
  await ensureSchema();
  return dbManager.relationships.getRelationshipStats(pubkey);
}

async function upsertRelationship(relationship) {
  await ensureSchema();
  return dbManager.relationships.upsertRelationship(relationship);
}

/**
 * Legacy search operations
 */
async function searchProfilesAdvanced(query, options = {}) {
  await ensureSchema();
  return dbManager.search.searchProfiles(query, options);
}

async function getSearchSuggestions(query, limit = 10) {
  await ensureSchema();
  return dbManager.search.getSearchSuggestions(query, limit);
}

/**
 * Database statistics
 */
async function getStats() {
  await ensureSchema();
  return dbManager.getStats();
}

async function healthCheck() {
  await ensureSchema();
  return dbManager.healthCheck();
}

module.exports = {
  getClient,
  ensureSchema,
  // Profile operations
  getProfile,
  searchProfiles,
  upsertProfile,
  // Relationship operations
  getFollowing,
  getFollowers,
  getRelationshipStats,
  upsertRelationship,
  // Search operations
  searchProfilesAdvanced,
  getSearchSuggestions,
  // Database operations
  getStats,
  healthCheck,
  // Export the new dbManager for direct access
  dbManager
};
