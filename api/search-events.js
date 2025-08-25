const { getClient, ensureSchema } = require('./_db');
const { applyCors } = require('./_cors');

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET,OPTIONS'); return res.status(405).json({ success: false, data: null, error: 'method not allowed' }); }
    await ensureSchema();

    const q = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit||'50'),10)||50));
    const since = parseInt((req.query.since||'0'),10)||0;
    const until = parseInt((req.query.until||'0'),10)||0;

    if (!q && !since && !until) return res.status(400).json({ success: false, data: null, error: 'missing query' });
    const client = getClient();

    // Build FTS query
    // Simple content/tags match; for AND logic use quotes/space; for OR use OR in q
    const where = [];
    const args = [];
    if (q) { where.push('events_fts MATCH ?'); args.push(q); }
    if (since) { where.push('e.created_at >= ?'); args.push(since); }
    if (until) { where.push('e.created_at <= ?'); args.push(until); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    const sql = `
      SELECT e.id, e.kind, e.pubkey, e.created_at, e.content, e.tags_json
      FROM events_fts f
      JOIN events e ON e.rowid = f.rowid
      ${whereSql}
      ORDER BY e.created_at DESC
      LIMIT ?
    `;
    args.push(limit);

    const rows = await client.execute({ sql, args });
    const items = rows.rows.map(r => ({ id: r.id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), content: r.content || '', tags: r.tags_json ? JSON.parse(String(r.tags_json)) : [] }));
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.status(200).json({ success: true, data: { items }, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


