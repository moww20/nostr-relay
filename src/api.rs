use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::convert::Infallible;
use warp::Filter;
use warp::reply::Json;
use warp::http::StatusCode;

use crate::indexer::{Indexer, ProfileSearchResult, RelationshipStats, IndexerStats};
use crate::RelayError;

/// API response wrapper
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(message: String) -> ApiResponse<()> {
        ApiResponse {
            success: false,
            data: None,
            error: Some(message),
        }
    }
}

/// Search query parameters
#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub q: String,
    #[serde(default = "default_page")]
    pub page: usize,
    #[serde(default = "default_per_page")]
    pub per_page: usize,
}

fn default_page() -> usize { 0 }
fn default_per_page() -> usize { 20 }

/// Relationship query parameters
#[derive(Debug, Deserialize)]
pub struct RelationshipParams {
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize { 100 }

/// API server for the NOSTR indexer
pub struct ApiServer {
    indexer: Arc<Indexer>,
    port: u16,
}

impl ApiServer {
    pub fn new(indexer: Arc<Indexer>, port: u16) -> Self {
        Self { indexer, port }
    }

    /// Start the API server
    pub async fn run(self) -> Result<(), RelayError> {
        let indexer = self.indexer.clone();

        // Health check endpoint
        let health = warp::path("health")
            .and(warp::get())
            .map(|| {
                warp::reply::json(&ApiResponse::success("OK"))
            });

        // Search profiles endpoint
        let search = warp::path("search")
            .and(warp::get())
            .and(warp::query::<SearchParams>())
            .and(with_indexer(indexer.clone()))
            .and_then(handle_search);

        // Get profile by pubkey
        let profile = warp::path!("profile" / String)
            .and(warp::get())
            .and(with_indexer(indexer.clone()))
            .and_then(handle_get_profile);

        // Get following list
        let following = warp::path!("following" / String)
            .and(warp::get())
            .and(warp::query::<RelationshipParams>())
            .and(with_indexer(indexer.clone()))
            .and_then(handle_get_following);

        // Get followers list
        let followers = warp::path!("followers" / String)
            .and(warp::get())
            .and(warp::query::<RelationshipParams>())
            .and(with_indexer(indexer.clone()))
            .and_then(handle_get_followers);

        // Get relationship stats
        let stats = warp::path!("stats" / String)
            .and(warp::get())
            .and(with_indexer(indexer.clone()))
            .and_then(handle_get_stats);

        // Get indexer stats
        let indexer_stats = warp::path("indexer-stats")
            .and(warp::get())
            .and(with_indexer(indexer.clone()))
            .and_then(handle_get_indexer_stats);

        // Combine all routes with CORS
        let api = health
            .or(search)
            .or(profile)
            .or(following)
            .or(followers)
            .or(stats)
            .or(indexer_stats)
            .with(warp::cors()
                .allow_any_origin()
                .allow_headers(vec!["content-type"])
                .allow_methods(vec!["GET", "POST", "OPTIONS"]));

        let routes = warp::path("api").and(api);

        println!("Starting API server on port {}", self.port);
        warp::serve(routes)
            .run(([0, 0, 0, 0], self.port))
            .await;

        Ok(())
    }
}

/// Helper function to pass indexer to handlers
fn with_indexer(indexer: Arc<Indexer>) -> impl Filter<Extract = (Arc<Indexer>,), Error = Infallible> + Clone {
    warp::any().map(move || indexer.clone())
}

/// Handle search profiles request
async fn handle_search(
    params: SearchParams,
    indexer: Arc<Indexer>,
) -> Result<impl warp::Reply, Infallible> {
    match indexer.search_profiles(&params.q, params.page, params.per_page).await {
        Ok(results) => Ok(warp::reply::with_status(
            warp::reply::json(&ApiResponse::success(results)),
            StatusCode::OK,
        )),
        Err(e) => Ok(warp::reply::with_status(
            warp::reply::json(&ApiResponse::<()>::error(e.to_string())),
            StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

/// Handle get profile request
async fn handle_get_profile(
    pubkey: String,
    indexer: Arc<Indexer>,
) -> Result<impl warp::Reply, Infallible> {
    match indexer.get_profile(&pubkey).await {
        Some(profile) => Ok(warp::reply::with_status(
            warp::reply::json(&ApiResponse::success(profile)),
            StatusCode::OK,
        )),
        None => Ok(warp::reply::with_status(
            warp::reply::json(&ApiResponse::<()>::error("Profile not found".to_string())),
            StatusCode::NOT_FOUND,
        )),
    }
}

/// Handle get following request
async fn handle_get_following(
    pubkey: String,
    params: RelationshipParams,
    indexer: Arc<Indexer>,
) -> Result<impl warp::Reply, Infallible> {
    let following = indexer.get_following(&pubkey, params.limit).await;
    Ok(warp::reply::with_status(
        warp::reply::json(&ApiResponse::success(following)),
        StatusCode::OK,
    ))
}

/// Handle get followers request
async fn handle_get_followers(
    pubkey: String,
    params: RelationshipParams,
    indexer: Arc<Indexer>,
) -> Result<impl warp::Reply, Infallible> {
    let followers = indexer.get_followers(&pubkey, params.limit).await;
    Ok(warp::reply::with_status(
        warp::reply::json(&ApiResponse::success(followers)),
        StatusCode::OK,
    ))
}

/// Handle get relationship stats request
async fn handle_get_stats(
    pubkey: String,
    indexer: Arc<Indexer>,
) -> Result<impl warp::Reply, Infallible> {
    let stats = indexer.get_relationship_stats(&pubkey).await;
    Ok(warp::reply::with_status(
        warp::reply::json(&ApiResponse::success(stats)),
        StatusCode::OK,
    ))
}

/// Handle get indexer stats request
async fn handle_get_indexer_stats(
    indexer: Arc<Indexer>,
) -> Result<impl warp::Reply, Infallible> {
    let stats = indexer.get_stats().await;
    Ok(warp::reply::with_status(
        warp::reply::json(&ApiResponse::success(stats)),
        StatusCode::OK,
    ))
}
