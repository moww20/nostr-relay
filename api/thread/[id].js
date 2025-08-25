const { getClient, ensureSchema } = require('../_db');
const { applyCors } = require('../_cors');

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET,OPTIONS'); return res.status(405).json({ success: false, data: null, error: 'method not allowed' }); }
    await ensureSchema();

    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, data: null, error: 'missing id' });
    const eid = String(id||'');

    const client = getClient();
    // Load root
    const rootRows = await client.execute({ sql: 'SELECT id, kind, pubkey, created_at, content, tags_json, deleted FROM events WHERE id = ?1 LIMIT 1', args: [eid] });
    const root = rootRows.rows[0] ? ({ id: rootRows.rows[0].id, kind: Number(rootRows.rows[0].kind||0), pubkey: rootRows.rows[0].pubkey, created_at: Number(rootRows.rows[0].created_at||0), content: rootRows.rows[0].content || '', tags: rootRows.rows[0].tags_json ? JSON.parse(String(rootRows.rows[0].tags_json)) : [], deleted: Number(rootRows.rows[0].deleted||0)===1 }) : null;
    // Load replies by scanning events table content/tags_json for e-tags
    const repliesRows = await client.execute({ sql: `
      SELECT id, kind, pubkey, created_at, content, tags_json, deleted
      FROM events
      WHERE deleted = 0 AND kind = 1 AND (tags_json LIKE ?1)
      ORDER BY created_at ASC
    `, args: [ `%"e","${eid}"%` ] });
    const replies = repliesRows.rows.map(r => ({ id: r.id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), content: r.content || '', tags: r.tags_json ? JSON.parse(String(r.tags_json)) : [], deleted: Number(r.deleted||0)===1 }));

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    return res.status(200).json({ success: true, data: { root, replies }, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


