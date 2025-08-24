const WebSocket = require('ws');
const { ensureSchema, upsertProfile, upsertRelationship, getClient } = require('./_db');

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

const MAX_EVENTS_TOTAL = parseInt(process.env.INDEXER_MAX_EVENTS || '150', 10);
const MAX_EVENTS_PER_RELAY = parseInt(process.env.INDEXER_MAX_EVENTS_PER_RELAY || '75', 10);
const MAX_RUNTIME_MS = parseInt(process.env.INDEXER_MAX_RUNTIME_MS || '8000', 10); // hobby-friendly

async function getLastIndexedTs(client) {
  try {
    const result = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['last_indexed'] });
    const v = result.rows[0] && result.rows[0].value;
    const ts = v ? parseInt(v, 10) : 0;
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

async function setState(client, key, value) {
  await client.execute({ sql: 'INSERT OR REPLACE INTO indexer_state (key, value) VALUES (?1, ?2)', args: [key, String(value)] });
}

function reqMessage(subId, kinds, since, limit) {
  return JSON.stringify(['REQ', subId, { kinds, since, limit }]);
}

async function indexRelay(url, sinceTs, perRelayLimit, onEvent) {
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
      if (Date.now() - start > MAX_RUNTIME_MS) cleanup();
    };

    ws.on('open', () => {
      try {
        ws.send(reqMessage('profiles', [0], sinceTs, perRelayLimit));
        ws.send(reqMessage('contacts', [3], sinceTs, perRelayLimit));
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
          const event = msg[2];
          if (event && typeof event === 'object') {
            await onEvent(event, url);
            events += 1;
            stopIfNeeded();
          }
        } else if (typ === 'EOSE') {
          cleanup();
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on('error', () => cleanup());
    ws.on('close', () => cleanup());

    setTimeout(cleanup, MAX_RUNTIME_MS + 2000);
  });
}

async function handleEvent(event, relayUrl) {
  if (event.kind === 0) {
    try {
      const content = event.content || '{}';
      const profileData = JSON.parse(content);
      const profile = {
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
      };
      await upsertProfile(profile);
    } catch (e) {
      console.warn('profile index error', e?.message || e);
    }
  } else if (event.kind === 3) {
    try {
      const follower = event.pubkey;
      const tags = Array.isArray(event.tags) ? event.tags : [];
      for (const tag of tags) {
        if (Array.isArray(tag) && tag[0] === 'p' && tag[1]) {
          const relationship = {
            follower_pubkey: follower,
            following_pubkey: tag[1],
            relay: tag[2] || null,
            petname: tag[3] || null,
            created_at: event.created_at,
            indexed_at: Math.floor(Date.now() / 1000)
          };
          await upsertRelationship(relationship);
        }
      }
    } catch (e) {
      console.warn('relationship index error', e?.message || e);
    }
  }
}

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();
    const client = getClient();

    const relays = (process.env.INDEXER_RELAYS || '').split(',').map(s => s.trim()).filter(Boolean);
    const relayList = relays.length ? relays : DEFAULT_RELAYS;

    const sinceDefault = Math.floor(Date.now() / 1000) - 3600; // past hour if no state
    const lastStateTs = await getLastIndexedTs(client);
    const sinceTs = lastStateTs > 0 ? Math.max(0, lastStateTs - 60) : sinceDefault; // small overlap

    let totalEvents = 0;
    let relaysIndexed = 0;

    for (const url of relayList) {
      if (totalEvents >= MAX_EVENTS_TOTAL) break;
      const remaining = Math.max(0, MAX_EVENTS_TOTAL - totalEvents);
      const perRelay = Math.min(MAX_EVENTS_PER_RELAY, remaining);
      const count = await indexRelay(url, sinceTs, perRelay, handleEvent);
      totalEvents += count;
      relaysIndexed += 1;
    }

    const nowTs = Math.floor(Date.now() / 1000);
    await setState(client, 'last_indexed', nowTs);
    await setState(client, 'relays_indexed_last_run', relaysIndexed);
    await setState(client, 'events_indexed_last_run', totalEvents);

    res.status(200).json({ success: true, data: { relays_indexed: relaysIndexed, events_indexed: totalEvents, last_indexed: nowTs }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};