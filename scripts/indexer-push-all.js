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
	const url = env('TURSO_DATABASE_URL');
	const token = env('TURSO_AUTH_TOKEN');
	const client = createClient({ url, authToken: token });

	const windowEnd = parseInt(env('WINDOW_END', true, String(nowSec())), 10);
	const windowStart = windowEnd - 24*3600;
	const topN = Math.min(500, Math.max(1, parseInt(env('TOP_N', true, '200'), 10)));

	// Load data from your local indexer/source
	const events = await loadLocalEvents(windowStart, windowEnd); // [{id,kind,pubkey,created_at,content,tags,deleted?}]
	const engagement = await loadLocalEngagement(windowStart, windowEnd); // Map id->{likes,reposts,replies,zaps,updated_at}
	const authorStats = await loadLocalAuthorStats(); // [{pubkey,followers,following,posts24h,repost_rate,zap_sum24h,updated_at}]
	const trustScores = await loadLocalTrustScores(); // [{pubkey,score,updated_at}]
	const topicAff = await loadLocalTopicAffinities(); // [{pubkey,topic,score,updated_at}]
	const trendingCandidates = await loadLocalTrendingCandidates(windowStart, windowEnd); // [{id,kind,pubkey,created_at,counts}]
	const discoveryCandidates = await loadLocalDiscoveryCandidates(windowStart, windowEnd); // [{id,kind,pubkey,created_at,counts,reasons?}]

	const trendSnapId = toSnapId('snap', windowEnd);
	const discSnapId = toSnapId('disc', windowEnd);

	// Score and pick top
	const scoredTrending = scoreByRecencyEngagement(trendingCandidates).sort((a,b)=> b.score - a.score).slice(0, topN);
	const scoredDiscovery = scoreDiscovery(discoveryCandidates).sort((a,b)=> b.score - a.score).slice(0, topN);

	await client.execute('BEGIN');
	try {
		// 1) Upsert events
		for (const ev of (events||[])) {
			const tagsJson = Array.isArray(ev.tags) ? JSON.stringify(ev.tags) : (typeof ev.tags_json === 'string' ? ev.tags_json : '[]');
			await client.execute({
				sql: `INSERT OR REPLACE INTO events(id, kind, pubkey, created_at, content, tags_json, deleted)
					VALUES (?1,?2,?3,?4,?5,?6,?7)`,
				args: [ev.id, Number(ev.kind||0), String(ev.pubkey||''), Number(ev.created_at||0), String(ev.content||''), tagsJson, Number(ev.deleted?1:0)]
			});
		}

		// 2) Upsert engagement_counts (newer-wins implied by replacing with this batch timestamp)
		for (const [id, cnt] of Object.entries(engagement||{})) {
			await client.execute({
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
			await client.execute({
				sql: `INSERT OR REPLACE INTO author_stats(pubkey, followers, following, posts24h, repost_rate, zap_sum24h, updated_at)
					VALUES (?1,?2,?3,?4,?5,?6,?7)`,
				args: [s.pubkey, Number(s.followers||0), Number(s.following||0), Number(s.posts24h||0), Number(s.repost_rate||0), Number(s.zap_sum24h||0), Number(s.updated_at||windowEnd)]
			});
		}

		// 4) Upsert trust_scores
		for (const t of (trustScores||[])) {
			await client.execute({
				sql: `INSERT OR REPLACE INTO trust_scores(pubkey, score, updated_at) VALUES (?1,?2,?3)`,
				args: [t.pubkey, Number(t.score||0), Number(t.updated_at||windowEnd)]
			});
		}

		// 5) Upsert topic_affinities
		for (const a of (topicAff||[])) {
			await client.execute({
				sql: `INSERT OR REPLACE INTO topic_affinities(pubkey, topic, score, updated_at) VALUES (?1,?2,?3,?4)`,
				args: [a.pubkey, String(a.topic||''), Number(a.score||0), Number(a.updated_at||windowEnd)]
			});
		}

		// 6) Trending snapshot
		await client.execute({ sql: 'INSERT OR REPLACE INTO trending_snapshots(id, window_start, window_end, created_at) VALUES (?1,?2,?3,?4)', args: [trendSnapId, windowStart, windowEnd, nowSec()] });
		let r1 = 1;
		for (const it of (scoredTrending||[])) {
			await client.execute({
				sql: `INSERT OR REPLACE INTO trending_items(snapshot_id, rank, event_id, pubkey, kind, created_at, score, likes, reposts, replies, zaps)
					VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
				args: [trendSnapId, r1++, it.id, it.pubkey, Number(it.kind||0), Number(it.created_at||0), Number(it.score||0), Number(it.counts?.likes||0), Number(it.counts?.reposts||0), Number(it.counts?.replies||0), Number(it.counts?.zaps||0)]
			});
		}
		await client.execute({ sql: 'INSERT OR REPLACE INTO indexer_state(key,value) VALUES (?1,?2)', args: ['current_trending_snapshot_24h', trendSnapId] });

		// 7) Discovery snapshot
		await client.execute({ sql: 'INSERT OR REPLACE INTO discovery_snapshots(id, created_at) VALUES (?1,?2)', args: [discSnapId, nowSec()] });
		let r2 = 1;
		for (const it of (scoredDiscovery||[])) {
			const reasonsJson = it.reasons ? JSON.stringify(it.reasons) : null;
			await client.execute({
				sql: `INSERT OR REPLACE INTO discovery_items(snapshot_id, rank, event_id, pubkey, kind, created_at, score, reasons_json)
					VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
				args: [discSnapId, r2++, it.id, it.pubkey, Number(it.kind||0), Number(it.created_at||0), Number(it.score||0), reasonsJson]
			});
		}
		await client.execute({ sql: 'INSERT OR REPLACE INTO indexer_state(key,value) VALUES (?1,?2)', args: ['current_discovery_snapshot', discSnapId] });

		// Cleanup old snapshots (older than 48h)
		const cutoff = windowEnd - 48*3600;
		await client.execute({ sql: 'DELETE FROM trending_snapshots WHERE window_end < ?1', args: [cutoff] });
		await client.execute({ sql: 'DELETE FROM trending_items WHERE snapshot_id NOT IN (SELECT id FROM trending_snapshots)', args: [] });
		await client.execute({ sql: 'DELETE FROM discovery_snapshots WHERE created_at < ?1', args: [cutoff] });
		await client.execute({ sql: 'DELETE FROM discovery_items WHERE snapshot_id NOT IN (SELECT id FROM discovery_snapshots)', args: [] });

		await client.execute('COMMIT');
		console.log(`Pushed: events=${events?.length||0}, engagement=${Object.keys(engagement||{}).length}, author_stats=${authorStats?.length||0}, trust_scores=${trustScores?.length||0}, topic_aff=${topicAff?.length||0}, trending=${scoredTrending.length}, discovery=${scoredDiscovery.length}`);
	} catch (e) {
		await client.execute('ROLLBACK');
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

// Loaders: Replace with your local indexer implementations
async function loadLocalEvents(_since, _until) {
	if (process.env.MOCK_ALL === '1') {
		const base = nowSec() - 1800;
		return [
			{ id: 'evt1', kind: 1, pubkey: 'deadbeef', created_at: base, content: 'hello world', tags: [['t','nostr']] },
			{ id: 'evt2', kind: 1, pubkey: 'cafebabe', created_at: base-600, content: 'another post', tags: [['t','bitcoin']] }
		];
	}
	throw new Error('loadLocalEvents not implemented');
}

async function loadLocalEngagement(_since, _until) {
	if (process.env.MOCK_ALL === '1') {
		return {
			'evt1': { likes: 10, reposts: 3, replies: 2, zaps: 1, updated_at: nowSec() },
			'evt2': { likes: 8, reposts: 5, replies: 1, zaps: 0, updated_at: nowSec() }
		};
	}
	throw new Error('loadLocalEngagement not implemented');
}

async function loadLocalAuthorStats() {
	if (process.env.MOCK_ALL === '1') {
		return [
			{ pubkey: 'deadbeef', followers: 100, following: 50, posts24h: 5, repost_rate: 0.1, zap_sum24h: 0, updated_at: nowSec() },
			{ pubkey: 'cafebabe', followers: 80, following: 40, posts24h: 4, repost_rate: 0.2, zap_sum24h: 0, updated_at: nowSec() }
		];
	}
	throw new Error('loadLocalAuthorStats not implemented');
}

async function loadLocalTrustScores() {
	if (process.env.MOCK_ALL === '1') {
		return [
			{ pubkey: 'deadbeef', score: 0.6, updated_at: nowSec() },
			{ pubkey: 'cafebabe', score: 0.5, updated_at: nowSec() }
		];
	}
	throw new Error('loadLocalTrustScores not implemented');
}

async function loadLocalTopicAffinities() {
	if (process.env.MOCK_ALL === '1') {
		return [
			{ pubkey: 'deadbeef', topic: 'nostr', score: 0.8, updated_at: nowSec() },
			{ pubkey: 'cafebabe', topic: 'bitcoin', score: 0.7, updated_at: nowSec() }
		];
	}
	throw new Error('loadLocalTopicAffinities not implemented');
}

async function loadLocalTrendingCandidates(_since, _until) {
	if (process.env.MOCK_ALL === '1') {
		const base = nowSec() - 1800;
		return [
			{ id: 'evt1', kind: 1, pubkey: 'deadbeef', created_at: base, counts: { likes: 10, reposts: 3, replies: 2, zaps: 1 } },
			{ id: 'evt2', kind: 1, pubkey: 'cafebabe', created_at: base-600, counts: { likes: 8, reposts: 5, replies: 1, zaps: 0 } }
		];
	}
	throw new Error('loadLocalTrendingCandidates not implemented');
}

async function loadLocalDiscoveryCandidates(_since, _until) {
	if (process.env.MOCK_ALL === '1') {
		const base = nowSec() - 1200;
		return [
			{ id: 'evt2', kind: 1, pubkey: 'cafebabe', created_at: base-600, counts: { likes: 8, reposts: 5, replies: 1, zaps: 0 }, reasons: { topic: 'bitcoin' } },
			{ id: 'evt1', kind: 1, pubkey: 'deadbeef', created_at: base, counts: { likes: 10, reposts: 3, replies: 2, zaps: 1 }, reasons: { topic: 'nostr' } }
		];
	}
	throw new Error('loadLocalDiscoveryCandidates not implemented');
}

main().catch(e=>{ console.error(e); process.exit(1); });


