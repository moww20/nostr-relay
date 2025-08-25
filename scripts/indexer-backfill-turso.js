#!/usr/bin/env node

require('dotenv').config();
const WebSocket = require('ws');
const { dbManager } = require('../db');

// Fixed top 10 relays (always used by default)
const TOP_TEN_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://eden.nostr.land',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://purplepag.es',
  'wss://relay.nostr.info',
  'wss://relay.nostr.dev'
];

function showHelp() {
  console.log(
    `\nUsage: node scripts/indexer-backfill-turso.js [options]\n\nOptions:\n  --relays=LIST           Comma-separated relay URLs\n  --since=SECONDS         Earliest event timestamp (unix seconds)\n  --limit=NUMBER          Total events target (best-effort)\n  --perRelay=NUMBER       Per-relay event cap\n  --only=profiles|contacts  Restrict kinds\n  --runtimeMs=MS          Per-relay socket budget (default 300000)\n`
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (const a of args) {
    if (a === '--help' || a === '-h') return { help: true };
    const [k, v] = a.split('=');
    const key = k.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    opts[key] = v === undefined ? true : v;
  }
  return opts;
}

function reqMessage(subId, kinds, since) {
  const filter = { kinds };
  if (typeof since === 'number') filter.since = since;
  return JSON.stringify(['REQ', subId, filter]);
}

async function indexRelay(url, sinceTs, only, onEvent) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: 8000 });
    let events = 0;
    let closed = false;
    const pendingSubs = new Set();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      try {
        ws.close();
      } catch {}
      resolve(events);
    };

    ws.on('open', () => {
      try {
        const since = typeof sinceTs === 'number' ? sinceTs : 0;
        if (!only || only === 'profiles') {
          const sid = 'profiles';
          pendingSubs.add(sid);
          ws.send(reqMessage(sid, [0], since));
        }
        if (!only || only === 'contacts') {
          const sid = 'contacts';
          pendingSubs.add(sid);
          ws.send(reqMessage(sid, [3], since));
        }
        if (!only || only === 'notes' || only === 'posts') {
          const sid = 'notes';
          pendingSubs.add(sid);
          ws.send(reqMessage(sid, [1], since));
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
        } else if (typ === 'EOSE') {
          const sid = msg[1];
          if (sid && pendingSubs.has(sid)) pendingSubs.delete(sid);
          if (pendingSubs.size === 0) cleanup();
        }
      } catch {}
    });

    ws.on('error', () => cleanup());
    ws.on('close', () => cleanup());
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
    } else if (event.kind === 1) {
      try {
        const client = dbManager.getClient();
        const tagsJson = JSON.stringify(Array.isArray(event.tags) ? event.tags : []);
        await client.execute({
          sql: `INSERT OR REPLACE INTO events(id, kind, pubkey, created_at, content, tags_json, deleted)
                VALUES (?1,?2,?3,?4,?5,?6,?7)`,
          args: [
            event.id,
            Number(event.kind || 1),
            String(event.pubkey || ''),
            Number(event.created_at || 0),
            String(event.content || ''),
            tagsJson,
            0
          ]
        });
      } catch {}
    }
  };
}

(async () => {
  const opts = parseArgs();
  if (opts.help) {
    showHelp();
    process.exit(0);
  }
  // Always use the fixed top 10 relays by default
  const relays = TOP_TEN_RELAYS.slice();
  const since = Number(opts.since || opts.sinceSeconds || 0);
  const only = opts.only === 'profiles' || opts.only === 'contacts' ? opts.only : null;

  if (!process.env.TURSO_DATABASE_URL) {
    console.error('Missing TURSO_DATABASE_URL');
    process.exit(1);
  }

  const onEvent = await onEventFactory();
  let total = 0;
  for (const url of relays) {
    const count = await indexRelay(url, since, only, onEvent);
    total += count;
    console.log(`Indexed ${count} from ${url} (total=${total})`);
  }
  console.log(`Done. Total events indexed: ${total}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
