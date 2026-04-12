use serde::Deserialize;

// --- Custom deserializer for string-encoded u64 timestamps ---

pub(crate) fn de_opt_u64_from_str<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<String>::deserialize(deserializer)?;
    raw.map(|s| s.parse::<u64>().map_err(serde::de::Error::custom))
        .transpose()
}

// --- Envelope dispatch ---

#[derive(Deserialize)]
pub(crate) struct RawEnvelope {
    #[serde(rename = "resourceSpans")]
    pub resource_spans: Option<serde_json::Value>,
    #[serde(rename = "resourceLogs")]
    pub resource_logs: Option<serde_json::Value>,
}

/// Result of dispatching a single JSON line.
pub(crate) enum OtlpSignal {
    Traces(ExportTraceServiceRequest),
    Logs(ExportLogsServiceRequest),
}

/// Parse a single line and dispatch to the correct signal type.
/// Returns `None` for malformed lines, unknown signals, or lines with
/// both resourceSpans and resourceLogs (which the collector never emits).
/// Deserializes the full struct from the `Value` already captured by
/// `RawEnvelope` to avoid parsing the JSON string twice.
pub(crate) fn dispatch_line(line: &str) -> Option<OtlpSignal> {
    let envelope: RawEnvelope = serde_json::from_str(line).ok()?;
    match (envelope.resource_spans, envelope.resource_logs) {
        (Some(spans_val), None) => {
            let mut top = serde_json::Map::new();
            top.insert("resourceSpans".into(), spans_val);
            let req: ExportTraceServiceRequest =
                serde_json::from_value(serde_json::Value::Object(top)).ok()?;
            Some(OtlpSignal::Traces(req))
        }
        (None, Some(logs_val)) => {
            let mut top = serde_json::Map::new();
            top.insert("resourceLogs".into(), logs_val);
            let req: ExportLogsServiceRequest =
                serde_json::from_value(serde_json::Value::Object(top)).ok()?;
            Some(OtlpSignal::Logs(req))
        }
        _ => None, // both present, neither present, or malformed
    }
}

// --- Trace structs ---

#[derive(Deserialize)]
pub(crate) struct ExportTraceServiceRequest {
    #[serde(rename = "resourceSpans")]
    pub resource_spans: Vec<ResourceSpans>,
}

#[derive(Deserialize)]
pub(crate) struct ResourceSpans {
    #[serde(default)]
    pub resource: Resource,
    #[serde(rename = "scopeSpans", default)]
    pub scope_spans: Vec<ScopeSpans>,
}

#[derive(Deserialize)]
pub(crate) struct ScopeSpans {
    #[serde(default)]
    pub scope: Scope,
    #[serde(default)]
    pub spans: Vec<Span>,
}

#[derive(Deserialize)]
pub(crate) struct Span {
    #[serde(rename = "traceId", default)]
    pub trace_id: String,
    #[serde(rename = "spanId", default)]
    pub span_id: String,
    #[serde(rename = "parentSpanId", default)]
    pub parent_span_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub kind: u8,
    #[serde(rename = "startTimeUnixNano", default, deserialize_with = "de_opt_u64_from_str")]
    pub start_time_unix_nano: Option<u64>,
    #[serde(rename = "endTimeUnixNano", default, deserialize_with = "de_opt_u64_from_str")]
    pub end_time_unix_nano: Option<u64>,
    #[serde(default)]
    pub status: SpanStatus,
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

#[derive(Deserialize, Default)]
pub(crate) struct SpanStatus {
    #[serde(default)]
    pub code: u8,
}

// --- Log structs ---

#[derive(Deserialize)]
pub(crate) struct ExportLogsServiceRequest {
    #[serde(rename = "resourceLogs")]
    pub resource_logs: Vec<ResourceLogs>,
}

#[derive(Deserialize)]
pub(crate) struct ResourceLogs {
    #[serde(default)]
    pub resource: Resource,
    #[serde(rename = "scopeLogs", default)]
    pub scope_logs: Vec<ScopeLogs>,
}

#[derive(Deserialize)]
pub(crate) struct ScopeLogs {
    #[serde(default)]
    pub scope: Scope,
    #[serde(rename = "logRecords", default)]
    pub log_records: Vec<LogRecord>,
}

#[derive(Deserialize)]
pub(crate) struct LogRecord {
    #[serde(rename = "timeUnixNano", default, deserialize_with = "de_opt_u64_from_str")]
    pub time_unix_nano: Option<u64>,
    #[serde(rename = "observedTimeUnixNano", default, deserialize_with = "de_opt_u64_from_str")]
    pub observed_time_unix_nano: Option<u64>,
    #[serde(rename = "severityText", default)]
    pub severity_text: String,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    #[serde(rename = "traceId", default)]
    pub trace_id: String,
    #[serde(rename = "spanId", default)]
    pub span_id: String,
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

// --- Shared types ---

#[derive(Deserialize, Default, Clone)]
pub(crate) struct Resource {
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

#[derive(Deserialize, Default, Clone)]
pub(crate) struct Scope {
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct KeyValue {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
}

// --- Helpers ---

pub(crate) fn resolve_log_timestamp(time: Option<u64>, observed: Option<u64>) -> u64 {
    match time {
        Some(t) if t > 0 => t,
        _ => observed.unwrap_or(0),
    }
}

/// Extract a string attribute value from a KeyValue list.
pub fn kv_str<'a>(kvs: &'a [KeyValue], key: &str) -> Option<&'a str> {
    kvs.iter()
        .find(|kv| kv.key == key)
        .and_then(|kv| kv.value.as_ref())
        .and_then(|v| v.get("stringValue"))
        .and_then(|v| v.as_str())
}

/// Extract the body string from an OTLP log record body value.
pub(crate) fn body_string(body: &Option<serde_json::Value>) -> String {
    match body {
        Some(v) => v
            .get("stringValue")
            .and_then(|s| s.as_str())
            .map(String::from)
            .unwrap_or_else(|| v.to_string()),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn de_opt_u64_from_str_parses_nanosecond_string() {
        #[derive(Deserialize)]
        struct T {
            #[serde(default, deserialize_with = "de_opt_u64_from_str")]
            ts: Option<u64>,
        }
        let t: T = serde_json::from_str(r#"{"ts":"1700000000000000000"}"#).unwrap();
        assert_eq!(t.ts, Some(1700000000000000000));
    }

    #[test]
    fn de_opt_u64_from_str_returns_none_when_absent() {
        #[derive(Deserialize)]
        struct T {
            #[serde(default, deserialize_with = "de_opt_u64_from_str")]
            ts: Option<u64>,
        }
        let t: T = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(t.ts, None);
    }

    #[test]
    fn dispatch_line_trace_envelope() {
        let line = r#"{"resourceSpans":[{"resource":{"attributes":[]},"scopeSpans":[]}]}"#;
        assert!(matches!(dispatch_line(line), Some(OtlpSignal::Traces(_))));
    }

    #[test]
    fn dispatch_line_log_envelope() {
        let line = r#"{"resourceLogs":[{"resource":{"attributes":[]},"scopeLogs":[]}]}"#;
        assert!(matches!(dispatch_line(line), Some(OtlpSignal::Logs(_))));
    }

    #[test]
    fn dispatch_line_unknown_signal_returns_none() {
        let line = r#"{"resourceMetrics":[{}]}"#;
        assert!(dispatch_line(line).is_none());
    }

    #[test]
    fn dispatch_line_both_signals_returns_none() {
        let line = r#"{"resourceSpans":[],"resourceLogs":[]}"#;
        assert!(dispatch_line(line).is_none(), "both present → skip as malformed");
    }

    #[test]
    fn dispatch_line_log_not_misclassified_as_traces() {
        let line = r#"{"resourceLogs":[{"resource":{"attributes":[]},"scopeLogs":[]}]}"#;
        assert!(matches!(dispatch_line(line), Some(OtlpSignal::Logs(_))));
    }

    #[test]
    fn resolve_log_timestamp_prefers_time_when_nonzero() {
        assert_eq!(resolve_log_timestamp(Some(100), Some(200)), 100);
    }

    #[test]
    fn resolve_log_timestamp_falls_back_to_observed() {
        assert_eq!(resolve_log_timestamp(None, Some(200)), 200);
        assert_eq!(resolve_log_timestamp(Some(0), Some(200)), 200);
    }

    #[test]
    fn resolve_log_timestamp_returns_zero_when_both_absent() {
        assert_eq!(resolve_log_timestamp(None, None), 0);
    }

    #[test]
    fn deserialize_real_trace_fixture_line() {
        let line = r#"{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test-service"}}]},"scopeSpans":[{"scope":{"name":"test-scope"},"spans":[{"traceId":"0102030405060708090a0b0c0d0e0f10","spanId":"1112131415161718","name":"test.span.ok","kind":1,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000001000000000","status":{"code":1}}]}]}]}"#;
        let req: ExportTraceServiceRequest = serde_json::from_str(line).unwrap();
        let span = &req.resource_spans[0].scope_spans[0].spans[0];
        assert_eq!(span.trace_id, "0102030405060708090a0b0c0d0e0f10");
        assert_eq!(span.start_time_unix_nano, Some(1700000000000000000));
        assert_eq!(span.end_time_unix_nano, Some(1700000001000000000));
        assert_eq!(span.kind, 1);
        assert_eq!(span.status.code, 1);
    }

    #[test]
    fn deserialize_real_log_fixture_line() {
        let line = r#"{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test-service"}}]},"scopeLogs":[{"scope":{"name":"test-scope"},"logRecords":[{"timeUnixNano":"1700000000000000000","severityNumber":9,"severityText":"INFO","body":{"stringValue":"test log message info"},"traceId":"0102030405060708090a0b0c0d0e0f10","spanId":"1112131415161718"}]}]}]}"#;
        let req: ExportLogsServiceRequest = serde_json::from_str(line).unwrap();
        let record = &req.resource_logs[0].scope_logs[0].log_records[0];
        assert_eq!(record.time_unix_nano, Some(1700000000000000000));
        assert_eq!(record.severity_text, "INFO");
        assert_eq!(body_string(&record.body), "test log message info");
        assert_eq!(record.trace_id, "0102030405060708090a0b0c0d0e0f10");
    }

    #[test]
    fn kv_str_extracts_string_attribute() {
        let kvs = vec![KeyValue {
            key: "service.name".into(),
            value: Some(serde_json::json!({"stringValue": "my-app"})),
        }];
        assert_eq!(kv_str(&kvs, "service.name"), Some("my-app"));
        assert_eq!(kv_str(&kvs, "missing"), None);
    }
}
