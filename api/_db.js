const { createClient } = require('@libsql/client');

let client;

function getClient() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error('Missing Turso envs');
    client = createClient({ url, authToken });
  }
  return client;
}

module.exports = { getClient };