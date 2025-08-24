#!/usr/bin/env node

require('dotenv').config();
const WebSocket = require('ws');
const { localDbManager } = require('../db/local-index');

const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.snort.social',
	'wss://nostr.wine',
	'wss://eden.nostr.land',
	'wss://relay.primal.net',
	'wss://relay.nostr.band',
	'wss://purplepag.es',
	'wss://relay.nostr.wine',
	'wss://relay.nostr.band',
	'wss://relay.nostr.info',
	'wss://relay.nostr.com',
	'wss://relay.nostr.net',
	'wss://relay.nostr.org',
	'wss://relay.nostr.dev',
	'wss://relay.nostr.io'
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
			// Only stop if we've been running for too long, don't limit by event count
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
	await localDbManager.ensureSchema();
	return async (event, relayUrl) => {
		if (event.kind === 0) {
			try {
				const profileData = JSON.parse(event.content || '{}');
				
				// Enhanced profile data with all metadata fields
				const enhancedProfile = {
					pubkey: event.pubkey,
					name: profileData.name,
					display_name: profileData.display_name,
					about: profileData.about,
					picture: profileData.picture,
					banner: profileData.banner,
					website: profileData.website,
					lud16: profileData.lud16,
					nip05: profileData.nip05,
					location: profileData.location,
					created_at: event.created_at,
					indexed_at: Math.floor(Date.now() / 1000),
					relay_sources: [relayUrl],
					search_terms: []
				};

				await localDbManager.profiles.upsertProfile(enhancedProfile);
				
				// Update profile stats after profile update
				await localDbManager.migrations.updateProfileStats(event.pubkey);
				
			} catch (error) {
				console.error('Failed to process profile event:', error);
			}
		} else if (event.kind === 3) {
			try {
				const follower = event.pubkey;
				const tags = Array.isArray(event.tags) ? event.tags : [];
				let relationshipCount = 0;
				
				for (const tag of tags) {
					if (Array.isArray(tag) && tag[0] === 'p' && tag[1]) {
						await localDbManager.relationships.upsertRelationship({
							follower_pubkey: follower,
							following_pubkey: tag[1],
							relay: tag[2] || null,
							petname: tag[3] || null,
							created_at: event.created_at,
							indexed_at: Math.floor(Date.now() / 1000)
						});
						relationshipCount++;
					}
				}
				
				// Update stats for both follower and all followed users
				if (relationshipCount > 0) {
					await localDbManager.migrations.updateProfileStats(follower);
					
					// Update stats for all followed users
					for (const tag of tags) {
						if (Array.isArray(tag) && tag[0] === 'p' && tag[1]) {
							await localDbManager.migrations.updateProfileStats(tag[1]);
						}
					}
				}
			} catch (error) {
				console.error('Failed to process contact list event:', error);
			}
		}
	};
}

(async () => {
	const opts = parseArgs();
	const relays = (opts.relays || process.env.INDEXER_RELAYS || DEFAULT_RELAYS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
	const since = Number(opts.since || 0); // default to beginning of time
	const limit = Number(opts.limit || 1000000); // default to 1 million events
	const perRelay = Number(opts.perRelay || 100000); // default to 100k per relay
	const only = opts.only === 'profiles' || opts.only === 'contacts' ? opts.only : null;
	const runtimeMs = Number(opts.runtimeMs || 300000); // default to 5 minutes per relay

	console.log('🚀 Starting Enhanced NOSTR Indexer with Complete Metadata...');
	console.log(`📊 Using local SQLite database`);
	console.log(`🔗 Connecting to ${relays.length} relays`);
	console.log(`⏰ Since timestamp: ${since}`);
	console.log(`📈 Per relay limit: ${perRelay}`);
	console.log(`⏱️  Runtime per relay: ${runtimeMs}ms`);
	console.log(`📋 Capturing: Profile Picture, Banner, Display Name, Npub, Hex, About, Followers, Following, Website, Bitcoin Wallet, Location, NIP-05\n`);

	const onEvent = await onEventFactory();
	let total = 0;
	for (const url of relays) {
		console.log(`🔗 Indexing ${url}...`);
		const count = await indexRelay(url, since, perRelay, only, onEvent, runtimeMs);
		total += count;
		console.log(`✅ Indexed ${count} events from ${url} (total=${total})`);
	}
	console.log(`\n🎉 Done! Total events indexed: ${total}`);
	
	// Get final stats
	const stats = await localDbManager.getStats();
	console.log(`\n📊 Final Database Stats:`);
	console.log(`  Profiles: ${stats.total_profiles}`);
	console.log(`  Relationships: ${stats.total_relationships}`);
	console.log(`  Search Index: ${stats.search_index_size}`);
	
	await localDbManager.close();
	process.exit(0);
})().catch((e) => { 
	console.error('❌ Error:', e); 
	process.exit(1); 
});
