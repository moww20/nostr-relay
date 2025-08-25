const bech32 = require('bech32');
let nip19;
try {
  // Lazy require to avoid hard crash if not present in some environments
  nip19 = require('nostr-tools').nip19;
} catch {}
const crypto = require('crypto');

/**
 * Convert hex public key to npub (bech32) format
 */
function hexToNpub(hexPubkey) {
  try {
    if (!hexPubkey || typeof hexPubkey !== 'string') return '';
    const cleanHex = hexPubkey.replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) return '';
    if (nip19 && typeof nip19.npubEncode === 'function') {
      return nip19.npubEncode(cleanHex);
    }
    const bytes = Buffer.from(cleanHex, 'hex');
    const words = bech32.toWords(bytes);
    const npub = bech32.encode('npub', words);
    return npub || '';
  } catch {
    return '';
  }
}

/**
 * Convert npub (bech32) to hex public key
 */
function npubToHex(npub) {
  try {
    if (!npub || typeof npub !== 'string') return '';
    const token = npub.replace(/^nostr:/i, '');
    if (nip19 && typeof nip19.decode === 'function') {
      try {
        const dec = nip19.decode(token);
        if (dec && dec.type === 'npub') {
          if (typeof dec.data === 'string') return dec.data;
          if (dec.data && (dec.data.length || dec.data.byteLength)) {
            const bytes = Buffer.from(dec.data);
            return bytes.toString('hex');
          }
        }
      } catch {}
    }
    const decoded = bech32.decode(token);
    if (!decoded || decoded.prefix.toLowerCase() !== 'npub') return '';
    const bytes = bech32.fromWords(decoded.words);
    if (!bytes || bytes.length !== 32) return '';
    return Buffer.from(bytes).toString('hex');
  } catch {
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

  const token = pubkey.replace(/^nostr:/i, '');
  if (/^npub/i.test(token)) {
    // Prefer nip19 if available
    if (nip19 && typeof nip19.decode === 'function') {
      try {
        const dec = nip19.decode(token);
        if (dec.type !== 'npub') return false;
        if (typeof dec.data === 'string') return /^[0-9a-fA-F]{64}$/.test(dec.data);
        const bytes = Buffer.from(dec.data);
        return bytes.length === 32;
      } catch { return false; }
    }
    try {
      const dec = bech32.decode(token);
      if (!dec || dec.prefix.toLowerCase() !== 'npub') return false;
      const bytes = bech32.fromWords(dec.words);
      return Array.isArray(bytes) ? bytes.length === 32 : Buffer.from(bytes).length === 32;
    } catch { return false; }
  }

  // Check hex format
  const cleanHex = token.replace(/^0x/, '');
  return /^[0-9a-fA-F]{64}$/.test(cleanHex);
}

/**
 * Normalize public key to hex format
 */
function normalizePubkey(pubkey) {
  if (!pubkey) {
    return '';
  }

  const token = String(pubkey).replace(/^nostr:/i, '');
  if (/^npub/i.test(token)) return npubToHex(token);

  return token.replace(/^0x/, '');
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
  return input.replace(/['";\\]/g, '').trim();
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
