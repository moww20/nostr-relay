#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@libsql/client');

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function nowSec() { return Math.floor(Date.now()/1000); }

function toSnapshotId(tsSec) { return `snap-${tsSec}`; }

function safeParseTags(tagsJson) {
  try {
    const arr = JSON.parse(tagsJson || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function extractReferencedEventIds(tags) {
  const ids = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (Array.isArray(tag) && tag.length >= 2 && tag[0] === 'e' && typeof tag[1] === 'string' && tag[1]) {
      const relay = tag[2] || null;
      const marker = tag[3] || null; // can be 'reply','root','mention','q','quote', etc
      ids.push({ id: tag[1], marker, relay });
    }
  }
  return ids;
}

async function main() {
  const TURSO_DATABASE_URL = env('TURSO_DATABASE_URL');
  const TURSO_AUTH_TOKEN = env('TURSO_AUTH_TOKEN');
  const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

  const windowEnd = parseInt(process.env.WINDOW_END || String(nowSec()), 10);
  const windowStart = windowEnd - 24*3600;
  const snapshotId = toSnapshotId(windowEnd);

  console.log('🔍 Computing trending candidates from Turso events...');
  console.log(`⏰ Window: ${new Date(windowStart * 1000).toISOString()} to ${new Date(windowEnd * 1000).toISOString()}`);

  // Candidates: original notes only (kind 1)
  const candidatesQuery = `
    SELECT 
      e.id, e.kind, e.pubkey, e.created_at
    FROM events e
    WHERE e.created_at >= ? AND e.created_at <= ?
    AND e.kind = 1
    ORDER BY e.created_at DESC
    LIMIT 2000
  `;

  const candRes = await client.execute({ sql: candidatesQuery, args: [windowStart, windowEnd] });
  console.log(`📊 Found ${candRes.rows.length} candidate notes in time window`);

  if (candRes.rows.length === 0) {
    console.log('No candidate notes found in time window. Exiting.');
    return;
  }

  const candidateIds = candRes.rows.map(r => r.id);
  const candidateSet = new Set(candidateIds);

  // Load engagement source events within window: replies (kind 1 with reply marker), reposts (kind 6), reactions (kind 7), zaps (9735), and quote-reposts (kind 1 with marker q/quote)
  const engagementRes = await client.execute({
    sql: `SELECT id, kind, pubkey, created_at, content, tags_json FROM events WHERE created_at >= ? AND created_at <= ? AND kind IN (1,6,7,9735)`,
    args: [windowStart, windowEnd]
  });

  const likes = new Map();
  const reposts = new Map();
  const replies = new Map();
  const zaps = new Map();

  function inc(map, id) { map.set(id, (map.get(id) || 0) + 1); }

  for (const ev of engagementRes.rows) {
    const kind = Number(ev.kind || 0);
    const tags = safeParseTags(ev.tags_json);
    const refs = extractReferencedEventIds(tags);
    if (refs.length === 0) continue;

    for (const ref of refs) {
      const targetId = ref.id;
      if (!candidateSet.has(targetId)) continue; // Only count engagement for candidate notes
      if (kind === 7) {
        inc(likes, targetId);
      } else if (kind === 6) {
        inc(reposts, targetId);
      } else if (kind === 9735) {
        inc(zaps, targetId);
      } else if (kind === 1) {
        const marker = typeof ref.marker === 'string' ? ref.marker.toLowerCase() : '';
        if (marker === 'reply') {
          inc(replies, targetId);
        } else if (marker === 'q' || marker === 'quote') {
          // Treat quote-reposts as reposts engagement
          inc(reposts, targetId);
        }
      }
    }
  }

  // Convert to candidates with aggregated counts
  const candidates = candRes.rows.map(row => ({
    id: row.id,
    kind: 1,
    pubkey: row.pubkey,
    created_at: Number(row.created_at || 0),
    counts: {
      likes: likes.get(row.id) || 0,
      reposts: reposts.get(row.id) || 0,
      replies: replies.get(row.id) || 0,
      zaps: zaps.get(row.id) || 0
    }
  }));

  // Compute scores
  const scored = scoreCandidates(candidates);
  
  // Sort and take top N
  const TOP_N = Math.min(scored.length, parseInt(process.env.TOP_N || '200', 10));
  const top = scored.sort((a,b) => b.score - a.score).slice(0, TOP_N);

  console.log(`🏆 Top ${top.length} trending items computed`);

  try {
    // Upsert engagement_counts (newer-wins via updated_at)
    for (const ev of top) {
      await client.execute({
        sql: `INSERT INTO engagement_counts(event_id, likes, reposts, replies, zaps, updated_at)
          VALUES (?1,?2,?3,?4,?5,?6)
          ON CONFLICT(event_id) DO UPDATE SET
            likes=excluded.likes,
            reposts=excluded.reposts,
            replies=excluded.replies,
            zaps=excluded.zaps,
            updated_at=excluded.updated_at
        `,
        args: [ev.id, ev.counts.likes, ev.counts.reposts, ev.counts.replies, ev.counts.zaps, windowEnd]
      });
    }

    // Insert snapshot
    await client.execute({
      sql: 'INSERT OR REPLACE INTO trending_snapshots(id, window_start, window_end, created_at) VALUES (?1,?2,?3,?4)',
      args: [snapshotId, windowStart, windowEnd, nowSec()]
    });

    // Insert trending_items
    let rank = 1;
    for (const ev of top) {
      await client.execute({
        sql: `INSERT OR REPLACE INTO trending_items(
          snapshot_id, rank, event_id, pubkey, kind, created_at, score, likes, reposts, replies, zaps
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
        args: [snapshotId, rank++, ev.id, ev.pubkey, ev.kind, ev.created_at, ev.score, ev.counts.likes, ev.counts.reposts, ev.counts.replies, ev.counts.zaps]
      });
    }

    // Point current snapshot
    await client.execute({ 
      sql: 'INSERT OR REPLACE INTO indexer_state(key, value) VALUES (?1,?2)', 
      args: ['current_trending_snapshot_24h', snapshotId] 
    });

    // Optional cleanup: delete snapshots older than 48h
    const cutoff = windowEnd - 48*3600;
    await client.execute({ sql: 'DELETE FROM trending_snapshots WHERE window_end < ?1', args: [cutoff] });
    await client.execute({ sql: 'DELETE FROM trending_items WHERE snapshot_id NOT IN (SELECT id FROM trending_snapshots)', args: [] });

    console.log(`✅ Pushed trending snapshot ${snapshotId} with ${top.length} items`);
    
    // Show top 5 items
    console.log('\n🏆 Top 5 trending items:');
    top.slice(0, 5).forEach((item, i) => {
      console.log(`${i+1}. Event ${item.id.slice(0,8)}... (score: ${item.score.toFixed(2)})`);
      console.log(`   Likes: ${item.counts.likes}, Reposts: ${item.counts.reposts}, Replies: ${item.counts.replies}, Zaps: ${item.counts.zaps}`);
    });

  } catch (e) {
    console.error('❌ Push failed:', e);
    process.exit(1);
  }
}

function scoreCandidates(arr) {
  const now = nowSec();
  const rawVals = arr.map(ev => {
    const c = ev.counts || { likes:0, reposts:0, replies:0, zaps:0 };
    return c.likes + 2*c.reposts + 1.5*c.replies + (c.zaps>0 ? 3*c.zaps : 0);
  });
  const min = Math.min(...rawVals, 0);
  const max = Math.max(...rawVals, 1);
  
  return arr.map(ev => {
    const c = ev.counts || { likes:0, reposts:0, replies:0, zaps:0 };
    const hours = Math.max(1, (now - (ev.created_at||now)) / 3600);
    const recency = 1 / (1 + hours);
    const raw = c.likes + 2*c.reposts + 1.5*c.replies + (c.zaps>0 ? 3*c.zaps : 0);
    const engagement = (raw - min) / Math.max(1e-6, (max - min));
    let score = 0.5*recency + 0.5*engagement;
    return { ...ev, score };
  });
}

if (require.main === module) {
  main().catch(console.error);
}
