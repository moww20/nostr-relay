const { getClient, ensureSchema } = require('./_db');

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();
    const client = getClient();
    const profiles = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM profiles', args: [] });
    const relationships = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM relationships', args: [] });
    const searchIndex = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM search_index', args: [] });

    // read indexer_state
    let lastIndexed = null;
    let relaysIndexed = 0;
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
    res.status(200).json({ success: true, data, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};