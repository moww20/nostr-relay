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

const MAX_EVENTS_TOTAL = parseInt(process.env.INDEXER_MAX_EVENTS || '60', 10);
const MAX_EVENTS_PER_RELAY = parseInt(process.env.INDEXER_MAX_EVENTS_PER_RELAY || '30', 10);
const MAX_RUNTIME_MS = parseInt(process.env.INDEXER_MAX_RUNTIME_MS || '2500', 10); // hobby-friendly
const MAX_RELAYS_PER_RUN = parseInt(process.env.INDEXER_MAX_RELAYS_PER_RUN || '1', 10);
const TOTAL_RUNTIME_MS = parseInt(process.env.INDEXER_TOTAL_RUNTIME_MS || '9000', 10);
const CONCURRENCY = Math.max(1, parseInt(process.env.INDEXER_CONCURRENCY || '2', 10));

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

// Per-relay last-indexed tracking
async function getLastIndexedTsForRelay(client, relayUrl) {
  try {
    const key = `relay_last_indexed:${relayUrl}`;
    const result = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: [key] });
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

// Simple advisory lock using indexer_state with TTL
async function acquireLock(client, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const until = now + Math.max(5, ttlSeconds);
  try {
    const result = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['lock'] });
    const current = result.rows[0] && parseInt(result.rows[0].value, 10);
    if (current && current > now) {
      return false;
    }
  } catch {}
  await setState(client, 'lock', until);
  // Re-check to mitigate races (best-effort in serverless)
  try {
    const confirm = await client.execute({ sql: 'SELECT value FROM indexer_state WHERE key = ?1', args: ['lock'] });
    const v = confirm.rows[0] && parseInt(confirm.rows[0].value, 10);
    return v && v >= until;
  } catch {
    return false;
  }
}

async function releaseLock(client) {
  try { await setState(client, 'lock', 0); } catch {}
}

function reqMessage(subId, kinds, since, limit) {
  return JSON.stringify(['REQ', subId, { kinds, since, limit }]);
}

async function indexRelay(url, sinceTs, perRelayLimit, onEvent, subsLimit, only, runtimeMs) {
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
        const limit = Math.min(subsLimit, perRelayLimit);
        if (!only || only === 'profiles') {
          ws.send(reqMessage('profiles', [0], sinceTs, limit));
        }
        if (!only || only === 'contacts') {
          ws.send(reqMessage('contacts', [3], sinceTs, limit));
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

    setTimeout(cleanup, (runtimeMs || MAX_RUNTIME_MS) + 2000);
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

    // Advisory lock to avoid overlapping runs
    const haveLock = await acquireLock(client, Math.ceil(TOTAL_RUNTIME_MS / 1000));
    if (!haveLock) {
      return res.status(200).json({ success: true, data: { skipped: true, reason: 'locked' }, error: null });
    }

    const relays = (process.env.INDEXER_RELAYS || '').split(',').map(s => s.trim()).filter(Boolean);
    const relayList = relays.length ? relays : DEFAULT_RELAYS;

    // request overrides via query: ?since=...&limit=...&per_relay=...&relays=...&subs_limit=...&only=profiles|contacts&runtime_ms=...
    const nowSec = Math.floor(Date.now() / 1000);
    const sinceParam = parseInt((req.query.since || '').toString(), 10);
    const limitParam = parseInt((req.query.limit || '').toString(), 10);
    const perRelayParam = parseInt((req.query.per_relay || '').toString(), 10);
    const relaysParam = parseInt((req.query.relays || '').toString(), 10);
    const subsLimitParam = parseInt((req.query.subs_limit || '').toString(), 10);
    const onlyParam = (req.query.only || '').toString();
    const runtimeMsParam = parseInt((req.query.runtime_ms || '').toString(), 10);

    const sinceDefault = nowSec - 3600; // past hour if no state
    const lastStateTs = await getLastIndexedTs(client);

    // Build per-relay since map (fallback to global state, then default)
    const sinceTsMap = {};
    for (const url of relayList) {
      const relayTs = await getLastIndexedTsForRelay(client, url);
      const baseTs = Number.isFinite(sinceParam) && sinceParam > 0
        ? sinceParam
        : (relayTs > 0 ? Math.max(0, relayTs - 60) : (lastStateTs > 0 ? Math.max(0, lastStateTs - 60) : sinceDefault));
      sinceTsMap[url] = baseTs;
    }

    let totalEvents = 0;
    let relaysIndexed = 0;

    const maxRelays = Number.isFinite(relaysParam) && relaysParam > 0 ? relaysParam : Math.max(1, MAX_RELAYS_PER_RUN);
    const subsLimit = Number.isFinite(subsLimitParam) && subsLimitParam > 0 ? subsLimitParam : 10;
    const startRun = Date.now();

    const selectedRelays = relayList.slice(0, maxRelays);
    const concurrency = Math.max(1, Math.min(CONCURRENCY, selectedRelays.length));

    for (let i = 0; i < selectedRelays.length; i += concurrency) {
      if (Date.now() - startRun > TOTAL_RUNTIME_MS) break;
      const batch = selectedRelays.slice(i, i + concurrency);

      // Respect remaining event budget across the batch
      const remainingBeforeBatch = Number.isFinite(limitParam) && limitParam > 0 ? Math.max(0, limitParam - totalEvents) : MAX_EVENTS_TOTAL - totalEvents;
      if (remainingBeforeBatch <= 0) break;

      const promises = batch.map(async (url) => {
        const remaining = Number.isFinite(limitParam) && limitParam > 0
          ? Math.max(0, limitParam - totalEvents)
          : Math.max(0, MAX_EVENTS_TOTAL - totalEvents);
        if (remaining <= 0) return { url, count: 0 };
        const perRelay = Math.min((Number.isFinite(perRelayParam) && perRelayParam > 0 ? perRelayParam : MAX_EVENTS_PER_RELAY), remaining);
        const count = await indexRelay(url, sinceTsMap[url], perRelay, handleEvent, subsLimit, onlyParam || null, runtimeMsParam);
        if (count > 0) {
          // Mark relay last indexed now to advance window; conservative but effective
          const nowTs = Math.floor(Date.now() / 1000);
          await setState(client, `relay_last_indexed:${url}`, nowTs);
        }
        return { url, count };
      });

      const results = await Promise.all(promises);
      for (const r of results) {
        totalEvents += r.count;
        if (r.count >= 0) relaysIndexed += 1;
      }
    }

    const nowTs = Math.floor(Date.now() / 1000);
    await setState(client, 'last_indexed', nowTs);
    await setState(client, 'relays_indexed_last_run', relaysIndexed);
    await setState(client, 'events_indexed_last_run', totalEvents);

    await releaseLock(client);

    res.status(200).json({ success: true, data: { relays_indexed: relaysIndexed, events_indexed: totalEvents, last_indexed: nowTs }, error: null });
  } catch (e) {
    try {
      const client = getClient();
      await releaseLock(client);
    } catch {}
    res.status(500).json({ success: false, data: null, error: e?.message || 'error' });
  }
};