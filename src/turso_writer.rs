use crate::indexer::{Profile, Contact};
use tracing::error;

pub async fn persist_profile(profile: &Profile, search_terms: &[String]) {
    let profile = profile.clone();
    let terms = search_terms.to_vec();
    // Offload to blocking to avoid Send issues
    let _ = tokio::task::spawn_blocking(move || {
        if let Err(e) = write_profile_blocking(&profile, &terms) {
            error!("Turso persist_profile error: {}", e);
        }
    }).await;
}

pub async fn persist_relationship(contact: &Contact) {
    let contact = contact.clone();
    let _ = tokio::task::spawn_blocking(move || {
        if let Err(e) = write_relationship_blocking(&contact) {
            error!("Turso persist_relationship error: {}", e);
        }
    }).await;
}

fn write_profile_blocking(profile: &Profile, search_terms: &[String]) -> anyhow::Result<()> {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    rt.block_on(async move {
        let client = match crate::turso::client_from_env().await {
            Ok(c) => c,
            Err(_) => return Ok(()),
        };
        crate::turso::insert_profile(&client, profile, search_terms).await?;
        Ok(())
    })
}

fn write_relationship_blocking(contact: &Contact) -> anyhow::Result<()> {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    rt.block_on(async move {
        let client = match crate::turso::client_from_env().await {
            Ok(c) => c,
            Err(_) => return Ok(()),
        };
        crate::turso::insert_relationship(&client, contact).await?;
        Ok(())
    })
}