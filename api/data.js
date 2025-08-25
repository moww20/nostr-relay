const { getClient, ensureSchema } = require('./_db');
const { applyCors } = require('./_cors');

async function handleTrending(req, res) {
  await ensureSchema();
  const limit = Math.max(1, Math.min(200, parseInt((req.query.limit||'50'),10)||50));
  const cursor = (req.query.cursor||'').toString();
  const client = getClient();
  const state = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['current_trending_snapshot_24h'] });
  const snapshotId = (state.rows[0] && state.rows[0].value) || '';
  if (!snapshotId) return res.status(200).json({ success: true, data: { items: [], cursor: null, snapshot_id: null, window_start: null, window_end: null }, error: null });
  const snap = await client.execute({ sql: 'SELECT id, window_start, window_end, created_at FROM trending_snapshots WHERE id = ?1', args: [snapshotId] });
  const meta = snap.rows[0] || null;
  if (!meta) return res.status(200).json({ success: true, data: { items: [], cursor: null, snapshot_id: null, window_start: null, window_end: null }, error: null });
  let offset = 0; try { if (cursor) { const dec = Buffer.from(cursor, 'base64').toString('utf8'); offset = Math.max(0, parseInt(dec,10)||0); } } catch {}
  const rows = await client.execute({ sql: 'SELECT rank, event_id, pubkey, kind, created_at, score, likes, reposts, replies, zaps FROM trending_items WHERE snapshot_id = ?1 ORDER BY rank ASC LIMIT ?2 OFFSET ?3', args: [snapshotId, limit, offset] });
  const items = rows.rows.map(r => ({ id: r.event_id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), score: Number(r.score||0), counts: { likes: Number(r.likes||0), reposts: Number(r.reposts||0), replies: Number(r.replies||0), zaps: Number(r.zaps||0) } }));
  const nextCursor = rows.rows.length === limit ? Buffer.from(String(offset + limit), 'utf8').toString('base64') : null;
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  res.setHeader('ETag', `${snapshotId}:${offset}`);
  return res.status(200).json({ success: true, data: { items, cursor: nextCursor, snapshot_id: meta.id, window_start: Number(meta.window_start), window_end: Number(meta.window_end) }, error: null });
}

async function handleEngagement(req, res) {
  await ensureSchema();
  const raw = (req.query.ids||'').toString();
  if (!raw) return res.status(400).json({ success: false, data: null, error: 'missing ids' });
  const ids = Array.from(new Set(raw.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean))).slice(0, 500);
  if (ids.length === 0) return res.status(400).json({ success: false, data: null, error: 'no valid ids' });
  const client = getClient();
  const placeholders = ids.map((_,i)=>`?${i+1}`).join(',');
  const rows = await client.execute({ sql: `SELECT event_id, likes, reposts, replies, zaps, updated_at FROM engagement_counts WHERE event_id IN (${placeholders})`, args: ids });
  const map = {}; for (const r of rows.rows) { map[r.event_id] = { likes: Number(r.likes||0), reposts: Number(r.reposts||0), replies: Number(r.replies||0), zaps: Number(r.zaps||0), updated_at: Number(r.updated_at||0) }; }
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: map, error: null });
}

async function handleSearchEvents(req, res) {
  await ensureSchema();
  const q = String(req.query.q || '').trim();
  const limit = Math.max(1, Math.min(100, parseInt((req.query.limit||'50'),10)||50));
  const since = parseInt((req.query.since||'0'),10)||0;
  const until = parseInt((req.query.until||'0'),10)||0;
  if (!q && !since && !until) return res.status(400).json({ success: false, data: null, error: 'missing query' });
  const client = getClient();
  const where = []; const args = [];
  if (q) { where.push('events_fts MATCH ?'); args.push(q); }
  if (since) { where.push('e.created_at >= ?'); args.push(since); }
  if (until) { where.push('e.created_at <= ?'); args.push(until); }
  const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
  const sql = `SELECT e.id, e.kind, e.pubkey, e.created_at, e.content, e.tags_json FROM events_fts f JOIN events e ON e.rowid = f.rowid ${whereSql} ORDER BY e.created_at DESC LIMIT ?`;
  args.push(limit);
  const rows = await client.execute({ sql, args });
  const items = rows.rows.map(r => ({ id: r.id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), content: r.content || '', tags: r.tags_json ? JSON.parse(String(r.tags_json)) : [] }));
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: { items }, error: null });
}

async function handleDiscovery(req, res) {
  await ensureSchema();
  const limit = Math.max(1, Math.min(200, parseInt((req.query.limit||'50'),10)||50));
  const cursor = (req.query.cursor||'').toString();
  const client = getClient();
  const state = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['current_discovery_snapshot'] });
  const snapshotId = (state.rows[0] && state.rows[0].value) || '';
  if (!snapshotId) return res.status(200).json({ success: true, data: { items: [], cursor: null, snapshot_id: null }, error: null });
  let offset = 0; try { if (cursor) { const dec = Buffer.from(cursor, 'base64').toString('utf8'); offset = Math.max(0, parseInt(dec,10)||0); } } catch {}
  const meta = await client.execute({ sql: 'SELECT id, created_at FROM discovery_snapshots WHERE id = ?1', args: [snapshotId] });
  if (!meta.rows[0]) return res.status(200).json({ success: true, data: { items: [], cursor: null, snapshot_id: null }, error: null });
  const rows = await client.execute({ sql: 'SELECT rank, event_id, pubkey, kind, created_at, score, reasons_json FROM discovery_items WHERE snapshot_id = ?1 ORDER BY rank ASC LIMIT ?2 OFFSET ?3', args: [snapshotId, limit, offset] });
  const items = rows.rows.map(r => ({ id: r.event_id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), score: Number(r.score||0), reasons: r.reasons_json ? JSON.parse(String(r.reasons_json)) : undefined }));
  const nextCursor = rows.rows.length === limit ? Buffer.from(String(offset + limit), 'utf8').toString('base64') : null;
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  res.setHeader('ETag', `${snapshotId}:${offset}`);
  return res.status(200).json({ success: true, data: { items, cursor: nextCursor, snapshot_id: snapshotId }, error: null });
}

async function handleEventsBulk(req, res) {
  await ensureSchema();
  const idsParam = (req.query.ids || '').toString();
  const idList = Array.isArray(req.query.id) ? req.query.id : (req.query.id ? [String(req.query.id)] : []);
  const raw = idsParam || idList.join(','); if (!raw) return res.status(400).json({ success: false, data: null, error: 'missing ids' });
  const ids = Array.from(new Set(raw.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean))).slice(0, 500);
  if (ids.length === 0) return res.status(400).json({ success: false, data: null, error: 'no valid ids' });
  const client = getClient();
  const placeholders = ids.map((_,i)=>`?${i+1}`).join(',');
  const rows = await client.execute({ sql: `SELECT id, kind, pubkey, created_at, content, tags_json, deleted FROM events WHERE id IN (${placeholders})`, args: ids });
  const items = rows.rows.map(r => ({ id: r.id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), content: r.content || '', tags: r.tags_json ? JSON.parse(String(r.tags_json)) : [], deleted: Number(r.deleted||0)===1 }));
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: { items }, error: null });
}

async function handleThread(req, res, id) {
  await ensureSchema();
  const eid = String(id||''); if (!eid) return res.status(400).json({ success: false, data: null, error: 'missing id' });
  const client = getClient();
  const rootRows = await client.execute({ sql: 'SELECT id, kind, pubkey, created_at, content, tags_json, deleted FROM events WHERE id = ?1 LIMIT 1', args: [eid] });
  const root = rootRows.rows[0] ? ({ id: rootRows.rows[0].id, kind: Number(rootRows.rows[0].kind||0), pubkey: rootRows.rows[0].pubkey, created_at: Number(rootRows.rows[0].created_at||0), content: rootRows.rows[0].content || '', tags: rootRows.rows[0].tags_json ? JSON.parse(String(rootRows.rows[0].tags_json)) : [], deleted: Number(rootRows.rows[0].deleted||0)===1 }) : null;
  const repliesRows = await client.execute({ sql: `SELECT id, kind, pubkey, created_at, content, tags_json, deleted FROM events WHERE deleted = 0 AND kind = 1 AND (tags_json LIKE ?1) ORDER BY created_at ASC`, args: [ `%"e","${eid}"%` ] });
  const replies = repliesRows.rows.map(r => ({ id: r.id, kind: Number(r.kind||0), pubkey: r.pubkey, created_at: Number(r.created_at||0), content: r.content || '', tags: r.tags_json ? JSON.parse(String(r.tags_json)) : [], deleted: Number(r.deleted||0)===1 }));
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: { root, replies }, error: null });
}

async function handleSuggest(req, res) {
  await ensureSchema();
  const q = String(req.query.q||'').trim();
  const limit = Math.max(1, Math.min(20, parseInt((req.query.limit||'10'),10)||10));
  if (!q) return res.status(200).json({ success: true, data: { suggestions: [] }, error: null });
  const client = getClient();
  const like = `%${q}%`;
  const profRows = await client.execute({ sql: `SELECT pubkey, name, display_name, nip05 FROM profiles WHERE name LIKE ?1 OR display_name LIKE ?1 OR nip05 LIKE ?1 ORDER BY indexed_at DESC LIMIT ?2`, args: [like, limit] });
  const profiles = profRows.rows.map(r => ({ type: 'profile', pubkey: r.pubkey, name: r.display_name || r.name || '', nip05: r.nip05 || null }));
  const tagRows = await client.execute({ sql: `SELECT tags FROM events_fts WHERE tags MATCH ?1 LIMIT 200`, args: [q] });
  const tagCounts = new Map();
  for (const r of tagRows.rows) { const t = String(r.tags||''); const m = t.match(/"t","([^"]+)"/g) || []; for (const seg of m) { const val = seg.replace(/"t","/,'').replace(/"$/,''); if (val && val.toLowerCase().includes(q.toLowerCase())) tagCounts.set(val, (tagCounts.get(val)||0)+1); } }
  const tags = Array.from(tagCounts.entries()).sort((a,b)=> b[1]-a[1]).slice(0, limit).map(([name]) => ({ type: 'tag', tag: name }));
  const postRows = await client.execute({ sql: `SELECT e.id, e.pubkey, e.created_at FROM events_fts f JOIN events e ON e.rowid=f.rowid WHERE f.content MATCH ?1 ORDER BY e.created_at DESC LIMIT ?2`, args: [q, limit] });
  const posts = postRows.rows.map(r => ({ type: 'post', id: r.id, pubkey: r.pubkey }));
  const suggestions = [...profiles, ...tags, ...posts].slice(0, limit);
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: { suggestions }, error: null });
}

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    // Normalize queries for handlers
    req.query = Object.fromEntries(url.searchParams.entries());
    if (path === '/api/trending') return handleTrending(req, res);
    if (path === '/api/engagement') return handleEngagement(req, res);
    if (path === '/api/search/events') return handleSearchEvents(req, res);
    if (path === '/api/discovery') return handleDiscovery(req, res);
    if (path === '/api/events/bulk') return handleEventsBulk(req, res);
    if (path.startsWith('/api/thread/')) {
      const id = decodeURIComponent(path.replace('/api/thread/',''));
      return handleThread(req, res, id);
    }
    if (path === '/api/search/suggest') return handleSuggest(req, res);
    return res.status(404).json({ success: false, data: null, error: 'not found' });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


