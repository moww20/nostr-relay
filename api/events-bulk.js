const { getClient, ensureSchema } = require('./_db');
const { applyCors } = require('./_cors');

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET,OPTIONS'); return res.status(405).json({ success: false, data: null, error: 'method not allowed' }); }
    await ensureSchema();

    const idsParam = (req.query.ids || '').toString();
    const idList = Array.isArray(req.query.id) ? req.query.id : (req.query.id ? [String(req.query.id)] : []);
    const raw = idsParam || idList.join(',');
    if (!raw) return res.status(400).json({ success: false, data: null, error: 'missing ids' });
    const ids = Array.from(new Set(raw.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean))).slice(0, 500);
    if (ids.length === 0) return res.status(400).json({ success: false, data: null, error: 'no valid ids' });

    const client = getClient();
    const placeholders = ids.map((_,i)=>`?${i+1}`).join(',');
    const rows = await client.execute({ sql: `SELECT id, kind, pubkey, created_at, content, tags_json, deleted FROM events WHERE id IN (${placeholders})`, args: ids });
    const items = rows.rows.map(r => ({ id: r.id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), content: r.content || '', tags: r.tags_json ? JSON.parse(String(r.tags_json)) : [], deleted: Number(r.deleted||0)===1 }));
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    return res.status(200).json({ success: true, data: { items }, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


