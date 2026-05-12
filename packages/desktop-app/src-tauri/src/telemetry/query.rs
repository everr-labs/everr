//! Tauri command `telemetry_sql_query` — posts SQL to the local collector.

use anyhow::{anyhow, Context, Result};
use reqwest::StatusCode;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

use crate::telemetry::ports::SQL_HTTP_PORT;

pub async fn run_query(sql: String, params: HashMap<String, Value>) -> Result<Vec<Value>> {
    run_query_against(&default_url(), &sql, &params).await
}

fn default_url() -> String {
    format!("http://127.0.0.1:{SQL_HTTP_PORT}/sql")
}

async fn run_query_against(
    url: &str,
    sql: &str,
    params: &HashMap<String, Value>,
) -> Result<Vec<Value>> {
    post_sql(url, sql, params).await
}

async fn post_sql(
    url: &str,
    sql: &str,
    params: &HashMap<String, Value>,
) -> Result<Vec<Value>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .context("build reqwest client")?;
    let query: Vec<(String, String)> = params
        .iter()
        .map(|(name, value)| (format!("param_{name}"), value.to_string()))
        .collect();
    let resp = client
        .post(url)
        .query(&query)
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
pub async fn telemetry_sql_query(
    sql: String,
    params: Option<HashMap<String, Value>>,
) -> Result<Vec<Value>, String> {
    run_query(sql, params.unwrap_or_default())
        .await
        .map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn spawn_server(status: u16, body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let _ = tx.send(String::from_utf8_lossy(&buf[..n]).to_string());
            let response = format!(
                "HTTP/1.1 {status} OK\r\ncontent-length: {}\r\ncontent-type: application/x-ndjson\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });
        (format!("http://{addr}/sql"), rx)
    }

    #[tokio::test]
    async fn parses_ndjson_rows() {
        let (url, _) = spawn_server(200, "{\"a\":1}\n{\"a\":2}\n");
        let rows = post_sql(&url, "SELECT 1", &HashMap::new()).await.unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn surfaces_unavailable() {
        let (url, _) = spawn_server(503, "");
        let err = post_sql(&url, "SELECT 1", &HashMap::new()).await.unwrap_err();
        assert!(err.to_string().contains("busy"));
    }

    #[tokio::test]
    async fn run_query_against_url_returns_rows() {
        let (url, _) = spawn_server(200, "{\"x\":1}\n");
        let rows = run_query_against(&url, "SELECT 1", &HashMap::new())
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn sends_params_as_json_query_string() {
        let (url, rx) = spawn_server(200, "{}\n");
        let mut params = HashMap::new();
        params.insert("q".to_string(), Value::String("hello".to_string()));
        params.insert(
            "levels".to_string(),
            Value::Array(vec![Value::String("error".to_string())]),
        );
        let _ = post_sql(&url, "SELECT 1", &params).await.unwrap();
        let request_line = rx.recv().unwrap();
        assert!(request_line.contains("param_q="), "request: {request_line}");
        assert!(
            request_line.contains("param_levels="),
            "request: {request_line}"
        );
        // String values are JSON-encoded (quoted) on the wire.
        assert!(
            request_line.contains("%22hello%22"),
            "request: {request_line}"
        );
    }
}
