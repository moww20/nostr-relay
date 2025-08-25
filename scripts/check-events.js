#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@libsql/client');

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const TURSO_DATABASE_URL = env('TURSO_DATABASE_URL');
  const TURSO_AUTH_TOKEN = env('TURSO_AUTH_TOKEN');
  const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

  console.log('🔍 Checking event kinds in Turso...');
  
  // Check event kinds
  const kinds = await client.execute({ 
    sql: 'SELECT kind, COUNT(*) as count FROM events GROUP BY kind ORDER BY count DESC' 
  });
  
  console.log('\n📊 Event kinds in Turso:');
  kinds.rows.forEach(row => {
    console.log(`Kind ${row.kind}: ${row.count} events`);
  });

  // Check for specific kinds you mentioned
  const specificKinds = [1, 6, 7, 9735];
  console.log('\n🎯 Checking specific kinds:');
  for (const kind of specificKinds) {
    const result = await client.execute({ 
      sql: 'SELECT COUNT(*) as count FROM events WHERE kind = ?', 
      args: [kind] 
    });
    console.log(`Kind ${kind}: ${result.rows[0].count} events`);
  }

  // Check what tables exist
  console.log('\n🗂️ Tables in Turso:');
  const tables = await client.execute({ 
    sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" 
  });
  
  tables.rows.forEach(row => {
    console.log(`- ${row.name}`);
  });

  // Check if we have engagement-related tables
  console.log('\n💬 Engagement tables:');
  const engagementTables = ['engagement_counts', 'trending_snapshots', 'trending_items', 'discovery_snapshots', 'discovery_items'];
  for (const table of engagementTables) {
    try {
      const result = await client.execute({ 
        sql: `SELECT COUNT(*) as count FROM ${table}` 
      });
      console.log(`${table}: ${result.rows[0].count} rows`);
    } catch (e) {
      console.log(`${table}: Does not exist`);
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}
