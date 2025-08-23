use tracing::info;
use std::env;

pub async fn maybe_init() -> anyhow::Result<()> {
    let url = match env::var("TURSO_DATABASE_URL") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            // No Turso configured; nothing to do
            return Ok(())
        }
    };
    let auth = env::var("TURSO_AUTH_TOKEN").unwrap_or_default();

    // Use libsql-client over HTTP to verify connectivity and ensure schema
    let mut cfg = libsql_client::Config::new(url.as_str())?;
    if !auth.is_empty() {
        cfg = cfg.with_auth_token(auth.as_str());
    }
    let client = libsql_client::Client::from_config(cfg).await?;

    // Ensure core tables exist (idempotent)
    client.execute("CREATE TABLE IF NOT EXISTS profiles (pubkey TEXT PRIMARY KEY, npub TEXT NOT NULL, name TEXT, display_name TEXT, about TEXT, picture TEXT, banner TEXT, website TEXT, lud16 TEXT, nip05 TEXT, created_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, search_vector TEXT)").await?;
    client.execute("CREATE TABLE IF NOT EXISTS relationships (follower_pubkey TEXT NOT NULL, following_pubkey TEXT NOT NULL, follower_npub TEXT NOT NULL, following_npub TEXT NOT NULL, relay TEXT, petname TEXT, created_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, PRIMARY KEY (follower_pubkey, following_pubkey))").await?;
    client.execute("CREATE TABLE IF NOT EXISTS search_index (term TEXT NOT NULL, pubkey TEXT NOT NULL, field_type TEXT NOT NULL, PRIMARY KEY (term, pubkey, field_type))").await?;

    info!("Turso HTTP client verified and schema ensured at {}", url);
    Ok(())
}