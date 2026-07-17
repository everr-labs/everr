//! `everr local errors list|show` — Errors surveyed from the local collector's
//! telemetry. There is no server to reuse here (unlike the cloud commands), so
//! this groups Errors by running the errors SQL directly against the
//! collector's ClickHouse SQL endpoint.
//!
//! What defines an Error's identity — the fingerprint expression and the
//! exception-log filter — is `include_str!`-ed from `.sql` fragments shared
//! with telemetry-explorer, and a Vitest test asserts `fingerprint.ts` stays
//! byte-equal to them, so local can't fingerprint Errors differently from the
//! web/desktop surfaces. The aggregation and projection around that kernel are
//! mirrored by hand from issues.ts; they can't be shared verbatim (the app's
//! queries carry triage/search/attribute filters local has no equivalent for),
//! so keep the two in step when either changes.

use std::time::SystemTime;

use anyhow::{Context, Result};
use everr_core::api::{ErrorIssueDetail, ErrorIssueSummary, ErrorOccurrence};

use crate::cli::{ErrorSortArg, ErrorsListArgs, ErrorsShowArgs, ErrorsSubcommand};
use crate::errors_render::{print_error_detail, print_errors_list};
use crate::telemetry::client::QueryClient;
use crate::telemetry::commands::query_rows;

// Reference fragments co-located with the TS source (telemetry-explorer); a
// Vitest test asserts fingerprint.ts stays byte-equal to them.
const FINGERPRINT_SQL: &str =
    include_str!("../../../telemetry-explorer/src/errors/sql/fingerprint.sql");
const EXCEPTION_LOG_FILTER_SQL: &str =
    include_str!("../../../telemetry-explorer/src/errors/sql/exception_log_filter.sql");

const TABLE: &str = "logs";
const DEFAULT_FROM: &str = "now-7d";
const DEFAULT_TO: &str = "now";
const DEFAULT_LIMIT: u32 = 50;
const DEFAULT_OCCURRENCE_LIMIT: u32 = 50;

pub fn run(cmd: ErrorsSubcommand) -> Result<()> {
    let client = QueryClient::new(everr_core::build::sql_http_origin());
    match cmd {
        ErrorsSubcommand::List(args) => list(&client, args),
        ErrorsSubcommand::Show(args) => show(&client, args),
    }
}

fn list(client: &QueryClient, args: ErrorsListArgs) -> Result<()> {
    let range = TimeRange::resolve(args.from.as_deref(), args.to.as_deref())?;
    let sql = summary_sql(
        &range,
        &args.service,
        None,
        args.sort.unwrap_or(ErrorSortArg::LastSeen),
        args.limit.unwrap_or(DEFAULT_LIMIT),
        args.offset.unwrap_or(0),
    );
    let issues = fetch_summaries(client, &sql)?;
    print_errors_list(&issues, args.json)
}

fn show(client: &QueryClient, args: ErrorsShowArgs) -> Result<()> {
    let range = TimeRange::resolve(args.from.as_deref(), args.to.as_deref())?;
    let occurrence_limit = args.occurrences.unwrap_or(DEFAULT_OCCURRENCE_LIMIT);

    // Mirrors ErrorsRepository.getIssue: a one-row summary for the Fingerprint,
    // plus its Occurrences (latest first). The latest Occurrence carries the
    // stacktrace the human view prints.
    let summary_sql = summary_sql(
        &range,
        &[],
        Some(&args.fingerprint),
        ErrorSortArg::LastSeen,
        1,
        0,
    );
    let occurrences_sql = occurrences_sql(&range, &args.fingerprint, occurrence_limit);

    let summary = fetch_summaries(client, &summary_sql)?
        .into_iter()
        .next()
        .ok_or_else(|| not_found(&args.fingerprint, &range))?;
    let occurrences = fetch_occurrences(client, &occurrences_sql)?;
    let latest = occurrences
        .first()
        .cloned()
        .ok_or_else(|| not_found(&args.fingerprint, &range))?;

    let detail = ErrorIssueDetail {
        summary,
        latest,
        occurrences,
    };
    print_error_detail(&detail, args.json, None)
}

fn not_found(fingerprint: &str, range: &TimeRange) -> anyhow::Error {
    anyhow::anyhow!(
        "No Error with Fingerprint {fingerprint} in the {}..{} time range.",
        range.from_label,
        range.to_label
    )
}

fn fetch_summaries(client: &QueryClient, sql: &str) -> Result<Vec<ErrorIssueSummary>> {
    query_rows(client, sql)?
        .values
        .into_iter()
        .map(|row| serde_json::from_value(row).context("failed to parse Error summary row"))
        .collect()
}

fn fetch_occurrences(client: &QueryClient, sql: &str) -> Result<Vec<ErrorOccurrence>> {
    query_rows(client, sql)?
        .values
        .into_iter()
        .map(|row| serde_json::from_value(row).context("failed to parse Occurrence row"))
        .collect()
}

/// A resolved time window: concrete ClickHouse timestamps for the SQL, plus the
/// original datemath labels for the not-found message.
struct TimeRange {
    from_ts: String,
    to_ts: String,
    from_label: String,
    to_label: String,
}

impl TimeRange {
    fn resolve(from: Option<&str>, to: Option<&str>) -> Result<Self> {
        let from_label = from.unwrap_or(DEFAULT_FROM).to_string();
        let to_label = to.unwrap_or(DEFAULT_TO).to_string();
        // One `now` for both bounds so `now-7d` and `now` stay consistent.
        let now = SystemTime::now();
        Ok(Self {
            from_ts: resolve_clickhouse_ts(&from_label, now)?,
            to_ts: resolve_clickhouse_ts(&to_label, now)?,
            from_label,
            to_label,
        })
    }
}

fn resolve_clickhouse_ts(expression: &str, now: SystemTime) -> Result<String> {
    let resolved = everr_core::datemath::resolve(expression, now)
        .map_err(|err| anyhow::anyhow!("invalid time value '{expression}': {err}"))?;
    let datetime: chrono::DateTime<chrono::Utc> = resolved.into();
    Ok(datetime.format("%Y-%m-%d %H:%M:%S").to_string())
}

/// A ClickHouse single-quoted string literal with `\` and `'` escaped. Values
/// are inlined (not bound) because the collector's SQL endpoint takes raw SQL.
fn ch_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('\'', "\\'");
    format!("'{escaped}'")
}

fn exception_logs_cte(range: &TimeRange, services: &[String]) -> String {
    let from = ch_string(&range.from_ts);
    let to = ch_string(&range.to_ts);
    // `resolve_clickhouse_ts` formats bounds in UTC, so parse them as UTC
    // explicitly: the local collector's ClickHouse session is in the machine's
    // timezone, and without this it would read the strings in local time and
    // shift the window (the cloud path relies on its ClickHouse running UTC).
    let mut filters = vec![
        format!(
            r#"TimestampTime >= toDateTime(parseDateTime64BestEffort({from}, 9, 'UTC'))
    AND TimestampTime <= toDateTime(parseDateTime64BestEffort({to}, 9, 'UTC'))
    AND Timestamp >= parseDateTime64BestEffort({from}, 9, 'UTC')
    AND Timestamp <= parseDateTime64BestEffort({to}, 9, 'UTC')"#
        ),
        EXCEPTION_LOG_FILTER_SQL.trim().to_string(),
    ];
    if !services.is_empty() {
        let list = services
            .iter()
            .map(|service| ch_string(service))
            .collect::<Vec<_>>()
            .join(", ");
        filters.push(format!("ServiceName IN ({list})"));
    }
    format!(
        r#"exception_logs AS (
  SELECT
    Timestamp, ServiceName, TraceId, SpanId, Body,
    ResourceAttributes, ScopeAttributes, LogAttributes,
    {fingerprint} AS fingerprint
  FROM {TABLE}
  WHERE {where_clause}
)"#,
        fingerprint = FINGERPRINT_SQL.trim(),
        where_clause = filters.join("\n    AND "),
    )
}

fn summary_sql(
    range: &TimeRange,
    services: &[String],
    fingerprint: Option<&str>,
    sort: ErrorSortArg,
    limit: u32,
    offset: u32,
) -> String {
    let fingerprint_filter = match fingerprint {
        Some(value) => format!("WHERE fingerprint = {}", ch_string(value)),
        None => String::new(),
    };
    // fingerprint is the unique GROUP BY key, appended as a deterministic
    // tiebreaker so offset paging stays stable (mirrors buildSummaryQuery).
    let order_by = match sort {
        ErrorSortArg::Count => "occurrenceCount DESC, lastSeen DESC, fingerprint DESC",
        ErrorSortArg::LastSeen => "lastSeen DESC, occurrenceCount DESC, fingerprint DESC",
    };
    format!(
        r#"WITH {cte}
SELECT
  fingerprint,
  argMax(LogAttributes['exception.type'], Timestamp) AS exceptionType,
  argMax(LogAttributes['exception.message'], Timestamp) AS exceptionMessage,
  argMax(Body, Timestamp) AS body,
  argMax(ServiceName, Timestamp) AS latestServiceName,
  groupUniqArray(ServiceName) AS services,
  toUInt32(count()) AS occurrenceCount,
  toUInt32(uniqExactIf(TraceId, TraceId != '')) AS traceCount,
  toString(min(Timestamp)) AS firstSeen,
  toString(max(Timestamp)) AS lastSeen,
  argMax(TraceId, Timestamp) AS latestTraceId,
  argMax(SpanId, Timestamp) AS latestSpanId,
  argMax(toString(Timestamp), Timestamp) AS latestTimestamp
FROM exception_logs
{fingerprint_filter}
GROUP BY fingerprint
ORDER BY {order_by}
LIMIT {limit}
OFFSET {offset}"#,
        cte = exception_logs_cte(range, services),
    )
}

fn occurrences_sql(range: &TimeRange, fingerprint: &str, occurrence_limit: u32) -> String {
    format!(
        r#"WITH {cte},
ranked_occurrence_rows AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY Timestamp
      ORDER BY Timestamp DESC, ServiceName DESC, TraceId DESC, SpanId DESC, Body DESC
    ) AS timestampRank
  FROM exception_logs
  WHERE fingerprint = {fingerprint}
)
SELECT
  toUInt32(timestampRank) AS timestampRank,
  fingerprint,
  toString(Timestamp) AS timestamp,
  ServiceName AS serviceName,
  TraceId AS traceId,
  SpanId AS spanId,
  Body AS body,
  LogAttributes['exception.type'] AS exceptionType,
  LogAttributes['exception.message'] AS exceptionMessage,
  LogAttributes['exception.stacktrace'] AS exceptionStacktrace,
  ResourceAttributes AS resourceAttributes,
  LogAttributes AS logAttributes,
  ScopeAttributes AS scopeAttributes
FROM ranked_occurrence_rows
ORDER BY Timestamp DESC, timestampRank ASC
LIMIT {occurrence_limit}"#,
        cte = exception_logs_cte(range, &[]),
        fingerprint = ch_string(fingerprint),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range() -> TimeRange {
        TimeRange {
            from_ts: "2026-07-10 00:00:00".to_string(),
            to_ts: "2026-07-17 00:00:00".to_string(),
            from_label: "now-7d".to_string(),
            to_label: "now".to_string(),
        }
    }

    #[test]
    fn ch_string_escapes_quotes_and_backslashes() {
        assert_eq!(ch_string("api"), "'api'");
        assert_eq!(ch_string("a'b"), "'a\\'b'");
        assert_eq!(ch_string("a\\b"), "'a\\\\b'");
    }

    #[test]
    fn summary_sql_embeds_fingerprint_service_filter_and_paging() {
        let sql = summary_sql(
            &range(),
            &["api".to_string(), "worker".to_string()],
            None,
            ErrorSortArg::Count,
            25,
            50,
        );
        // The shared fingerprint fragment is inlined verbatim.
        assert!(
            sql.contains("cityHash64("),
            "missing fingerprint hash: {sql}"
        );
        assert!(sql.contains("ServiceName IN ('api', 'worker')"));
        assert!(sql.contains("ORDER BY occurrenceCount DESC, lastSeen DESC, fingerprint DESC"));
        assert!(sql.contains("LIMIT 25"));
        assert!(sql.contains("OFFSET 50"));
        // No fingerprint filter when listing.
        assert!(!sql.contains("WHERE fingerprint ="));
        // Counts are cast to UInt32 so ClickHouse emits JSON numbers, not
        // quoted 64-bit ints.
        assert!(sql.contains("toUInt32(count()) AS occurrenceCount"));
    }

    #[test]
    fn summary_sql_filters_by_fingerprint_for_show() {
        let sql = summary_sql(&range(), &[], Some("fp 1"), ErrorSortArg::LastSeen, 1, 0);
        assert!(sql.contains("WHERE fingerprint = 'fp 1'"));
        assert!(sql.contains("LIMIT 1"));
    }

    #[test]
    fn occurrences_sql_ranks_and_filters_by_fingerprint() {
        let sql = occurrences_sql(&range(), "fp-1", 10);
        assert!(sql.contains("ranked_occurrence_rows AS ("));
        assert!(sql.contains("WHERE fingerprint = 'fp-1'"));
        assert!(sql.contains("LIMIT 10"));
        assert!(sql.contains("exception.stacktrace"));
    }

    #[test]
    fn summary_rows_deserialize_into_shared_struct() {
        // Shape the collector returns for the summary query (counts as numbers
        // thanks to the UInt32 casts, services as an array).
        let row = serde_json::json!({
            "fingerprint": "fp-1",
            "exceptionType": "TypeError",
            "exceptionMessage": "boom",
            "body": "TypeError: boom",
            "latestServiceName": "api",
            "services": ["api", "worker"],
            "occurrenceCount": 3,
            "traceCount": 2,
            "firstSeen": "2026-07-10 10:00:00.000000000",
            "lastSeen": "2026-07-16 14:03:11.000000000",
            "latestTraceId": "trace-1",
            "latestSpanId": "span-1",
            "latestTimestamp": "2026-07-16 14:03:11.000000000",
        });
        let summary: ErrorIssueSummary = serde_json::from_value(row).unwrap();
        assert_eq!(summary.fingerprint, "fp-1");
        assert_eq!(summary.occurrence_count, 3);
        assert_eq!(
            summary.services,
            vec!["api".to_string(), "worker".to_string()]
        );
    }

    #[test]
    fn occurrence_rows_deserialize_with_attribute_maps() {
        let row = serde_json::json!({
            "timestampRank": 1,
            "fingerprint": "fp-1",
            "timestamp": "2026-07-16 14:03:11.000000000",
            "serviceName": "api",
            "traceId": "trace-1",
            "spanId": "span-1",
            "body": "TypeError: boom",
            "exceptionType": "TypeError",
            "exceptionMessage": "boom",
            "exceptionStacktrace": "at boom (app.ts:1)",
            "resourceAttributes": {"service.version": "1.2.3"},
            "logAttributes": {},
            "scopeAttributes": {},
        });
        let occurrence: ErrorOccurrence = serde_json::from_value(row).unwrap();
        assert_eq!(occurrence.service_name, "api");
        assert_eq!(
            occurrence.resource_attributes.get("service.version"),
            Some(&"1.2.3".to_string())
        );
    }
}
