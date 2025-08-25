const { getClient, ensureSchema } = require('./_db');
const { applyCors } = require('./_cors');

module.exports = async function handler(req, res) {
  const cors = applyCors(req, res);
  if (cors.ended) return;
  if (!cors.allowed) return res.status(403).json({ success: false, data: null, error: 'forbidden' });
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET,OPTIONS'); return res.status(405).json({ success: false, data: null, error: 'method not allowed' }); }
    await ensureSchema();

    const q = String(req.query.q||'').trim();
    const limit = Math.max(1, Math.min(20, parseInt((req.query.limit||'10'),10)||10));
    if (!q) return res.status(200).json({ success: true, data: { suggestions: [] }, error: null });

    const client = getClient();
    const like = `%${q}%`;

    // Profiles: name/display_name/nip05 matches
    const profRows = await client.execute({ sql: `
      SELECT pubkey, name, display_name, nip05
      FROM profiles
      WHERE name LIKE ?1 OR display_name LIKE ?1 OR nip05 LIKE ?1
      ORDER BY indexed_at DESC
      LIMIT ?2
    `, args: [like, limit] });
    const profiles = profRows.rows.map(r => ({ type: 'profile', pubkey: r.pubkey, name: r.display_name || r.name || '', nip05: r.nip05 || null }));

    // Hashtags: mine from recent events_fts tags field
    const tagRows = await client.execute({ sql: `
      SELECT tags FROM events_fts WHERE tags MATCH ?1 LIMIT 200
    `, args: [q] });
    const tagCounts = new Map();
    for (const r of tagRows.rows) {
      const t = String(r.tags||'');
      const m = t.match(/"t","([^"]+)"/g) || [];
      for (const seg of m) {
        const val = seg.replace(/"t","/,'').replace(/"$/,'');
        if (val && val.toLowerCase().includes(q.toLowerCase())) {
          tagCounts.set(val, (tagCounts.get(val)||0)+1);
        }
      }
    }
    const tags = Array.from(tagCounts.entries()).sort((a,b)=> b[1]-a[1]).slice(0, limit).map(([name]) => ({ type: 'tag', tag: name }));

    // Posts: quick FTS hit
    const postRows = await client.execute({ sql: `
      SELECT e.id, e.pubkey, e.created_at FROM events_fts f JOIN events e ON e.rowid=f.rowid WHERE f.content MATCH ?1 ORDER BY e.created_at DESC LIMIT ?2
    `, args: [q, limit] });
    const posts = postRows.rows.map(r => ({ type: 'post', id: r.id, pubkey: r.pubkey }));

    const suggestions = [...profiles, ...tags, ...posts].slice(0, limit);
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.status(200).json({ success: true, data: { suggestions }, error: null });
  } catch (e) {
    return res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};


