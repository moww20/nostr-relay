const { getClient } = require('./_db');

module.exports = async function handler(req, res) {
  try {
    const q = (req.query.q || '').toString();
    const page = parseInt((req.query.page || '0').toString(), 10) || 0;
    const perPage = Math.min(100, parseInt((req.query.per_page || '20').toString(), 10) || 20);

    const terms = q.split(/\s+/).map(s => s.trim().toLowerCase()).filter(w => w.length > 2);
    if (!terms.length) return res.status(200).json({ success: true, data: { profiles: [], total_count: 0, page, per_page: perPage }, error: null });

    const where = terms.map(() => '(si.term LIKE ? OR p.search_vector LIKE ?)').join(' OR ');
    const whereArgs = terms.flatMap(t => [`%${t}%`, `%${t}%`]);

    const client = getClient();
    const countSql = `SELECT COUNT(DISTINCT p.pubkey) AS c FROM profiles p JOIN search_index si ON p.pubkey = si.pubkey WHERE ${where}`;
    const count = await client.execute({ sql: countSql, args: whereArgs });
    const total = (count.rows[0] && Number(count.rows[0].c)) || 0;

    const listSql = `SELECT DISTINCT p.pubkey, p.name, p.display_name, p.about, p.picture, p.banner, p.website, p.lud16, p.nip05, p.created_at, p.indexed_at FROM profiles p JOIN search_index si ON p.pubkey = si.pubkey WHERE ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    const listArgs = [...whereArgs, perPage, page * perPage];
    const rows = await client.execute({ sql: listSql, args: listArgs });

    const profiles = rows.rows.map(r => ({
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
      relay_sources: [],
      search_terms: []
    }));

    res.status(200).json({ success: true, data: { profiles, total_count: total, page, per_page: perPage }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};