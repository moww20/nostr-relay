use clap::Parser;
use nostr_rs_relay::config::Config;
use nostr_rs_relay::server::Server;
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

    // Create and start the server
    let server = Server::new(config);
    
    info!("Starting NOSTR relay server...");
    server.run().await?;

    Ok(())
}
