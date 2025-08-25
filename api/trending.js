const { getClient, ensureSchema } = require('./_db');
const { applyCors } = require('./_cors');

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET,OPTIONS'); return res.status(405).json({ success: false, data: null, error: 'method not allowed' }); }
    await ensureSchema();

    const limit = Math.max(1, Math.min(200, parseInt((req.query.limit||'50'),10)||50));
    const cursor = (req.query.cursor||'').toString();

    const client = getClient();

    // Resolve current snapshot
    const state = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['current_trending_snapshot_24h'] });
    const snapshotId = (state.rows[0] && state.rows[0].value) || '';
    if (!snapshotId) return res.status(200).json({ success: true, data: { items: [], cursor: null, snapshot_id: null, window_start: null, window_end: null }, error: null });

    const snap = await client.execute({ sql: 'SELECT id, window_start, window_end, created_at FROM trending_snapshots WHERE id = ?1', args: [snapshotId] });
    const meta = snap.rows[0] || null;
    if (!meta) return res.status(200).json({ success: true, data: { items: [], cursor: null, snapshot_id: null, window_start: null, window_end: null }, error: null });

    // Simple offset cursor: base64(offset)
    let offset = 0;
    try { if (cursor) { const dec = Buffer.from(cursor, 'base64').toString('utf8'); offset = Math.max(0, parseInt(dec,10)||0); } } catch {}

    const rows = await client.execute({
      sql: 'SELECT rank, event_id, pubkey, kind, created_at, score, likes, reposts, replies, zaps FROM trending_items WHERE snapshot_id = ?1 ORDER BY rank ASC LIMIT ?2 OFFSET ?3',
      args: [snapshotId, limit, offset]
    });

    const items = rows.rows.map(r => ({
      id: r.event_id,
      kind: Number(r.kind||0),
      pubkey: r.pubkey,
      created_at: Number(r.created_at||0),
      score: Number(r.score||0),
      counts: { likes: Number(r.likes||0), reposts: Number(r.reposts||0), replies: Number(r.replies||0), zaps: Number(r.zaps||0) }
    }));

    const nextCursor = rows.rows.length === limit ? Buffer.from(String(offset + limit), 'utf8').toString('base64') : null;

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    res.setHeader('ETag', `${snapshotId}:${offset}`);
    return res.status(200).json({ success: true, data: { items, cursor: nextCursor, snapshot_id: meta.id, window_start: Number(meta.window_start), window_end: Number(meta.window_end) }, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


