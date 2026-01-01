use axum::{routing::get, Router, Json};
use std::net::SocketAddr;
use aimds_rust::VectorEngine;
use serde_json::{json, Value};

#[tokio::main]
async fn main() {
    // 1. Initialize the AI Engine
    println!("Initializing Vector Engine...");
    let engine = VectorEngine::new().expect("Failed to start engine");
    
    // 2. Define the Test Route
    // When we visit '/', it will try to embed the text "Hello AI"
    let app = Router::new().route("/", get(|| async {
        let engine = VectorEngine::new().unwrap(); // In prod, we'd share this instance
        match engine.embed("Hello AI World") {
            Ok(vec) => Json(json!({ 
                "status": "online", 
                "vector_dim": vec.len(), 
                "sample": &vec[0..5] 
            })),
            Err(e) => Json(json!({ "error": e.to_string() }))
        }
    }));

    // 3. Start the Server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    println!("AIMDS AI Node Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
