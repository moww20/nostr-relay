use tracing::info;
use std::env;
use libsql_client::{Client, Config, Statement};
use crate::indexer::{Profile, Contact};

pub async fn maybe_init() -> anyhow::Result<()> {
    if let Ok(client) = client_from_env().await {
        // Ensure core tables exist (idempotent)
        client.execute("CREATE TABLE IF NOT EXISTS profiles (pubkey TEXT PRIMARY KEY, npub TEXT NOT NULL, name TEXT, display_name TEXT, about TEXT, picture TEXT, banner TEXT, website TEXT, lud16 TEXT, nip05 TEXT, created_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, search_vector TEXT)").await?;
        client.execute("CREATE TABLE IF NOT EXISTS relationships (follower_pubkey TEXT NOT NULL, following_pubkey TEXT NOT NULL, follower_npub TEXT NOT NULL, following_npub TEXT NOT NULL, relay TEXT, petname TEXT, created_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, PRIMARY KEY (follower_pubkey, following_pubkey))").await?;
        client.execute("CREATE TABLE IF NOT EXISTS search_index (term TEXT NOT NULL, pubkey TEXT NOT NULL, field_type TEXT NOT NULL, PRIMARY KEY (term, pubkey, field_type))").await?;
        info!("Turso HTTP client verified and schema ensured");
    }
    Ok(())
}

pub async fn client_from_env() -> anyhow::Result<Client> {
    let url = env::var("TURSO_DATABASE_URL")?;
    let auth = env::var("TURSO_AUTH_TOKEN").unwrap_or_default();
    let mut cfg = Config::new(url.as_str())?;
    if !auth.is_empty() { cfg = cfg.with_auth_token(auth.as_str()); }
    let client = Client::from_config(cfg).await?;
    Ok(client)
}

pub async fn insert_profile(client: &Client, profile: &Profile, search_terms: &[String]) -> anyhow::Result<()> {
    let search_vector = format!("{} {} {}",
        profile.name.as_deref().unwrap_or(""),
        profile.display_name.as_deref().unwrap_or(""),
        profile.about.as_deref().unwrap_or("")
    ).to_lowercase();

    let stmt = Statement::with_args(
        "INSERT OR REPLACE INTO profiles (pubkey, npub, name, display_name, about, picture, banner, website, lud16, nip05, created_at, indexed_at, search_vector) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        libsql_client::args!(
            profile.pubkey.as_str(),
            hex_to_npub(&profile.pubkey),
            profile.name.as_ref().map(|s| s.as_str()),
            profile.display_name.as_ref().map(|s| s.as_str()),
            profile.about.as_ref().map(|s| s.as_str()),
            profile.picture.as_ref().map(|s| s.as_str()),
            profile.banner.as_ref().map(|s| s.as_str()),
            profile.website.as_ref().map(|s| s.as_str()),
            profile.lud16.as_ref().map(|s| s.as_str()),
            profile.nip05.as_ref().map(|s| s.as_str()),
            profile.created_at,
            profile.indexed_at.timestamp(),
            search_vector.as_str()
        ),
    );
    client.execute(stmt).await?;

    // Replace search_index terms
    client.execute(Statement::with_args(
        "DELETE FROM search_index WHERE pubkey = ?1",
        libsql_client::args!(profile.pubkey.as_str()),
    )).await?;
    for term in search_terms {
        client.execute(Statement::with_args(
            "INSERT INTO search_index (term, pubkey, field_type) VALUES (?1, ?2, 'profile')",
            libsql_client::args!(term.as_str(), profile.pubkey.as_str()),
        )).await?;
    }
    Ok(())
}

pub async fn insert_relationship(client: &Client, contact: &Contact) -> anyhow::Result<()> {
    let stmt = Statement::with_args(
        "INSERT OR REPLACE INTO relationships (follower_pubkey, following_pubkey, follower_npub, following_npub, relay, petname, created_at, indexed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        libsql_client::args!(
            contact.follower_pubkey.as_str(),
            contact.following_pubkey.as_str(),
            hex_to_npub(&contact.follower_pubkey),
            hex_to_npub(&contact.following_pubkey),
            contact.relay.as_ref().map(|s| s.as_str()),
            contact.petname.as_ref().map(|s| s.as_str()),
            contact.created_at,
            contact.indexed_at.timestamp()
        ),
    );
    client.execute(stmt).await?;
    Ok(())
}

fn hex_to_npub(hex_pubkey: &str) -> String {
    use bech32::{ToBase32, Variant, encode};
    let bytes = hex::decode(hex_pubkey).unwrap_or_default();
    encode("npub", bytes.to_base32(), Variant::Bech32).unwrap_or_else(|_| "".to_string())
}

fn npub_to_hex(_npub: &str) -> Result<String, anyhow::Error> { Ok(String::new()) }