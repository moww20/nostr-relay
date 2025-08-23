const { createClient } = require('@libsql/client');

let client;
let ready;

function getClient() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error('Missing Turso envs');
    client = createClient({ url, authToken });
  }
  return client;
}

async function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const c = getClient();
      await c.execute(`CREATE TABLE IF NOT EXISTS profiles (
        pubkey TEXT PRIMARY KEY,
        npub TEXT NOT NULL,
        name TEXT,
        display_name TEXT,
        about TEXT,
        picture TEXT,
        banner TEXT,
        website TEXT,
        lud16 TEXT,
        nip05 TEXT,
        created_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        search_vector TEXT
      )`);
      await c.execute(`CREATE TABLE IF NOT EXISTS relationships (
        follower_pubkey TEXT NOT NULL,
        following_pubkey TEXT NOT NULL,
        follower_npub TEXT NOT NULL,
        following_npub TEXT NOT NULL,
        relay TEXT,
        petname TEXT,
        created_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        PRIMARY KEY (follower_pubkey, following_pubkey)
      )`);
      await c.execute(`CREATE TABLE IF NOT EXISTS search_index (
        term TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        field_type TEXT NOT NULL,
        PRIMARY KEY (term, pubkey, field_type)
      )`);
      return true;
    })();
  }
  return ready;
}

module.exports = { getClient, ensureSchema };