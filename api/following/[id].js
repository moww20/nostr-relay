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
    const rawLimit = parseInt((req.query.limit || '100').toString(), 10);
    const limit = Math.max(1, Math.min(1000, Number.isFinite(rawLimit) ? rawLimit : 100));
    if (!id) {
      return res.status(400).json({ success: false, data: null, error: 'missing id' });
    }

    const hexId = normalizePubkey(String(id||''));
    if (!hexId) {
      return res.status(400).json({ success: false, data: null, error: 'invalid id' });
    }

    const client = getClient();
    const rows = await client.execute({
      sql: 'SELECT follower_pubkey, following_pubkey, relay, petname, created_at, indexed_at FROM relationships WHERE follower_pubkey = ?1 ORDER BY created_at DESC LIMIT ?2',
      args: [hexId, limit]
    });

    const list = rows.rows.map((r) => ({
      follower_pubkey: r.follower_pubkey,
      following_pubkey: r.following_pubkey,
      relay: r.relay || null,
      petname: r.petname || null,
      created_at: Number(r.created_at) || 0,
      indexed_at: Number(r.indexed_at) || 0
    }));
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    res.status(200).json({ success: true, data: list, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};
