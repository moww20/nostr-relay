const { getClient, ensureSchema } = require('../_db');
const { applyCors } = require('../_cors');
const { normalizePubkey, hexToNpub } = require('../../db/utils');

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

    const hexId = normalizePubkey(String(id || ''));
    if (!hexId) return res.status(400).json({ success: false, data: null, error: 'invalid id' });
    const npubId = hexToNpub(hexId);

    const client = getClient();
    const rows = await client.execute({
      sql: 'SELECT pubkey, name, display_name, about, picture, banner, website, lud16, nip05, created_at, indexed_at FROM profiles WHERE pubkey = ?1 OR npub = ?2 LIMIT 1',
      args: [hexId, npubId]
    });

    if (!rows.rows.length) {
      return res.status(404).json({ success: false, data: null, error: 'Profile not found' });
    }
    const r = rows.rows[0];
    const profile = {
      pubkey: r.pubkey,
      name: r.name || null,
      display_name: r.display_name || null,
      about: r.about || null,
      picture: r.picture || null,
      banner: r.banner || null,
      website: r.website || null,
      lud16: r.lud16 || null,
      nip05: r.nip05 || null,
      created_at: Number(r.created_at) || 0,
      indexed_at: Number(r.indexed_at) || 0,
      relay_sources: [],
      search_terms: []
    };

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    res.status(200).json({ success: true, data: profile, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};
