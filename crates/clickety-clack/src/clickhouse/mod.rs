use crate::domain::ids::TenantId;
use async_trait::async_trait;
use std::collections::BTreeMap;
use std::sync::Arc;
use thiserror::Error;

mod auth;
pub use auth::*;

#[derive(Debug, Error)]
pub enum ChError {
    #[error("http: {0}")]
    Http(String),
    #[error("clickhouse returned status {0}: {1}")]
    Status(u16, String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

/// Percent-encode a query parameter value (RFC 3986 unreserved kept; everything
/// else -> %XX). Small and dependency-free; ClickHouse param values are short.
fn encode_param(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for b in v.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Append ClickHouse named query parameters (`param_<name>=<value>`) and execution
/// settings to a URL.
///
/// Settings belong in the query string, not a header: ClickHouse has no settings header,
/// so an `X-ClickHouse-Settings` header is accepted by the HTTP layer and silently
/// dropped, leaving every cost cap and `readonly=1` unenforced. Keys are encoded as well
/// as values so a key can never smuggle a second `&`-separated parameter.
pub fn build_query_url(
    base_url: &str,
    params: &[(String, String)],
    settings: &[(&str, &str)],
) -> String {
    if params.is_empty() && settings.is_empty() {
        return base_url.to_string();
    }
    let mut url = String::from(base_url);
    let mut sep = if base_url.contains('?') { '&' } else { '?' };
    let mut push = |url: &mut String, k: &str, v: &str| {
        url.push(sep);
        sep = '&';
        url.push_str(&encode_param(k));
        url.push('=');
        url.push_str(&encode_param(v));
    };
    for (k, v) in params {
        push(&mut url, &format!("param_{k}"), v);
    }
    for (k, v) in settings {
        push(&mut url, k, v);
    }
    url
}

/// Append the output format to rule SQL.
///
/// A naive `{sql} FORMAT JSONEachRow` is broken by two shapes of otherwise valid SQL that
/// the guard accepts. If the last line ends in a `--` comment the clause is swallowed,
/// ClickHouse answers in TabSeparated, and `parse_rows` reads an empty body as zero rows:
/// the rule then resolves normally and errors out only when rows appear, so it can never
/// fire. A trailing `;` makes the clause a second statement ("Multi-statements are not
/// allowed") and fails every evaluation. The newline defeats the first, dropping the
/// terminator the second.
fn with_output_format(sql: &str) -> String {
    let trimmed = sql.trim_end().trim_end_matches(';').trim_end();
    format!("{trimmed}\nFORMAT JSONEachRow")
}

/// Crate-wide redacted summary of a `ChError`, safe for any everr-internal sink: span
/// attributes (the `clickhouse.query` span's `otel.status_message`) and log records that
/// reach the OTLP log bridge, both of which land in everr's INTERNAL tenant. `ChError`'s
/// `Display` (used everywhere else, e.g. Postgres `last_error`) is deliberately left
/// untouched: callers there rely on the full text. But `Status`'s body is the raw
/// ClickHouse HTTP response, and ClickHouse echoes fragments of the offending query in its
/// syntax/semantic error messages; since rule SQL is customer-authored, that body must
/// never reach a span attribute or a log line. `Json` only wraps `serde_json::Deserializer`
/// errors over an untyped `Map<String, Value>` (see `parse_rows`), so it's a position-only
/// syntax error ("expected value at line 1 column 1") that can't embed row content, and
/// `Http` is a transport error with the request URL already stripped, so both keep their
/// normal `Display`.
pub(crate) fn span_error_summary(e: &ChError) -> String {
    match e {
        ChError::Status(code, _) => format!("clickhouse http status {code}"),
        ChError::Http(_) | ChError::Json(_) => e.to_string(),
    }
}

impl From<reqwest::Error> for ChError {
    /// `without_url()` drops the request URL (which may embed `user:pass@host`) so a
    /// transport error can never carry credentials into a stored `last_error`.
    fn from(e: reqwest::Error) -> Self {
        ChError::Http(e.without_url().to_string())
    }
}

#[derive(Clone)]
pub struct ChClient {
    http: reqwest::Client,
    base_url: String,
    auth: Arc<dyn ChAuthProvider>,
    /// Engine self-observability (`cc.eval.duration` stage=query, `cc.eval.errors`
    /// kind=query). Disabled by default; `main` attaches it to the evaluator's clone
    /// only, so API-driven queries never count as evaluations.
    metrics: crate::otel::EngineMetrics,
}

/// One result row reduced to label strings + optional numeric value, plus the remaining
/// columns as raw JSON (`extra`) so the evaluator can attach bounded evidence to events.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ResultRow {
    pub labels: BTreeMap<String, String>,
    pub value: Option<f64>,
    /// Every column NOT in `label_columns`, as returned by ClickHouse. The value column
    /// (when configured) is included here too. Uncapped: evidence caps are applied by
    /// the consumer (the evaluator), not at parse time.
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl ChClient {
    pub fn new(base_url: impl Into<String>, auth: Arc<dyn ChAuthProvider>) -> Self {
        // `max_execution_time` (sqlguard, 10s) only bounds a query ClickHouse is
        // actually running; a stalled connect or response would otherwise hang an
        // evaluator worker indefinitely. 30s leaves headroom for queueing plus the
        // transfer of a max_result_bytes-capped body.
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("static reqwest client config is valid");
        Self {
            http,
            base_url: base_url.into(),
            auth,
            metrics: crate::otel::EngineMetrics::disabled(),
        }
    }

    /// Attach the engine-metrics handle so every `query_rows` round-trip is measured.
    pub fn with_engine_metrics(mut self, metrics: crate::otel::EngineMetrics) -> Self {
        self.metrics = metrics;
        self
    }

    /// Run a validated SELECT, returning each row as labels + value.
    /// `label_columns` decide identity; `value_column` (if any) is parsed as f64.
    ///
    /// Records `cc.eval.duration` (stage=query) with a success/error outcome around the
    /// whole round-trip (HTTP + body + parse) when engine metrics are attached.
    pub async fn query_rows(
        &self,
        tenant: &TenantId,
        sql: &str,
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        self.query_rows_params(tenant, sql, &[], label_columns, value_column)
            .await
    }

    /// Like `query_rows`, but binds `params` as ClickHouse named query parameters
    /// (`{name:Type}` placeholders in `sql`), sent as `param_<name>=<value>` query-string
    /// entries per ClickHouse's HTTP interface.
    ///
    /// One span (`clickhouse.query`) covers the whole HTTP + parse round-trip; `query_rows`
    /// delegates into this, so callers never see the round-trip double-spanned. The SQL text
    /// is deliberately NOT recorded on the span (customer content).
    #[tracing::instrument(
        name = "clickhouse.query",
        skip_all,
        fields(
            tenant = %tenant,
            rows = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
            otel.status_message = tracing::field::Empty,
        )
    )]
    pub async fn query_rows_params(
        &self,
        tenant: &TenantId,
        sql: &str,
        params: &[(String, String)],
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        let started = std::time::Instant::now();
        let result = self
            .query_rows_inner(tenant, sql, params, label_columns, value_column)
            .await;
        let outcome = match &result {
            Ok(_) => crate::otel::metrics::QueryOutcome::Success,
            Err(_) => crate::otel::metrics::QueryOutcome::Error,
        };
        self.metrics
            .record_eval_query(started.elapsed().as_secs_f64(), tenant.as_str(), outcome);
        match result {
            Ok(rows) => {
                tracing::Span::current().record("rows", rows.len());
                Ok(rows)
            }
            Err(e) => {
                crate::otel::span_error(&span_error_summary(&e));
                Err(e)
            }
        }
    }

    async fn query_rows_inner(
        &self,
        tenant: &TenantId,
        sql: &str,
        params: &[(String, String)],
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        let auth = self.auth.resolve(tenant);
        let settings = if auth.server_enforced_limits {
            crate::sqlguard::resource_limit_settings_no_readonly()
        } else {
            crate::sqlguard::resource_limit_settings()
        };
        let url = build_query_url(&self.base_url, params, settings);
        let mut req = self
            .http
            .post(url)
            .header("X-ClickHouse-User", &auth.user)
            .header("X-ClickHouse-Key", &auth.key)
            .body(with_output_format(sql));
        if let Some(q) = &auth.quota {
            req = req.header("X-ClickHouse-Quota", q);
        }
        let resp = req.send().await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(ChError::Status(status.as_u16(), text));
        }

        parse_rows(&text, label_columns, value_column)
    }
}

/// Parse a JSONEachRow body into rows. Streams values from the buffered text with
/// `serde_json::Deserializer`, avoiding an intermediate line split. Produces the same
/// `ResultRow`s as the prior line-by-line parse. Public for benchmarking; not a stable API.
pub fn parse_rows(
    text: &str,
    label_columns: &[String],
    value_column: Option<&str>,
) -> Result<Vec<ResultRow>, ChError> {
    let mut rows = Vec::new();
    let stream = serde_json::Deserializer::from_str(text)
        .into_iter::<serde_json::Map<String, serde_json::Value>>();
    for obj in stream {
        let obj = obj?;
        let mut labels = BTreeMap::new();
        for col in label_columns {
            if let Some(v) = obj.get(col) {
                labels.insert(col.clone(), json_to_string(v));
            }
        }
        let value = value_column.and_then(|c| obj.get(c)).and_then(json_to_f64);
        let extra: BTreeMap<String, serde_json::Value> = obj
            .into_iter()
            .filter(|(k, _)| !label_columns.contains(k))
            .collect();
        rows.push(ResultRow {
            labels,
            value,
            extra,
        });
    }
    Ok(rows)
}

/// The row-query seam the evaluator depends on. Implemented by [`ChClient`] in production
/// and by a counting double in tests, so coalescing (one query per identical signature)
/// can be asserted without a live ClickHouse.
#[async_trait]
pub trait RowQuerier: Send + Sync {
    /// Bind `params` as ClickHouse named query parameters. Implementors that don't need
    /// binding (e.g. test doubles) may ignore `params`.
    async fn query_rows_params(
        &self,
        tenant: &TenantId,
        sql: &str,
        params: &[(String, String)],
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError>;

    async fn query_rows(
        &self,
        tenant: &TenantId,
        sql: &str,
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        self.query_rows_params(tenant, sql, &[], label_columns, value_column)
            .await
    }

    /// Coalescing identity for `tenant` — equal identity ⇒ shareable round-trip.
    fn auth_identity(&self, tenant: &TenantId) -> AuthIdentity;
}

#[async_trait]
impl RowQuerier for ChClient {
    async fn query_rows_params(
        &self,
        tenant: &TenantId,
        sql: &str,
        params: &[(String, String)],
        label_columns: &[String],
        value_column: Option<&str>,
    ) -> Result<Vec<ResultRow>, ChError> {
        ChClient::query_rows_params(self, tenant, sql, params, label_columns, value_column).await
    }

    fn auth_identity(&self, tenant: &TenantId) -> AuthIdentity {
        self.auth.auth_identity_of(tenant)
    }
}

fn json_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

pub(crate) fn json_to_f64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_query_url_appends_ch_params() {
        assert_eq!(
            build_query_url("http://ch:8123/", &[], &[]),
            "http://ch:8123/"
        );
        let url = build_query_url(
            "http://ch:8123/",
            &[("window_start".into(), "2026-07-17 00:00:00".into())],
            &[],
        );
        assert_eq!(
            url,
            "http://ch:8123/?param_window_start=2026-07-17%2000%3A00%3A00"
        );
        let url = build_query_url(
            "http://ch:8123/",
            &[("a".into(), "1".into()), ("b".into(), "x/y".into())],
            &[],
        );
        assert_eq!(url, "http://ch:8123/?param_a=1&param_b=x%2Fy");
        assert_eq!(
            build_query_url(
                "http://ch:8123/?database=d",
                &[("a".into(), "1".into())],
                &[]
            ),
            "http://ch:8123/?database=d&param_a=1",
        );
    }

    #[test]
    fn build_query_url_appends_settings_after_params() {
        assert_eq!(
            build_query_url("http://ch:8123/", &[], &[("readonly", "1")]),
            "http://ch:8123/?readonly=1",
        );
        assert_eq!(
            build_query_url(
                "http://ch:8123/?database=d",
                &[("a".into(), "1".into())],
                &[("max_execution_time", "10"), ("readonly", "1")],
            ),
            "http://ch:8123/?database=d&param_a=1&max_execution_time=10&readonly=1",
        );
    }

    /// A param name is a rule-authored label column, so it must not be able to close its
    /// own parameter and open another (e.g. a second `query=`, which ClickHouse would
    /// prepend to the POST body).
    #[test]
    fn build_query_url_encodes_param_names() {
        let url = build_query_url(
            "http://ch:8123/",
            &[("a&query=SELECT".into(), "1".into())],
            &[],
        );
        assert_eq!(url, "http://ch:8123/?param_a%26query%3DSELECT=1");
    }

    #[test]
    fn output_format_survives_a_trailing_line_comment() {
        // Same line: without the newline the clause lands inside the comment and
        // ClickHouse answers in TabSeparated, which parses as zero rows forever.
        assert_eq!(
            with_output_format("SELECT 1 AS n -- daily note"),
            "SELECT 1 AS n -- daily note\nFORMAT JSONEachRow"
        );
        assert_eq!(
            with_output_format("SELECT 1 AS n\n-- trailing note\n"),
            "SELECT 1 AS n\n-- trailing note\nFORMAT JSONEachRow"
        );
    }

    #[test]
    fn output_format_drops_a_trailing_terminator() {
        for sql in ["SELECT 1;", "SELECT 1 ;", "SELECT 1;;", "SELECT 1;\n"] {
            assert_eq!(with_output_format(sql), "SELECT 1\nFORMAT JSONEachRow");
        }
    }
}

#[cfg(test)]
mod parse_tests {
    use super::*;

    #[test]
    fn parses_jsoneachrow_into_labels_and_value() {
        let body = "{\"svc\":\"api\",\"v\":1.5}\n{\"svc\":\"web\",\"v\":\"2\"}\n\n";
        let rows = parse_rows(body, &["svc".to_string()], Some("v")).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].labels.get("svc").unwrap(), "api");
        assert_eq!(rows[0].value, Some(1.5));
        assert_eq!(rows[1].value, Some(2.0));
    }

    #[test]
    fn missing_label_column_is_absent_not_error() {
        let body = "{\"other\":\"x\"}";
        let rows = parse_rows(body, &["svc".to_string()], None).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].labels.is_empty());
        assert_eq!(rows[0].value, None);
    }

    /// Extra data preserves non-label columns, including the value column.
    #[test]
    fn extra_excludes_labels_and_includes_value_column() {
        let body = "{\"svc\":\"api\",\"v\":1.5,\"errors\":7,\"sample\":{\"path\":\"/x\"}}";
        let rows = parse_rows(body, &["svc".to_string()], Some("v")).unwrap();
        assert_eq!(rows.len(), 1);
        let extra = &rows[0].extra;
        assert!(!extra.contains_key("svc"), "label columns excluded");
        assert_eq!(extra.get("v"), Some(&serde_json::json!(1.5)));
        assert_eq!(extra.get("errors"), Some(&serde_json::json!(7)));
        assert_eq!(
            extra.get("sample"),
            Some(&serde_json::json!({"path": "/x"}))
        );
    }
}

#[cfg(test)]
mod error_scrub_tests {
    use super::*;

    #[tokio::test]
    async fn transport_error_string_excludes_url_and_creds() {
        let auth = crate::clickhouse::build_ch_auth("shared", "default", "", None, None, "", None)
            .unwrap();
        let ch = ChClient::new("http://user:supersecret@127.0.0.1:1", auth);
        let t = crate::domain::ids::TenantId::from_trusted("t".to_string());
        let err = ch.query_rows(&t, "SELECT 1", &[], None).await.unwrap_err();
        let s = err.to_string();
        assert!(!s.contains("supersecret"), "leaked creds: {s}");
        assert!(!s.contains("127.0.0.1:1"), "leaked url: {s}");
    }

    /// Span summaries omit response bodies that may echo customer SQL.
    #[test]
    fn status_error_summary_drops_body_keeps_status() {
        let e = ChError::Status(
            400,
            "Syntax error: failed at position 42: SELECT secret FROM t".into(),
        );
        let s = span_error_summary(&e);
        assert!(!s.contains("SELECT"), "leaked query text: {s}");
        assert!(!s.contains("secret"), "leaked query text: {s}");
        assert!(s.contains("400"), "missing status code: {s}");
    }
}
