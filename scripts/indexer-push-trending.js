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

async function main() {
	const TURSO_DATABASE_URL = env('TURSO_DATABASE_URL');
	const TURSO_AUTH_TOKEN = env('TURSO_AUTH_TOKEN');
	const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

	const windowEnd = parseInt(process.env.WINDOW_END || String(nowSec()), 10);
	const windowStart = windowEnd - 24*3600;
	const snapshotId = toSnapshotId(windowEnd);

	// TODO: replace this with your local indexer source of truth.
	// For now, we assume you load candidates and counts from a local file or service.
	// Provide data in the form:
	// candidates = [{ id, kind, pubkey, created_at, counts: { likes, reposts, replies, zaps } }]
	const candidates = await loadLocalTrendingCandidates(windowStart, windowEnd);
	if (!Array.isArray(candidates) || candidates.length === 0) {
		console.log('No candidates to push. Exiting.');
		return;
	}

	// Compute scores
	const scored = scoreCandidates(candidates);
	// Sort and take top N
	const TOP_N = Math.min(scored.length, parseInt(process.env.TOP_N || '200', 10));
	const top = scored.sort((a,b)=> b.score - a.score).slice(0, TOP_N);

	await client.execute('BEGIN');
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
		await client.execute({ sql: 'INSERT OR REPLACE INTO indexer_state(key, value) VALUES (?1,?2)', args: ['current_trending_snapshot_24h', snapshotId] });

		// Optional cleanup: delete snapshots older than 48h
		const cutoff = windowEnd - 48*3600;
		await client.execute({ sql: 'DELETE FROM trending_snapshots WHERE window_end < ?1', args: [cutoff] });
		await client.execute({ sql: 'DELETE FROM trending_items WHERE snapshot_id NOT IN (SELECT id FROM trending_snapshots)', args: [] });

		await client.execute('COMMIT');
		console.log(`Pushed trending snapshot ${snapshotId} with ${top.length} items.`);
	} catch (e) {
		await client.execute('ROLLBACK');
		console.error('Push failed:', e);
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
		let score = 0.6*recency + 0.4*engagement;
		if (ev.kind === 6) score *= 0.7;
		return { ...ev, score };
	});
}

async function loadLocalTrendingCandidates(_windowStart, _windowEnd) {
	// Placeholder: replace with your local indexer source (SQLite or files)
	// Return minimal mock if no source available
	if (process.env.MOCK_TRENDING === '1') {
		const base = nowSec() - 3600;
		return [
			{ id: 'evt1', kind: 1, pubkey: 'deadbeef', created_at: base, counts: { likes: 10, reposts: 3, replies: 2, zaps: 1 } },
			{ id: 'evt2', kind: 1, pubkey: 'cafebabe', created_at: base - 1200, counts: { likes: 8, reposts: 5, replies: 1, zaps: 0 } }
		];
	}
	throw new Error('loadLocalTrendingCandidates not implemented. Provide local source.');
}

main().catch(e=>{ console.error(e); process.exit(1); });
