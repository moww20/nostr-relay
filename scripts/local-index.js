#!/usr/bin/env node

const WebSocket = require('ws');
const { dbManager } = require('../db');

const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.snort.social',
	'wss://nostr.wine',
	'wss://eden.nostr.land',
	'wss://relay.primal.net',
	'wss://relay.nostr.band',
	'wss://purplepag.es'
];

function parseArgs() {
	const args = process.argv.slice(2);
	const opts = {};
	for (const a of args) {
		const [k, v] = a.split('=');
		opts[k.replace(/^--/, '')] = v === undefined ? true : v;
	}
	return opts;
}

function reqMessage(subId, kinds, since, limit) {
	return JSON.stringify(['REQ', subId, { kinds, since, limit }]);
}

async function indexRelay(url, sinceTs, perRelayLimit, only, onEvent, runtimeMs) {
	return new Promise((resolve) => {
		const ws = new WebSocket(url, { handshakeTimeout: 8000 });
		let events = 0;
		let closed = false;
		const start = Date.now();

		const cleanup = () => {
			if (closed) return;
			closed = true;
			try { ws.close(); } catch {}
			resolve(events);
		};

		const stopIfNeeded = () => {
			if (events >= perRelayLimit) cleanup();
			if (Date.now() - start > runtimeMs) cleanup();
		};

		ws.on('open', () => {
			try {
				if (!only || only === 'profiles') {
					ws.send(reqMessage('profiles', [0], sinceTs, perRelayLimit));
				}
				if (!only || only === 'contacts') {
					ws.send(reqMessage('contacts', [3], sinceTs, perRelayLimit));
				}
			} catch {
				cleanup();
			}
		});

		ws.on('message', async (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (!Array.isArray(msg) || msg.length < 2) return;
				const typ = msg[0];
				if (typ === 'EVENT' && msg.length >= 3) {
					await onEvent(msg[2], url);
					events += 1;
					stopIfNeeded();
				} else if (typ === 'EOSE') {
					cleanup();
				}
			} catch {}
		});

		ws.on('error', () => cleanup());
		ws.on('close', () => cleanup());

		setTimeout(cleanup, runtimeMs + 2000);
	});
}

async function onEventFactory() {
	await dbManager.ensureSchema();
	return async (event, relayUrl) => {
		if (event.kind === 0) {
			try {
				const profileData = JSON.parse(event.content || '{}');
				await dbManager.profiles.upsertProfile({
					pubkey: event.pubkey,
					name: profileData.name,
					display_name: profileData.display_name,
					about: profileData.about,
					picture: profileData.picture,
					banner: profileData.banner,
					website: profileData.website,
					lud16: profileData.lud16,
					nip05: profileData.nip05,
					created_at: event.created_at,
					indexed_at: Math.floor(Date.now() / 1000),
					relay_sources: [relayUrl],
					search_terms: []
				});
			} catch {}
		} else if (event.kind === 3) {
			try {
				const follower = event.pubkey;
				const tags = Array.isArray(event.tags) ? event.tags : [];
				for (const tag of tags) {
					if (Array.isArray(tag) && tag[0] === 'p' && tag[1]) {
						await dbManager.relationships.upsertRelationship({
							follower_pubkey: follower,
							following_pubkey: tag[1],
							relay: tag[2] || null,
							petname: tag[3] || null,
							created_at: event.created_at,
							indexed_at: Math.floor(Date.now() / 1000)
						});
					}
				}
			} catch {}
		}
	};
}

(async () => {
	const opts = parseArgs();
	const relays = (opts.relays || process.env.INDEXER_RELAYS || DEFAULT_RELAYS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
	const since = Number(opts.since || Math.floor(Date.now()/1000) - 86400); // default past day
	const limit = Number(opts.limit || 5000);
	const perRelay = Number(opts.perRelay || 2500);
	const only = opts.only === 'profiles' || opts.only === 'contacts' ? opts.only : null;
	const runtimeMs = Number(opts.runtimeMs || 55000);

	if (!process.env.TURSO_DATABASE_URL) {
		console.error('Missing TURSO_DATABASE_URL');
		process.exit(1);
	}

	const onEvent = await onEventFactory();
	let total = 0;
	for (const url of relays) {
		if (total >= limit) break;
		const remaining = Math.max(0, limit - total);
		const count = await indexRelay(url, since, Math.min(perRelay, remaining), only, onEvent, runtimeMs);
		total += count;
		console.log(`Indexed ${count} from ${url} (total=${total})`);
	}
	console.log(`Done. Total events indexed: ${total}`);
	process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });