const { getClient, ensureSchema } = require('./_db');
const { applyCors } = require('./_cors');
const { normalizePubkey, hexToNpub } = require('../db/utils');

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

// Minimal handlers for legacy endpoints to avoid extra serverless functions
async function handleSearchProfiles(req, res) {
  await ensureSchema();
  const q = (req.query.q || '').toString();
  const rawPage = parseInt((req.query.page || '0').toString(), 10) || 0;
  const page = Math.max(0, rawPage - 1);
  const perPage = Math.min(100, parseInt((req.query.per_page || '20').toString(), 10) || 20);
  const terms = q.split(/\s+/).map((s) => s.trim().toLowerCase()).filter((w) => w.length > 2);
  if (!terms.length) { return res.status(200).json({ success: true, data: { profiles: [], total_count: 0, page, per_page: perPage }, error: null }); }
  const where = terms.map(() => '(si.term LIKE ? OR p.search_vector LIKE ?)').join(' OR ');
  const whereArgs = terms.flatMap((t) => [`%${t}%`, `%${t}%`]);
  const client = getClient();
  const countSql = `SELECT COUNT(DISTINCT p.pubkey) AS c FROM profiles p JOIN search_index si ON p.pubkey = si.pubkey WHERE ${where}`;
  const count = await client.execute({ sql: countSql, args: whereArgs });
  const total = (count.rows[0] && Number(count.rows[0].c)) || 0;
  const listSql = `SELECT DISTINCT p.pubkey, p.name, p.display_name, p.about, p.picture, p.banner, p.website, p.lud16, p.nip05, p.created_at, p.indexed_at FROM profiles p JOIN search_index si ON p.pubkey = si.pubkey WHERE ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
  const listArgs = [...whereArgs, perPage, page * perPage];
  const rows = await client.execute({ sql: listSql, args: listArgs });
  const profiles = rows.rows.map((r) => ({ pubkey: r.pubkey, name: r.name || null, display_name: r.display_name || null, about: r.about || null, picture: r.picture || null, banner: r.banner || null, website: r.website || null, lud16: r.lud16 || null, nip05: r.nip05 || null, created_at: Number(r.created_at) || 0, indexed_at: Number(r.indexed_at) || 0, relay_sources: [], search_terms: [] }));
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: { profiles, total_count: total, page: page + 1, per_page: perPage }, error: null });
}

async function handleProfileBulk(req, res) {
  await ensureSchema();
  const idsParam = (req.query.ids || '').toString();
  const idList = Array.isArray(req.query.id) ? req.query.id : (req.query.id ? [String(req.query.id)] : []);
  const raw = idsParam || idList.join(',');
  if (!raw) return res.status(400).json({ success: false, data: null, error: 'missing ids' });
  const tokens = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const normalized = Array.from(new Set(tokens.map((t) => normalizePubkey(t)).filter(Boolean))).slice(0, 500);
  const client = getClient();
  const placeholders = normalized.map((_, i) => `?${i + 1}`).join(',');
  const rows = await client.execute({ sql: `SELECT pubkey, name, display_name, about, picture, banner, website, lud16, nip05, created_at, indexed_at FROM profiles WHERE pubkey IN (${placeholders})`, args: normalized });
  const items = rows.rows.map((r) => ({ pubkey: r.pubkey, name: r.name || null, display_name: r.display_name || null, about: r.about || null, picture: r.picture || null, banner: r.banner || null, website: r.website || null, lud16: r.lud16 || null, nip05: r.nip05 || null, created_at: Number(r.created_at) || 0, indexed_at: Number(r.indexed_at) || 0, npub: hexToNpub(r.pubkey) || null }));
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: { profiles: items }, error: null });
}

async function handleProfileById(req, res, id) {
  await ensureSchema();
  const hexId = normalizePubkey(String(id||''));
  if (!hexId) return res.status(400).json({ success: false, data: null, error: 'invalid id' });
  const client = getClient();
  const rows = await client.execute({ sql: 'SELECT pubkey, name, display_name, about, picture, banner, website, lud16, nip05, created_at, indexed_at FROM profiles WHERE pubkey = ?1 LIMIT 1', args: [hexId] });
  if (!rows.rows.length) return res.status(404).json({ success: false, data: null, error: 'Profile not found' });
  const r = rows.rows[0];
  const profile = { pubkey: r.pubkey, name: r.name || null, display_name: r.display_name || null, about: r.about || null, picture: r.picture || null, banner: r.banner || null, website: r.website || null, lud16: r.lud16 || null, nip05: r.nip05 || null, created_at: Number(r.created_at) || 0, indexed_at: Number(r.indexed_at) || 0 };
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: profile, error: null });
}

async function handleFollowing(req, res, id) {
  await ensureSchema();
  const hexId = normalizePubkey(String(id||''));
  if (!hexId) return res.status(400).json({ success: false, data: null, error: 'invalid id' });
  const limit = Math.max(1, Math.min(1000, parseInt((req.query.limit||'100'), 10) || 100));
  const client = getClient();
  const rows = await client.execute({ sql: 'SELECT follower_pubkey, following_pubkey, relay, petname, created_at, indexed_at FROM relationships WHERE follower_pubkey = ?1 ORDER BY created_at DESC LIMIT ?2', args: [hexId, limit] });
  const list = rows.rows.map((r) => ({ follower_pubkey: r.follower_pubkey, following_pubkey: r.following_pubkey, relay: r.relay || null, petname: r.petname || null, created_at: Number(r.created_at)||0, indexed_at: Number(r.indexed_at)||0 }));
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: list, error: null });
}

async function handleFollowers(req, res, id) {
  await ensureSchema();
  const hexId = normalizePubkey(String(id||''));
  if (!hexId) return res.status(400).json({ success: false, data: null, error: 'invalid id' });
  const limit = Math.max(1, Math.min(1000, parseInt((req.query.limit||'100'), 10) || 100));
  const client = getClient();
  const rows = await client.execute({ sql: 'SELECT follower_pubkey, following_pubkey, relay, petname, created_at, indexed_at FROM relationships WHERE following_pubkey = ?1 ORDER BY created_at DESC LIMIT ?2', args: [hexId, limit] });
  const list = rows.rows.map((r) => ({ follower_pubkey: r.follower_pubkey, following_pubkey: r.following_pubkey, relay: r.relay || null, petname: r.petname || null, created_at: Number(r.created_at)||0, indexed_at: Number(r.indexed_at)||0 }));
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data: list, error: null });
}

async function handleUserStats(req, res, id) {
  await ensureSchema();
  const hexId = normalizePubkey(String(id||''));
  if (!hexId) return res.status(400).json({ success: false, data: null, error: 'invalid id' });
  const client = getClient();
  const following = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM relationships WHERE follower_pubkey = ?1', args: [hexId] });
  const followers = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM relationships WHERE following_pubkey = ?1', args: [hexId] });
  const data = { pubkey: hexId, following_count: (following.rows[0] && Number(following.rows[0].c)) || 0, followers_count: (followers.rows[0] && Number(followers.rows[0].c)) || 0, last_contact_update: null };
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data, error: null });
}

async function handleIndexerStats(req, res) {
  await ensureSchema();
  const client = getClient();
  const profiles = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM profiles', args: [] });
  const relationships = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM relationships', args: [] });
  const searchIndex = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM search_index', args: [] });
  let lastIndexed = null; let relaysIndexed = 0;
  try {
    const last = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['last_indexed'] });
    const rels = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['relays_indexed_last_run'] });
    lastIndexed = (last.rows[0] && Number(last.rows[0].value)) || null;
    relaysIndexed = (rels.rows[0] && Number(rels.rows[0].value)) || 0;
  } catch {}
  const data = {
    total_profiles: (profiles.rows[0] && Number(profiles.rows[0].c)) || 0,
    total_relationships: (relationships.rows[0] && Number(relationships.rows[0].c)) || 0,
    relays_indexed: relaysIndexed,
    last_indexed: lastIndexed,
    search_index_size: (searchIndex.rows[0] && Number(searchIndex.rows[0].c)) || 0
  };
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  return res.status(200).json({ success: true, data, error: null });
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
    if (path === '/api/health') { res.setHeader('Cache-Control','public, max-age=30'); return res.status(200).json({ success: true, data: 'OK', error: null }); }
    if (path === '/api/search') return handleSearchProfiles(req, res);
    if (path === '/api/profile/bulk' || path === '/api/profiles') return handleProfileBulk(req, res);
    if (path.startsWith('/api/profile/')) { const id = decodeURIComponent(path.replace('/api/profile/','')); return handleProfileById(req, res, id); }
    if (path.startsWith('/api/following/')) { const id = decodeURIComponent(path.replace('/api/following/','')); return handleFollowing(req, res, id); }
    if (path.startsWith('/api/followers/')) { const id = decodeURIComponent(path.replace('/api/followers/','')); return handleFollowers(req, res, id); }
    if (path.startsWith('/api/stats/')) { const id = decodeURIComponent(path.replace('/api/stats/','')); return handleUserStats(req, res, id); }
    if (path === '/api/indexer-stats') return handleIndexerStats(req, res);
    if (path === '/api/indexer-cron') { return res.status(200).json({ success: true, data: { skipped: true }, error: null }); }
    return res.status(404).json({ success: false, data: null, error: 'not found' });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


