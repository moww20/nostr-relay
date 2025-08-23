const { getClient, ensureSchema } = require('../_db');

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();
    const { id } = req.query;
    const limit = Math.min(1000, parseInt((req.query.limit || '100').toString(), 10) || 100);
    if (!id) return res.status(400).json({ success: false, data: null, error: 'missing id' });

    const client = getClient();
    const rows = await client.execute({
      sql: 'SELECT follower_pubkey, following_pubkey, relay, petname, created_at, indexed_at FROM relationships WHERE following_pubkey = ?1 ORDER BY created_at DESC LIMIT ?2',
      args: [id, limit]
    });

    const list = rows.rows.map(r => ({
      follower_pubkey: r.follower_pubkey,
      following_pubkey: r.following_pubkey,
      relay: r.relay || null,
      petname: r.petname || null,
      created_at: Number(r.created_at) || 0,
      indexed_at: Number(r.indexed_at) || 0
    }));
    res.status(200).json({ success: true, data: list, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};