use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use reqwest::StatusCode;
use reqwest::blocking::Client;
use serde_json::Value;

#[derive(Debug)]
pub struct Rows {
    pub values: Vec<Value>,
}

pub struct QueryClient {
    origin: String,
    http: Client,
}

impl QueryClient {
    pub fn new(origin: String) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client");
        Self { origin, http }
    }

    /// Run a SQL query. Retries once on 503 after the server's Retry-After.
    pub fn query(&self, sql: &str) -> Result<Rows> {
        let url = format!("{}/sql", self.origin);
        let mut attempt = 0;

        loop {
            let resp = self
                .http
                .post(&url)
                .header("content-type", "text/plain")
                .body(sql.to_string())
                .send()
                .with_context(|| format!("POST {url}"))?;

            let status = resp.status();
            if status == StatusCode::SERVICE_UNAVAILABLE && attempt == 0 {
                let retry = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(1);
                std::thread::sleep(Duration::from_secs(retry));
                attempt += 1;
                continue;
            }

            let body = resp.text().unwrap_or_default();
            return match status {
                StatusCode::OK => parse_ndjson(&body),
                StatusCode::SERVICE_UNAVAILABLE => {
                    bail!("telemetry collector is busy — try again in a moment")
                }
                StatusCode::BAD_REQUEST
                | StatusCode::INTERNAL_SERVER_ERROR
                | StatusCode::PAYLOAD_TOO_LARGE => Err(anyhow!("{}", pass_through(&body))),
                other => Err(anyhow!("unexpected status {other}: {body}")),
            };
        }
    }
}

fn parse_ndjson(body: &str) -> Result<Rows> {
    let mut values = Vec::new();
    for line in body.lines() {
        if line.is_empty() {
            continue;
        }
        values.push(serde_json::from_str(line).with_context(|| format!("parse row: {line}"))?);
    }
    Ok(Rows { values })
}

fn pass_through(body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        if let Some(msg) = v.get("error").and_then(|e| e.as_str()) {
            return msg.to_string();
        }
    }
    body.to_string()
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};

    use super::*;

    #[derive(Clone)]
    struct TestResponse {
        status: u16,
        headers: &'static [(&'static str, &'static str)],
        body: &'static str,
    }

    #[test]
    fn query_parses_ndjson_rows() {
        let origin = spawn_server(vec![TestResponse {
            status: 200,
            headers: &[("content-type", "application/x-ndjson")],
            body: "{\"a\":1}\n{\"a\":2}\n",
        }]);
        let cli = QueryClient::new(origin);
        let rows = cli.query("SELECT *").unwrap();
        assert_eq!(rows.values.len(), 2);
        assert_eq!(rows.values[0].get("a").unwrap(), &Value::Number(1.into()));
    }

    #[test]
    fn query_surfaces_error_envelope() {
        let origin = spawn_server(vec![TestResponse {
            status: 400,
            headers: &[],
            body: r#"{"error":"bad sql"}"#,
        }]);
        let cli = QueryClient::new(origin);
        let err = cli.query("bogus").unwrap_err();
        assert!(err.to_string().contains("bad sql"));
    }

    #[test]
    fn query_retries_once_on_503() {
        let origin = spawn_server(vec![
            TestResponse {
                status: 503,
                headers: &[("retry-after", "0")],
                body: r#"{"error":"collector starting"}"#,
            },
            TestResponse {
                status: 200,
                headers: &[("content-type", "application/x-ndjson")],
                body: "{\"ok\":1}\n",
            },
        ]);
        let cli = QueryClient::new(origin);
        let rows = cli.query("SELECT 1").unwrap();
        assert_eq!(rows.values.len(), 1);
        assert_eq!(rows.values[0].get("ok").unwrap(), &Value::Number(1.into()));
    }

    fn spawn_server(responses: Vec<TestResponse>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                read_request(&mut stream);
                write_response(&mut stream, &response);
            }
        });
        format!("http://{}", addr)
    }

    fn read_request(stream: &mut TcpStream) {
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .expect("set read timeout");

        let mut buf = Vec::new();
        let mut chunk = [0_u8; 1024];
        let mut header_len = None;

        while header_len.is_none() {
            let read = stream.read(&mut chunk).expect("read request");
            if read == 0 {
                return;
            }
            buf.extend_from_slice(&chunk[..read]);
            header_len = find_header_end(&buf);
        }

        let header_len = header_len.unwrap();
        let header_text = String::from_utf8_lossy(&buf[..header_len]);
        let content_length = header_text
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.eq_ignore_ascii_case("content-length") {
                    return value.trim().parse::<usize>().ok();
                }
                None
            })
            .unwrap_or(0);

        let body_read = buf.len().saturating_sub(header_len + 4);
        if body_read >= content_length {
            return;
        }

        let mut remaining = content_length - body_read;
        while remaining > 0 {
            let read = stream.read(&mut chunk).expect("read request body");
            if read == 0 {
                break;
            }
            remaining = remaining.saturating_sub(read);
        }
    }

    fn find_header_end(buf: &[u8]) -> Option<usize> {
        buf.windows(4).position(|w| w == b"\r\n\r\n")
    }

    fn write_response(stream: &mut TcpStream, response: &TestResponse) {
        let mut head = format!(
            "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: close\r\n",
            response.status,
            reason_phrase(response.status),
            response.body.len()
        );
        for (name, value) in response.headers {
            head.push_str(name);
            head.push_str(": ");
            head.push_str(value);
            head.push_str("\r\n");
        }
        head.push_str("\r\n");
        stream.write_all(head.as_bytes()).expect("write response head");
        stream
            .write_all(response.body.as_bytes())
            .expect("write response body");
    }

    fn reason_phrase(status: u16) -> &'static str {
        match status {
            200 => "OK",
            400 => "Bad Request",
            413 => "Payload Too Large",
            500 => "Internal Server Error",
            503 => "Service Unavailable",
            _ => "OK",
        }
    }
}
