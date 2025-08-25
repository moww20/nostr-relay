const { getClient, ensureSchema } = require('./_db');
const { applyCors } = require('./_cors');

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET,OPTIONS'); return res.status(405).json({ success: false, data: null, error: 'method not allowed' }); }
    await ensureSchema();
    const raw = (req.query.ids||'').toString();
    if (!raw) return res.status(400).json({ success: false, data: null, error: 'missing ids' });
    const ids = Array.from(new Set(raw.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean))).slice(0, 500);
    if (ids.length === 0) return res.status(400).json({ success: false, data: null, error: 'no valid ids' });

    const client = getClient();
    const placeholders = ids.map((_,i)=>`?${i+1}`).join(',');
    const rows = await client.execute({ sql: `SELECT event_id, likes, reposts, replies, zaps, updated_at FROM engagement_counts WHERE event_id IN (${placeholders})`, args: ids });
    const map = {};
    for (const r of rows.rows) {
      map[r.event_id] = { likes: Number(r.likes||0), reposts: Number(r.reposts||0), replies: Number(r.replies||0), zaps: Number(r.zaps||0), updated_at: Number(r.updated_at||0) };
    }
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    return res.status(200).json({ success: true, data: map, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


