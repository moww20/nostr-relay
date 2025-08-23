const { getClient, ensureSchema } = require('./_db');

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();
    const client = getClient();
    const profiles = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM profiles', args: [] });
    const relationships = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM relationships', args: [] });
    const data = {
      total_profiles: (profiles.rows[0] && Number(profiles.rows[0].c)) || 0,
      total_relationships: (relationships.rows[0] && Number(relationships.rows[0].c)) || 0,
      relays_indexed: 0,
      last_indexed: null,
      search_index_size: 0
    };
    res.status(200).json({ success: true, data, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};