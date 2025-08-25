const { getClient, ensureSchema } = require('../_db');
const { applyCors } = require('../_cors');
const { normalizePubkey, hexToNpub } = require('../../db/utils');

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    if (req.method !== 'GET') return res.status(405).json({ success: false, data: null, error: 'method not allowed' });
    await ensureSchema();

    const raw = (req.query.ids || '').toString();
    if (!raw) return res.status(400).json({ success: false, data: null, error: 'missing ids' });

    const tokens = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const normalized = Array.from(new Set(tokens.map((t) => normalizePubkey(t)).filter(Boolean)));
    if (normalized.length === 0) return res.status(400).json({ success: false, data: null, error: 'no valid ids' });
    const MAX = 500;
    if (normalized.length > MAX) return res.status(429).json({ success: false, data: null, error: `too many ids (max ${MAX})` });

    const client = getClient();
    const placeholders = normalized.map((_, i) => `?${i + 1}`).join(',');
    const sql = `SELECT pubkey, name, display_name, about, picture, banner, website, lud16, nip05, created_at, indexed_at FROM profiles WHERE pubkey IN (${placeholders})`;
    const rows = await client.execute({ sql, args: normalized });

    const byPk = new Map();
    for (const r of rows.rows) {
      byPk.set(r.pubkey, {
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
        npub: hexToNpub(r.pubkey) || null
      });
    }

    const profiles = normalized.map((pk) => byPk.get(pk)).filter(Boolean);
    const notFound = normalized.filter((pk) => !byPk.has(pk));

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    return res.status(200).json({ success: true, data: { profiles, not_found: notFound, total: profiles.length }, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


