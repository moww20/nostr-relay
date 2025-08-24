const { getClient, ensureSchema } = require('../_db');
const { npubToHex } = require('../../db/utils');

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, data: null, error: 'missing id' });

    const candidate = id.toString();
    const hexId = candidate.startsWith('npub') ? npubToHex(candidate) || '' : candidate;
    if (!hexId) return res.status(400).json({ success: false, data: null, error: 'invalid id' });

    const client = getClient();
    const following = await client.execute({
      sql: 'SELECT COUNT(*) AS c FROM relationships WHERE follower_pubkey = ?1',
      args: [hexId]
    });
    const followers = await client.execute({
      sql: 'SELECT COUNT(*) AS c FROM relationships WHERE following_pubkey = ?1',
      args: [hexId]
    });
    const data = {
      pubkey: hexId,
      following_count: (following.rows[0] && Number(following.rows[0].c)) || 0,
      followers_count: (followers.rows[0] && Number(followers.rows[0].c)) || 0,
      last_contact_update: null
    };
    res.status(200).json({ success: true, data, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};
