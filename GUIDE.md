# Nostr Indexer - Quick Guide

## Prerequisites
- Node.js >= 18
- Turso database (libSQL) URL and Auth Token

## 1) Install
```bash
npm install
```

## 2) Configure Environment
Create `.env` in project root:
```ini
TURSO_DATABASE_URL=libsql://<db-name>-<org>.turso.io
TURSO_AUTH_TOKEN=<token>
```

## 3) Initialize DB
```bash
npm run db:migrate
npm run db:health
npm run db:stats
```

## 4) Index Data to Turso
Indexes profiles (kind 0), contacts (kind 3), and posts (kind 1):
```bash
npm run index:backfill:turso
```
Options (pass after `--`): `--relays`, `--since`, `--only=profiles|contacts|posts`

## 5) Compute & Push Snapshots
Computes trending/discovery from events and writes snapshots to Turso:
```bash
# Compute only (no writes)
node scripts/indexer-push-all.js --compute-only --verbose

# Compute + push (skip events upsert)
node scripts/indexer-push-all.js --verbose

# Include events upsert if needed
node scripts/indexer-push-all.js --verbose --upsert-events
```

Verify latest snapshots:
```bash
node -e "require('dotenv').config(); const {createClient}=require('@libsql/client'); (async()=>{ const c=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN}); const st=await c.execute({sql:'SELECT key,value FROM indexer_state WHERE key IN (?,?)', args:['current_trending_snapshot_24h','current_discovery_snapshot']}); const m=Object.fromEntries(st.rows.map(r=>[r.key,r.value])); for (const [k,v] of Object.entries(m)) console.log(k, v);})();"
```

## 6) APIs
All endpoints are served via `api/data.js` (serverless). CORS is permissive by default. Set `ALLOWED_ORIGINS` to restrict.

- Health: `GET /api/health`
- Trending: `GET /api/trending?limit=50&cursor=<base64>`
- Discovery: `GET /api/discovery?limit=50&cursor=<base64>`
- Engagement: `GET /api/engagement?ids=<id1,id2,...>`
- Events FTS: `GET /api/search/events?q=<fts>&since=&until=&limit=50`
- Thread: `GET /api/thread/<eventId>`
- Events bulk: `GET /api/events/bulk?ids=<id1,id2,...>`
- Profile search: `GET /api/search?q=<q>&page=<n>&per_page=<m>`
- Profile by id: `GET /api/profile/<npub|hex>`
- Profiles bulk: `GET /api/profile/bulk?ids=<hex1,hex2,...>`
- Following: `GET /api/following/<id>?limit=100`
- Followers: `GET /api/followers/<id>?limit=100`
- User stats: `GET /api/stats/<id>`
- Indexer stats: `GET /api/indexer-stats`

## 7) Local Dev (optional)
Local Express API (SQLite):
```bash
npm run dev:api
# http://localhost:3000
```

## Tips
- Set `TOP_N` or `WINDOW_END` when testing snapshots.
- If push slows down, run without `--upsert-events` (events already in Turso).
- For 24h posts count:
```bash
node -e "const {dbManager}=require('./db'); (async()=>{ const c=dbManager.getClient(); const since=Math.floor(Date.now()/1000)-86400; const r=await c.execute({sql:'SELECT COUNT(*) AS c FROM events WHERE kind=1 AND created_at>=?',args:[since]}); console.log('Posts last 24h:', r.rows[0].c);})();"
```
