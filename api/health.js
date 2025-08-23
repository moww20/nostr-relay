const { createClient } = require('@libsql/client');

module.exports = async function handler(req, res) {
  try {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (url && authToken) {
      const client = createClient({ url, authToken });
      await client.execute('SELECT 1');
    }
    res.status(200).json({ success: true, data: 'OK', error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};