#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@libsql/client');

function env(name, optional = false, defVal = undefined) {
	const v = process.env[name];
	if (!v) {
		if (optional) return defVal;
		throw new Error(`Missing env ${name}`);
	}
	return v;
}

function nowSec() { return Math.floor(Date.now()/1000); }
function toSnapId(prefix, ts) { return `${prefix}-${ts}`; }

async function main() {
	// Flags
	const argv = process.argv.slice(2);
	const flagSet = new Set(argv);
	const verbose = flagSet.has('--verbose') || process.env.VERBOSE === '1';
	const computeOnly = flagSet.has('--compute-only') || process.env.COMPUTE_ONLY === '1';
	const upsertEvents = flagSet.has('--upsert-events') || process.env.UPSERT_EVENTS === '1';

	const url = env('TURSO_DATABASE_URL');
	const token = env('TURSO_AUTH_TOKEN');
	const client = createClient({ url, authToken: token });

	const windowEnd = parseInt(env('WINDOW_END', true, String(nowSec())), 10);
	const windowStart = windowEnd - 24*3600;
	const topN = Math.min(500, Math.max(1, parseInt(env('TOP_N', true, '200'), 10)));

	if (verbose) console.log(`[compute] windowStart=${windowStart} windowEnd=${windowEnd} topN=${topN}`);

	// Load data from your local indexer/source
	if (verbose) console.log('[compute] loading source data...');
	const events = await loadLocalEvents(windowStart, windowEnd); // [{id,kind,pubkey,created_at,content,tags,deleted?}]
	const engagement = await loadLocalEngagement(windowStart, windowEnd); // Map id->{likes,reposts,replies,zaps,updated_at}
	const authorStats = await loadLocalAuthorStats(); // [{pubkey,followers,following,posts24h,repost_rate,zap_sum24h,updated_at}]
	const trustScores = await loadLocalTrustScores(); // [{pubkey,score,updated_at}]
	const topicAff = await loadLocalTopicAffinities(); // [{pubkey,topic,score,updated_at}]
	const trendingCandidates = await loadLocalTrendingCandidates(windowStart, windowEnd); // [{id,kind,pubkey,created_at,counts}]
	const discoveryCandidates = await loadLocalDiscoveryCandidates(windowStart, windowEnd); // [{id,kind,pubkey,created_at,counts,reasons?}]

	if (verbose) console.log(`[compute] loaded counts: events=${events?.length||0} engagement=${Object.keys(engagement||{}).length} authorStats=${authorStats?.length||0} trustScores=${trustScores?.length||0} topicAff=${topicAff?.length||0} trendingCandidates=${trendingCandidates?.length||0} discoveryCandidates=${discoveryCandidates?.length||0}`);

	const trendSnapId = toSnapId('snap', windowEnd);
	const discSnapId = toSnapId('disc', windowEnd);

	// Score and pick top
	if (verbose) console.log('[compute] scoring trending/discovery...');
	const scoredTrending = scoreByRecencyEngagement(trendingCandidates).sort((a,b)=> b.score - a.score).slice(0, topN);
	const scoredDiscovery = scoreDiscovery(discoveryCandidates).sort((a,b)=> b.score - a.score).slice(0, topN);
	if (verbose) console.log(`[compute] scored: trending=${scoredTrending.length} discovery=${scoredDiscovery.length}`);

	if (computeOnly) {
		console.log(`Compute-only summary: events=${events?.length||0}, engagement=${Object.keys(engagement||{}).length}, author_stats=${authorStats?.length||0}, trust_scores=${trustScores?.length||0}, topic_aff=${topicAff?.length||0}, trending=${scoredTrending.length}, discovery=${scoredDiscovery.length}`);
		return;
	}

	if (verbose) console.log('[push] starting transaction and writing to Turso...');
	try {
		await client.transaction('write', async (tx) => {
			// 1) Upsert events (optional)
			if (upsertEvents) {
				if (verbose) console.log(`[push] upserting events: ${events?.length||0}`);
				for (const ev of (events||[])) {
					const tagsJson = Array.isArray(ev.tags) ? JSON.stringify(ev.tags) : (typeof ev.tags_json === 'string' ? ev.tags_json : '[]');
					await tx.execute({
						sql: `INSERT OR REPLACE INTO events(id, kind, pubkey, created_at, content, tags_json, deleted)
							VALUES (?1,?2,?3,?4,?5,?6,?7)`,
						args: [ev.id, Number(ev.kind||0), String(ev.pubkey||''), Number(ev.created_at||0), String(ev.content||''), tagsJson, Number(ev.deleted?1:0)]
					});
				}
			} else if (verbose) {
				console.log('[push] skipping events upsert');
			}

			// 2) Upsert engagement_counts (newer-wins implied by replacing with this batch timestamp)
			for (const [id, cnt] of Object.entries(engagement||{})) {
				await tx.execute({
					sql: `INSERT INTO engagement_counts(event_id, likes, reposts, replies, zaps, updated_at)
						VALUES (?1,?2,?3,?4,?5,?6)
						ON CONFLICT(event_id) DO UPDATE SET
							likes=excluded.likes,
							reposts=excluded.reposts,
							replies=excluded.replies,
							zaps=excluded.zaps,
							updated_at=excluded.updated_at`,
					args: [id, Number(cnt.likes||0), Number(cnt.reposts||0), Number(cnt.replies||0), Number(cnt.zaps||0), Number(cnt.updated_at||windowEnd)]
				});
			}

			// 3) Upsert author_stats
			for (const s of (authorStats||[])) {
				await tx.execute({
					sql: `INSERT OR REPLACE INTO author_stats(pubkey, followers, following, posts24h, repost_rate, zap_sum24h, updated_at)
						VALUES (?1,?2,?3,?4,?5,?6,?7)`,
					args: [s.pubkey, Number(s.followers||0), Number(s.following||0), Number(s.posts24h||0), Number(s.repost_rate||0), Number(s.zap_sum24h||0), Number(s.updated_at||windowEnd)]
				});
			}

			// 4) Upsert trust_scores
			for (const t of (trustScores||[])) {
				await tx.execute({
					sql: `INSERT OR REPLACE INTO trust_scores(pubkey, score, updated_at) VALUES (?1,?2,?3)`,
					args: [t.pubkey, Number(t.score||0), Number(t.updated_at||windowEnd)]
				});
			}

			// 5) Upsert topic_affinities
			for (const a of (topicAff||[])) {
				await tx.execute({
					sql: `INSERT OR REPLACE INTO topic_affinities(pubkey, topic, score, updated_at) VALUES (?1,?2,?3,?4)`,
					args: [a.pubkey, String(a.topic||''), Number(a.score||0), Number(a.updated_at||windowEnd)]
				});
			}

			// 6) Trending snapshot
			if (verbose) console.log('[push] writing trending snapshot header');
			await tx.execute({ sql: 'INSERT OR REPLACE INTO trending_snapshots(id, window_start, window_end, created_at) VALUES (?1,?2,?3,?4)', args: [trendSnapId, windowStart, windowEnd, nowSec()] });
			let r1 = 1;
			if (verbose) console.log(`[push] writing trending items: ${scoredTrending.length}`);
			for (const it of (scoredTrending||[])) {
				await tx.execute({
					sql: `INSERT OR REPLACE INTO trending_items(snapshot_id, rank, event_id, pubkey, kind, created_at, score, likes, reposts, replies, zaps)
						VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
					args: [trendSnapId, r1++, it.id, it.pubkey, Number(it.kind||0), Number(it.created_at||0), Number(it.score||0), Number(it.counts?.likes||0), Number(it.counts?.reposts||0), Number(it.counts?.replies||0), Number(it.counts?.zaps||0)]
				});
			}
			await tx.execute({ sql: 'INSERT OR REPLACE INTO indexer_state(key,value) VALUES (?1,?2)', args: ['current_trending_snapshot_24h', trendSnapId] });

			// 7) Discovery snapshot
			if (verbose) console.log('[push] writing discovery snapshot header');
			await tx.execute({ sql: 'INSERT OR REPLACE INTO discovery_snapshots(id, created_at) VALUES (?1,?2)', args: [discSnapId, nowSec()] });
			let r2 = 1;
			if (verbose) console.log(`[push] writing discovery items: ${scoredDiscovery.length}`);
			for (const it of (scoredDiscovery||[])) {
				const reasonsJson = it.reasons ? JSON.stringify(it.reasons) : null;
				await tx.execute({
					sql: `INSERT OR REPLACE INTO discovery_items(snapshot_id, rank, event_id, pubkey, kind, created_at, score, reasons_json)
						VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
					args: [discSnapId, r2++, it.id, it.pubkey, Number(it.kind||0), Number(it.created_at||0), Number(it.score||0), reasonsJson]
				});
			}
			await tx.execute({ sql: 'INSERT OR REPLACE INTO indexer_state(key,value) VALUES (?1,?2)', args: ['current_discovery_snapshot', discSnapId] });

			// Cleanup old snapshots (older than 48h)
			const cutoff = windowEnd - 48*3600;
			await tx.execute({ sql: 'DELETE FROM trending_snapshots WHERE window_end < ?1', args: [cutoff] });
			await tx.execute({ sql: 'DELETE FROM trending_items WHERE snapshot_id NOT IN (SELECT id FROM trending_snapshots)', args: [] });
			await tx.execute({ sql: 'DELETE FROM discovery_snapshots WHERE created_at < ?1', args: [cutoff] });
			await tx.execute({ sql: 'DELETE FROM discovery_items WHERE snapshot_id NOT IN (SELECT id FROM discovery_snapshots)', args: [] });
		});

		console.log(`Pushed: events=${events?.length||0}, engagement=${Object.keys(engagement||{}).length}, author_stats=${authorStats?.length||0}, trust_scores=${trustScores?.length||0}, topic_aff=${topicAff?.length||0}, trending=${scoredTrending.length}, discovery=${scoredDiscovery.length}`);
	} catch (e) {
		console.error('Push failed:', e);
		process.exit(1);
	}
}

function scoreByRecencyEngagement(arr) {
	if (!Array.isArray(arr) || arr.length === 0) return [];
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

function scoreDiscovery(arr) {
	// For now, reuse same scoring as trending; later add trust/topic/persona boosts
	return scoreByRecencyEngagement(arr);
}

// Loaders: Turso-backed implementations
async function loadLocalEvents(since, until) {
	const { createClient } = require('@libsql/client');
	const url = process.env.TURSO_DATABASE_URL;
	const token = process.env.TURSO_AUTH_TOKEN;
	const client = createClient({ url, authToken: token });

	const result = await client.execute({
		sql: `SELECT id, kind, pubkey, created_at, content, tags_json FROM events 
		      WHERE kind = 1 AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC`,
		args: [since, until]
	});

	return result.rows.map(row => ({
		id: row.id,
		kind: row.kind,
		pubkey: row.pubkey,
		created_at: row.created_at,
		content: row.content,
		tags: row.tags_json ? JSON.parse(row.tags_json) : []
	}));
}

async function loadLocalEngagement(since, until) {
	const { createClient } = require('@libsql/client');
	const url = process.env.TURSO_DATABASE_URL;
	const token = process.env.TURSO_AUTH_TOKEN;
	const client = createClient({ url, authToken: token });

	const result = await client.execute({
		sql: `SELECT event_id, likes, reposts, replies, zaps, updated_at FROM engagement_counts 
		      WHERE updated_at >= ? AND updated_at <= ?`,
		args: [since, until]
	});

	const engagement = {};
	result.rows.forEach(row => {
		engagement[row.event_id] = {
			likes: row.likes || 0,
			reposts: row.reposts || 0,
			replies: row.replies || 0,
			zaps: row.zaps || 0,
			updated_at: row.updated_at
		};
	});
	return engagement;
}

async function loadLocalAuthorStats() {
	const { createClient } = require('@libsql/client');
	const url = process.env.TURSO_DATABASE_URL;
	const token = process.env.TURSO_AUTH_TOKEN;
	const client = createClient({ url, authToken: token });

	const result = await client.execute({
		sql: `SELECT pubkey, followers, following, posts24h, repost_rate, zap_sum24h, updated_at FROM author_stats`
	});

	return result.rows.map(row => ({
		pubkey: row.pubkey,
		followers: row.followers || 0,
		following: row.following || 0,
		posts24h: row.posts24h || 0,
		repost_rate: row.repost_rate || 0,
		zap_sum24h: row.zap_sum24h || 0,
		updated_at: row.updated_at
	}));
}

async function loadLocalTrustScores() {
	const { createClient } = require('@libsql/client');
	const url = process.env.TURSO_DATABASE_URL;
	const token = process.env.TURSO_AUTH_TOKEN;
	const client = createClient({ url, authToken: token });

	const result = await client.execute({
		sql: `SELECT pubkey, score, updated_at FROM trust_scores`
	});

	return result.rows.map(row => ({
		pubkey: row.pubkey,
		score: row.score || 0,
		updated_at: row.updated_at
	}));
}

async function loadLocalTopicAffinities() {
	const { createClient } = require('@libsql/client');
	const url = process.env.TURSO_DATABASE_URL;
	const token = process.env.TURSO_AUTH_TOKEN;
	const client = createClient({ url, authToken: token });

	const result = await client.execute({
		sql: `SELECT pubkey, topic, score, updated_at FROM topic_affinities`
	});

	return result.rows.map(row => ({
		pubkey: row.pubkey,
		topic: row.topic,
		score: row.score || 0,
		updated_at: row.updated_at
	}));
}

async function loadLocalTrendingCandidates(since, until) {
	const { createClient } = require('@libsql/client');
	const url = process.env.TURSO_DATABASE_URL;
	const token = process.env.TURSO_AUTH_TOKEN;
	const client = createClient({ url, authToken: token });

	// Get events with engagement counts
	const result = await client.execute({
		sql: `SELECT e.id, e.kind, e.pubkey, e.created_at, 
		             ec.likes, ec.reposts, ec.replies, ec.zaps
		      FROM events e
		      LEFT JOIN engagement_counts ec ON e.id = ec.event_id
		      WHERE e.kind = 1 AND e.created_at >= ? AND e.created_at <= ?
		      ORDER BY e.created_at DESC`,
		args: [since, until]
	});

	return result.rows.map(row => ({
		id: row.id,
		kind: row.kind,
		pubkey: row.pubkey,
		created_at: row.created_at,
		counts: {
			likes: row.likes || 0,
			reposts: row.reposts || 0,
			replies: row.replies || 0,
			zaps: row.zaps || 0
		}
	}));
}

async function loadLocalDiscoveryCandidates(since, until) {
	// For now, reuse trending candidates as discovery candidates
	// In a real implementation, you'd apply different filtering/scoring
	return loadLocalTrendingCandidates(since, until);
}

main().catch(e=>{ console.error(e); process.exit(1); });


