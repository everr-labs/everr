//! Tauri command `telemetry_sql_query` — posts SQL to the local collector.

use anyhow::{anyhow, Context, Result};
use reqwest::StatusCode;
use serde_json::Value;
use std::time::Duration;

use crate::telemetry::ports::SQL_HTTP_PORT;

pub async fn run_query(sql: String) -> Result<Vec<Value>> {
    let url = format!("http://127.0.0.1:{SQL_HTTP_PORT}/sql");
    post_sql(&url, &sql).await
}

async fn post_sql(url: &str, sql: &str) -> Result<Vec<Value>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .context("build reqwest client")?;
    let resp = client
        .post(url)
        .header("content-type", "text/plain")
        .body(sql.to_string())
        .send()
        .await
        .with_context(|| format!("POST {url}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    match status {
        StatusCode::OK => parse_ndjson(&body),
        StatusCode::SERVICE_UNAVAILABLE => {
            Err(anyhow!("telemetry collector is busy — try again in a moment"))
        }
        other => Err(anyhow!("unexpected status {other}: {body}")),
    }
}

fn parse_ndjson(body: &str) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for line in body.lines() {
        if line.is_empty() {
            continue;
        }
        out.push(serde_json::from_str(line).with_context(|| format!("parse row: {line}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn telemetry_sql_query(sql: String) -> Result<Vec<Value>, String> {
    run_query(sql).await.map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn spawn_server(status: u16, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let response = format!(
                "HTTP/1.1 {status} OK\r\ncontent-length: {}\r\ncontent-type: application/x-ndjson\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });
        format!("http://{addr}/sql")
    }

    #[tokio::test]
    async fn parses_ndjson_rows() {
        let url = spawn_server(200, "{\"a\":1}\n{\"a\":2}\n");
        let rows = post_sql(&url, "SELECT 1").await.unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn surfaces_unavailable() {
        let url = spawn_server(503, "");
        let err = post_sql(&url, "SELECT 1").await.unwrap_err();
        assert!(err.to_string().contains("busy"));
    }
}
