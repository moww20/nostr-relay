use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};
use serde::Serialize;

#[derive(Serialize)]
struct ApiResponse<'a, T: Serialize> {
    success: bool,
    data: Option<T>,
    error: Option<&'a str>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

async fn handler(_req: Request) -> Result<Response<Body>, Error> {
    let payload = ApiResponse { success: true, data: Some("OK"), error: None };
    let body = serde_json::to_vec(&payload).unwrap();
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(Body::Binary(body))
        .unwrap())
}