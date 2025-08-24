const bech32 = require('bech32');
const crypto = require('crypto');

/**
 * Convert hex public key to npub (bech32) format
 */
function hexToNpub(hexPubkey) {
  try {
    if (!hexPubkey || typeof hexPubkey !== 'string') {
      return '';
    }
    
    // Remove any prefix if present
    const cleanHex = hexPubkey.replace(/^0x/, '');
    
    // Validate hex string
    if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
      console.warn('Invalid hex pubkey format:', hexPubkey);
      return '';
    }
    
    const bytes = Buffer.from(cleanHex, 'hex');
    const words = bech32.toWords(bytes);
    const npub = bech32.encode('npub', words);
    
    return npub || '';
  } catch (error) {
    console.error('Error converting hex to npub:', error);
    return '';
  }
}

/**
 * Convert npub (bech32) to hex public key
 */
function npubToHex(npub) {
  try {
    if (!npub || typeof npub !== 'string') {
      return '';
    }
    
    const decoded = bech32.decode(npub);
    if (!decoded || decoded.prefix !== 'npub') {
      console.warn('Invalid npub format:', npub);
      return '';
    }
    
    const bytes = bech32.fromWords(decoded.words);
    const hex = Buffer.from(bytes).toString('hex');
    
    return hex || '';
  } catch (error) {
    console.error('Error converting npub to hex:', error);
    return '';
  }
}

/**
 * Validate public key format (hex or npub)
 */
function isValidPubkey(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') {
    return false;
  }
  
  if (pubkey.startsWith('npub')) {
    try {
      const decoded = bech32.decode(pubkey);
      return decoded && decoded.prefix === 'npub' && decoded.words.length === 32;
    } catch {
      return false;
    }
  }
  
  // Check hex format
  const cleanHex = pubkey.replace(/^0x/, '');
  return /^[0-9a-fA-F]{64}$/.test(cleanHex);
}

/**
 * Normalize public key to hex format
 */
function normalizePubkey(pubkey) {
  if (!pubkey) {
    return '';
  }
  
  if (pubkey.startsWith('npub')) {
    return npubToHex(pubkey);
  }
  
  return pubkey.replace(/^0x/, '');
}

/**
 * Generate a unique ID for database operations
 */
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Sanitize SQL input to prevent injection
 */
function sanitizeSqlInput(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Remove potentially dangerous characters
  return input
    .replace(/['";\\]/g, '')
    .trim();
}

/**
 * Build pagination parameters
 */
function buildPagination(page = 0, perPage = 20) {
  const offset = Math.max(0, page) * Math.max(1, Math.min(100, perPage));
  const limit = Math.max(1, Math.min(100, perPage));
  
  return { offset, limit };
}

/**
 * Format timestamp for database storage
 */
function formatTimestamp(timestamp) {
  if (typeof timestamp === 'number') {
    return Math.floor(timestamp / 1000); // Convert to seconds if in milliseconds
  }
  
  if (timestamp instanceof Date) {
    return Math.floor(timestamp.getTime() / 1000);
  }
  
  return Math.floor(Date.now() / 1000);
}

/**
 * Parse timestamp from database
 */
function parseTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }
  
  return new Date(timestamp * 1000); // Convert from seconds to milliseconds
}

/**
 * Build search query with proper escaping
 */
function buildSearchQuery(terms, fields = ['name', 'display_name', 'about']) {
  if (!Array.isArray(terms) || terms.length === 0) {
    return { sql: '', args: [] };
  }
  
  const conditions = [];
  const args = [];
  
  for (const term of terms) {
    const escapedTerm = `%${sanitizeSqlInput(term)}%`;
    
    for (const field of fields) {
      conditions.push(`${field} LIKE ?`);
      args.push(escapedTerm);
    }
  }
  
  const sql = conditions.length > 0 ? `(${conditions.join(' OR ')})` : '';
  
  return { sql, args };
}

/**
 * Validate and clean profile data
 */
function validateProfile(profile) {
  const cleaned = {};
  
  // Required fields
  if (!profile.pubkey || !isValidPubkey(profile.pubkey)) {
    throw new Error('Invalid pubkey');
  }
  
  cleaned.pubkey = normalizePubkey(profile.pubkey);
  
  // Optional fields with validation
  if (profile.name) {
    cleaned.name = sanitizeSqlInput(profile.name).slice(0, 100);
  }
  
  if (profile.display_name) {
    cleaned.display_name = sanitizeSqlInput(profile.display_name).slice(0, 100);
  }
  
  if (profile.about) {
    cleaned.about = sanitizeSqlInput(profile.about).slice(0, 500);
  }
  
  if (profile.picture) {
    cleaned.picture = sanitizeSqlInput(profile.picture).slice(0, 500);
  }
  
  if (profile.banner) {
    cleaned.banner = sanitizeSqlInput(profile.banner).slice(0, 500);
  }
  
  if (profile.website) {
    cleaned.website = sanitizeSqlInput(profile.website).slice(0, 200);
  }
  
  if (profile.lud16) {
    cleaned.lud16 = sanitizeSqlInput(profile.lud16).slice(0, 100);
  }
  
  if (profile.nip05) {
    cleaned.nip05 = sanitizeSqlInput(profile.nip05).slice(0, 100);
  }
  
  // Timestamps
  cleaned.created_at = formatTimestamp(profile.created_at);
  cleaned.indexed_at = formatTimestamp(profile.indexed_at || Date.now());
  
  return cleaned;
}

/**
 * Validate and clean relationship data
 */
function validateRelationship(relationship) {
  const cleaned = {};
  
  // Required fields
  if (!relationship.follower_pubkey || !isValidPubkey(relationship.follower_pubkey)) {
    throw new Error('Invalid follower pubkey');
  }
  
  if (!relationship.following_pubkey || !isValidPubkey(relationship.following_pubkey)) {
    throw new Error('Invalid following pubkey');
  }
  
  cleaned.follower_pubkey = normalizePubkey(relationship.follower_pubkey);
  cleaned.following_pubkey = normalizePubkey(relationship.following_pubkey);
  
  // Optional fields
  if (relationship.relay) {
    cleaned.relay = sanitizeSqlInput(relationship.relay).slice(0, 200);
  }
  
  if (relationship.petname) {
    cleaned.petname = sanitizeSqlInput(relationship.petname).slice(0, 100);
  }
  
  // Timestamps
  cleaned.created_at = formatTimestamp(relationship.created_at);
  cleaned.indexed_at = formatTimestamp(relationship.indexed_at || Date.now());
  
  return cleaned;
}

/**
 * Create database error with proper formatting
 */
function createDbError(error, operation) {
  return {
    message: `Database ${operation} failed: ${error.message}`,
    code: error.code || 'UNKNOWN',
    operation,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  hexToNpub,
  npubToHex,
  isValidPubkey,
  normalizePubkey,
  generateId,
  sanitizeSqlInput,
  buildPagination,
  formatTimestamp,
  parseTimestamp,
  buildSearchQuery,
  validateProfile,
  validateRelationship,
  createDbError
};
