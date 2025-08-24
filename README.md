# Nostr Indexer (Vercel + Turso)

A production-ready, Vercel-only Nostr indexer that periodically ingests profiles and contact lists from public relays and serves fast search and relational queries from Turso (libSQL). It uses Vercel Serverless Functions for the API and a scheduled Vercel Cron job for indexing.

## Highlights

- Serverless by default: Vercel Functions with clean URLs under `/api/*`
- Periodic indexing: Vercel Cron triggers ingestion safely and idempotently
- Turso-backed storage: libSQL-compatible serverless SQLite
- Simple, documented REST API for profiles, search, and relationship stats
- Lightweight and affordable: designed to run on Vercel Hobby/Pro

## Architecture

- `api/` (Node.js on Vercel)
  - `api/indexer-cron.js`: connects briefly to Nostr relays via WebSocket and upserts into Turso
  - `api/indexer-stats.js`: returns DB-level counts and last cron metadata
  - `api/search.js`: profile text search via `profiles` + `search_index`
  - `api/profile/[id].js`: fetch profile by hex pubkey or `npub`
  - `api/following/[id].js`: fetch who a user follows
  - `api/followers/[id].js`: fetch who follows a user
  - `api/stats/[id].js`: follower/following counts for a user
- `db/` (shared data access)
  - Managers for Turso: `profile-manager.js`, `relationship-manager.js`, `search-manager.js`
  - `migration-manager.js`: idempotent schema creation
  - `index.js`: singleton client and manager wiring
- `vercel.json`: routes, functions config, and the cron schedule
- `public/index.html`: simple landing page (optional)

## Database (Turso/libSQL)

Tables are created automatically on first use (idempotent migrations):

- `profiles(pubkey PRIMARY KEY, npub, name, display_name, about, picture, banner, website, lud16, nip05, created_at, indexed_at, search_vector)`
- `relationships(follower_pubkey, following_pubkey, follower_npub, following_npub, relay, petname, created_at, indexed_at, PRIMARY KEY(follower_pubkey, following_pubkey))`
- `search_index(term, pubkey, field_type, PRIMARY KEY(term, pubkey, field_type))`
- `indexer_state(key PRIMARY KEY, value)` — internal state for scheduler

Indexes are added for the common query paths.

## Environment Variables

Required
- `TURSO_DATABASE_URL`: e.g. `libsql://<db-name>-<org>.turso.io`
- `TURSO_AUTH_TOKEN`: a token with write access

Optional
- `INDEXER_RELAYS`: comma-separated relays (defaults are built-in)
- `INDEXER_MAX_EVENTS`: cap total events per cron run (default 150)
- `INDEXER_MAX_EVENTS_PER_RELAY`: per-relay cap (default 75)
- `INDEXER_MAX_RUNTIME_MS`: hard stop for a relay connection (default 8000ms)

Vercel Function settings (in `vercel.json`)
- `api/indexer-cron.js`: `maxDuration: 10` (Hobby-friendly)
- Cron schedule: daily at 02:00 UTC (`0 2 * * *`)

Notes for Hobby plan
- Invocation timing has jitter (±59m). The indexer uses `indexer_state.last_indexed` with a 60s overlap to avoid gaps.

## API Reference

Base URL: your Vercel deployment

- Health
  - `GET /api/health` → `{ success, data: "OK" }`

- Indexer Stats
  - `GET /api/indexer-stats`
  - Response: `{ total_profiles, total_relationships, search_index_size, relays_indexed, last_indexed }`

- Search
  - `GET /api/search?q=<query>&page=<n>&per_page=<m>`
  - Response: `{ profiles: [...], total_count, page, per_page }`

- Profile
  - `GET /api/profile/<pubkey-or-npub>`
  - Response: `{ pubkey, name, display_name, about, picture, banner, website, lud16, nip05, created_at, indexed_at }`

- Relationships
  - `GET /api/following/<pubkey>?limit=100` → ordered by `created_at` desc
  - `GET /api/followers/<pubkey>?limit=100` → ordered by `created_at` desc

- User Stats
  - `GET /api/stats/<pubkey>` → `{ following_count, followers_count, last_contact_update }`

## Indexing Job (Cron)

Endpoint: `GET /api/indexer-cron` (also invoked by Vercel Cron)
- Subscribes to relays for recent kind 0 (profiles) and kind 3 (contacts)
- Applies per-run and per-relay caps and an overall time budget
- Upserts profiles and relationships via the DB managers
- Updates `indexer_state` keys:
  - `last_indexed`: unix seconds of last successful run completion
  - `relays_indexed_last_run`: count
  - `events_indexed_last_run`: count

Safety & Idempotency
- Uses `INSERT OR REPLACE` for profiles and relationships
- Keeps a small overlap window (60s) to avoid data loss under schedule jitter

## Local Development & Backfill

1) Install deps
```bash
npm install
```

2) Configure env
```bash
export TURSO_DATABASE_URL=libsql://...turso.io
export TURSO_AUTH_TOKEN=...
# optional overrides
export INDEXER_RELAYS=wss://relay.damus.io,wss://nos.lol
```

3) Initialize schema (optional)
```bash
npm run db:migrate
```

4) Exercise endpoints locally via Vercel CLI (optional)
- Not required for deployment; Vercel will build functions automatically.

## Deployment (Vercel)

1) Connect the repo to Vercel
2) Add env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (and optional overrides)
3) Deploy — Vercel will:
   - Serve static `public/`
   - Deploy all `api/*.js` functions
   - Schedule the cron per `vercel.json`

## Operations

- For Hobby: the job runs once daily with possible delay; the overlap logic prevents data loss.
- Bump limits on Pro:
  - Increase function `maxDuration`
  - Increase event caps: `INDEXER_MAX_EVENTS`, `INDEXER_MAX_EVENTS_PER_RELAY`, `INDEXER_MAX_RUNTIME_MS`
- To reindex a broader window, temporarily set `INDEXER_MAX_EVENTS` higher and trigger the cron endpoint manually.

## Project Structure

```
api/
  health.js
  indexer-cron.js
  indexer-stats.js
  profile/[id].js
  followers/[id].js
  following/[id].js
  search.js
  stats/[id].js

db/
  index.js
  migration-manager.js
  profile-manager.js
  relationship-manager.js
  search-manager.js
  utils.js

public/
  index.html

vercel.json
package.json
```

## FAQ

- Q: Why Turso/libSQL?
  - A: Serverless-friendly SQLite with HTTP and token auth, ideal for Vercel Functions.
- Q: Will runs overlap?
  - A: Rarely. You can add a simple lock in `indexer_state` if needed.
- Q: Can I change the relays?
  - A: Yes, set `INDEXER_RELAYS` in Vercel env vars.

## License

MIT © Contributors

### Local backfill to Turso

The repo includes a simple Node CLI that connects to relays locally and writes directly to your Turso DB using the same managers as the API.

Prereqs:
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` exported in your shell

Commands:
```bash
# general run (profiles + contacts)
npm run index:local -- --limit=20000 --perRelay=2000 --since=$(($(date +%s)-604800))

# profiles only
npm run index:profiles -- --limit=50000 --perRelay=2500 --since=$(($(date +%s)-2592000))

# contacts only
npm run index:contacts -- --limit=20000 --perRelay=2000 --since=$(($(date +%s)-1209600))
```

Options:
- `--relays=<comma-separated>` override relay list
- `--since=<unix-seconds>` earliest event time (default: 24h ago)
- `--limit=<n>` total events target (best-effort)
- `--perRelay=<n>` cap per relay
- `--only=profiles|contacts` restrict kinds
- `--runtimeMs=<ms>` per-relay socket budget (default 55s)

You can loop runs to reach higher totals:
```bash
for i in $(seq 1 20); do
  npm run index:profiles -- --limit=20000 --perRelay=2000 --since=$(($(date +%s)-2592000))
  sleep 3
done
```

Verify:
```bash
curl -sS https://<your-domain>/api/indexer-stats | jq
```