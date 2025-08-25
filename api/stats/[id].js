const { getClient, ensureSchema } = require('../_db');
const { normalizePubkey } = require('../../db/utils');
const { applyCors } = require('../_cors');

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET,OPTIONS');
      return res.status(405).json({ success: false, data: null, error: 'method not allowed' });
    }
    await ensureSchema();
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, data: null, error: 'missing id' });

    const hexId = normalizePubkey(String(id||''));
    if (!hexId) return res.status(400).json({ success: false, data: null, error: 'invalid id' });

    const client = getClient();
    const following = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM relationships WHERE follower_pubkey = ?1', args: [hexId] });
    const followers = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM relationships WHERE following_pubkey = ?1', args: [hexId] });
    const data = {
      pubkey: hexId,
      following_count: (following.rows[0] && Number(following.rows[0].c)) || 0,
      followers_count: (followers.rows[0] && Number(followers.rows[0].c)) || 0,
      last_contact_update: null
    };
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    res.status(200).json({ success: true, data, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};
