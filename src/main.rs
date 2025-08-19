use clap::Parser;
use std::sync::Arc;
use nostr_rs_indexer::config::Config;
use nostr_rs_indexer::indexer::Indexer;
use nostr_rs_indexer::api::ApiServer;
use nostr_rs_indexer::relay_client::RelayManager;
use tracing::info;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to configuration file
    #[arg(short, long, default_value = "config.toml")]
    config: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Parse command line arguments
    let args = Args::parse();

    // Load configuration
    let config = Config::from_file(&args.config)?;
    info!("Configuration loaded from {}", args.config);

    // Create indexer
    let indexer = Arc::new(Indexer::new(config.indexer.relay_urls.clone()));
    info!("Created indexer for {} relays", config.indexer.relay_urls.len());

    // Create API server
    let api_server = ApiServer::new(indexer.clone(), config.server.port);
    
    // Create relay manager for indexing
    let relay_manager = RelayManager::new(config.indexer.relay_urls.clone(), indexer.clone());

    info!("Starting NOSTR indexer...");
    info!("API server will run on port {}", config.server.port);
    info!("Indexing from relays: {:?}", config.indexer.relay_urls);

    // Start both API server and relay indexing concurrently
    tokio::select! {
        result = api_server.run() => {
            if let Err(e) = result {
                tracing::error!("API server error: {}", e);
            }
        }
        result = relay_manager.start_all() => {
            if let Err(e) = result {
                tracing::error!("Relay manager error: {}", e);
            }
        }
    }

    Ok(())
}
