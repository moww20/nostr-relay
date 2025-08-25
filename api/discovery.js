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
    const state = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['current_discovery_snapshot'] });
    const snapshotId = (state.rows[0] && state.rows[0].value) || '';
    if (!snapshotId) return res.status(200).json({ success: true, data: { items: [], cursor: null, snapshot_id: null }, error: null });

    let offset = 0;
    try { if (cursor) { const dec = Buffer.from(cursor, 'base64').toString('utf8'); offset = Math.max(0, parseInt(dec,10)||0); } } catch {}

    const meta = await client.execute({ sql: 'SELECT id, created_at FROM discovery_snapshots WHERE id = ?1', args: [snapshotId] });
    if (!meta.rows[0]) return res.status(200).json({ success: true, data: { items: [], cursor: null, snapshot_id: null }, error: null });

    const rows = await client.execute({
      sql: 'SELECT rank, event_id, pubkey, kind, created_at, score, reasons_json FROM discovery_items WHERE snapshot_id = ?1 ORDER BY rank ASC LIMIT ?2 OFFSET ?3',
      args: [snapshotId, limit, offset]
    });
    const items = rows.rows.map(r => ({ id: r.event_id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), score: Number(r.score||0), reasons: r.reasons_json ? JSON.parse(String(r.reasons_json)) : undefined }));
    const nextCursor = rows.rows.length === limit ? Buffer.from(String(offset + limit), 'utf8').toString('base64') : null;

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    res.setHeader('ETag', `${snapshotId}:${offset}`);
    return res.status(200).json({ success: true, data: { items, cursor: nextCursor, snapshot_id: snapshotId }, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


