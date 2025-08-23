const { getClient } = require('../_db');

module.exports = async function handler(req, res) {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, data: null, error: 'missing id' });

    const client = getClient();
    const rows = await client.execute({
      sql: 'SELECT pubkey, name, display_name, about, picture, banner, website, lud16, nip05, created_at, indexed_at FROM profiles WHERE pubkey = ?1 OR npub = ?1 LIMIT 1',
      args: [id]
    });

    if (!rows.rows.length) return res.status(404).json({ success: false, data: null, error: 'Profile not found' });
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

    res.status(200).json({ success: true, data: profile, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};