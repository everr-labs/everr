use std::io::{self, IsTerminal};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;

use crate::cli::{
    TelemetryArgs, TelemetryFormat, TelemetryLogsArgs, TelemetryQueryArgs, TelemetrySubcommand,
};
use crate::telemetry::otlp::KeyValue;
use crate::telemetry::query::{LogFilter, LogRow, ScanStats, TraceFilter, TraceTree};
use crate::telemetry::store::{
    STALE_SIBLING_THRESHOLD, StoreError, TelemetryStore, otlp_file_summary,
};
use everr_core::datemath;

pub fn run(args: TelemetryArgs) -> Result<()> {
    match args.command {
        TelemetrySubcommand::Traces(q) => run_traces(q),
        TelemetrySubcommand::Logs(q) => run_logs(q),
        TelemetrySubcommand::Endpoint => run_endpoint(),
        TelemetrySubcommand::AiInstructions => run_ai_instructions(),
    }
}

fn run_endpoint() -> Result<()> {
    println!("{}", everr_core::build::otlp_http_origin());
    Ok(())
}

fn run_ai_instructions() -> Result<()> {
    print!("{}", everr_core::assistant::render_telemetry_ai_instructions());
    Ok(())
}

/// Open the telemetry store, emitting user-facing hints on missing/stale dirs.
/// Returns `Ok(None)` when the directory is missing (hint already printed).
fn open_store(telemetry_dir: Option<&Path>) -> Result<Option<(TelemetryStore, Header)>> {
    let resolved = resolved_dir(telemetry_dir)?;
    match TelemetryStore::open_at(&resolved) {
        Err(StoreError::DirMissing(path)) => {
            emit_missing_or_sibling_hint(&path)?;
            Ok(None)
        }
        Err(StoreError::Io(err)) => {
            eprintln!("telemetry store error: {err}");
            Err(anyhow::anyhow!("telemetry store error"))
        }
        Ok(store) => {
            maybe_stale_sibling_banner(store.dir());
            let header = Header::compute(store.dir());
            Ok(Some((store, header)))
        }
    }
}

fn run_traces(args: TelemetryQueryArgs) -> Result<()> {
    let now = SystemTime::now();
    let from_ns = resolve_datemath_ns(&args.from, now)?;
    let to_ns = args.to.as_deref().map(|s| resolve_datemath_ns(s, now)).transpose()?;
    let Some((store, header)) = open_store(args.telemetry_dir.as_deref())? else {
        return Ok(());
    };
    let filter = TraceFilter {
        from_ns: Some(from_ns),
        to_ns,
        name_like: args.name.clone(),
        service: args.service.clone(),
        trace_id: args.trace_id.clone(),
        attrs: parse_attr_filters(&args.attrs)?,
        limit: Some(args.limit),
    };
    let (trees, stats) = store.trace_trees(filter).context("query failed")?;
    render_traces_json(&header, &trees, args.limit);
    print_scan_warnings(&stats);
    Ok(())
}

fn run_logs(args: TelemetryLogsArgs) -> Result<()> {
    let now = SystemTime::now();
    let from_ns = resolve_datemath_ns(&args.from, now)?;
    let to_ns = args.to.as_deref().map(|s| resolve_datemath_ns(s, now)).transpose()?;
    let format = resolve_format(args.format);
    let Some((store, header)) = open_store(args.telemetry_dir.as_deref())? else {
        return Ok(());
    };
    let filter = LogFilter {
        from_ns: Some(from_ns),
        to_ns,
        level: args.level.clone(),
        egrep: args.egrep.clone(),
        service: args.service.clone(),
        target: args.target.clone(),
        trace_id: args.trace_id.clone(),
        attrs: parse_attr_filters(&args.attrs)?,
        limit: Some(args.limit),
    };
    let (rows, stats) = store.logs(filter).context("query failed")?;
    render_logs(&header, &rows, format);
    print_scan_warnings(&stats);
    Ok(())
}

fn resolved_dir(explicit: Option<&Path>) -> Result<PathBuf> {
    if let Some(explicit) = explicit {
        return Ok(explicit.to_path_buf());
    }
    everr_core::build::telemetry_dir().context("resolve telemetry directory")
}

fn resolve_datemath_ns(expr: &str, now: SystemTime) -> Result<u64> {
    datemath::resolve_to_epoch_ns(expr, now)
        .map_err(|e| anyhow::anyhow!("invalid date math expression '{}': {}", e.expression, e.message))
}

fn resolve_format(requested: Option<TelemetryFormat>) -> TelemetryFormat {
    if let Some(f) = requested {
        return f;
    }
    if io::stdout().is_terminal() {
        TelemetryFormat::Table
    } else {
        TelemetryFormat::Json
    }
}

fn emit_missing_or_sibling_hint(resolved: &Path) -> Result<()> {
    let sibling = everr_core::build::telemetry_dir_sibling().ok();
    if let Some(sibling) = sibling.as_deref() {
        if otlp_file_summary(sibling).0 > 0 {
            eprintln!(
                "No telemetry in {}, but {} has data. If you're inspecting the other build, pass --telemetry-dir {} or use the matching binary.",
                resolved.display(),
                sibling.display(),
                sibling.display()
            );
            return Ok(());
        }
    }
    eprintln!(
        "No telemetry recorded yet. Launch the Everr desktop app, reproduce the behavior you want to inspect, then rerun this command."
    );
    Ok(())
}

fn maybe_stale_sibling_banner(resolved: &Path) {
    let sibling = match everr_core::build::telemetry_dir_sibling() {
        Ok(s) => s,
        Err(_) => return,
    };
    let resolved_mtime = otlp_file_summary(resolved).1;
    let sibling_mtime = otlp_file_summary(&sibling).1;
    if let (Some(r), Some(s)) = (resolved_mtime, sibling_mtime) {
        if let Ok(delta) = s.duration_since(r) {
            if delta > STALE_SIBLING_THRESHOLD {
                eprintln!(
                    "heads-up: {} has data newer than {} ({}s newer). You may be looking at the wrong build — pass --telemetry-dir {} to switch.",
                    sibling.display(),
                    resolved.display(),
                    delta.as_secs(),
                    sibling.display()
                );
            }
        }
    }
}

struct Header {
    dir: PathBuf,
    file_count: usize,
    newest_age: Option<Duration>,
}

impl Header {
    fn compute(dir: &Path) -> Self {
        let (file_count, newest_mtime) = otlp_file_summary(dir);
        let newest_age = newest_mtime.and_then(|t| SystemTime::now().duration_since(t).ok());
        Self {
            dir: dir.to_path_buf(),
            file_count,
            newest_age,
        }
    }

    fn as_meta(&self) -> MetaHeader {
        MetaHeader {
            dir: self.dir.display().to_string(),
            file_count: self.file_count,
            newest_age_secs: self.newest_age.map(|d| d.as_secs()),
        }
    }

    fn print_text(&self) {
        let age = self
            .newest_age
            .map(|d| format!("{}s ago", d.as_secs()))
            .unwrap_or_else(|| "no files".into());
        eprintln!(
            "reading {} ({} files, newest {})",
            self.dir.display(),
            self.file_count,
            age
        );
    }
}

#[derive(Serialize)]
struct MetaHeader {
    dir: String,
    file_count: usize,
    newest_age_secs: Option<u64>,
}

fn kvs_to_json(kvs: &[KeyValue]) -> Value {
    let mut map = serde_json::Map::new();
    for kv in kvs {
        map.insert(
            kv.key.clone(),
            kv.value.clone().unwrap_or(Value::Null),
        );
    }
    Value::Object(map)
}

fn render_traces_json(header: &Header, trees: &[TraceTree], limit: usize) {
    // Flatten trees into a flat span array, sorted by timestamp descending,
    // capped at `limit` spans (not traces — JSON mode is flat).
    #[derive(Serialize)]
    struct JsonSpan<'a> {
        timestamp_ns: u64,
        trace_id: &'a str,
        span_id: &'a str,
        parent_span_id: &'a Option<String>,
        name: &'a str,
        kind: &'static str,
        status: &'static str,
        duration_ns: u64,
        attributes: Value,
        resource: Value,
    }
    let mut rows: Vec<JsonSpan> = trees
        .iter()
        .flat_map(|t| &t.spans)
        .map(|s| JsonSpan {
            timestamp_ns: s.timestamp_ns,
            trace_id: &s.trace_id,
            span_id: &s.span_id,
            parent_span_id: &s.parent_span_id,
            name: &s.name,
            kind: span_kind_str(s.kind),
            status: status_code_str(s.status_code),
            duration_ns: s.duration_ns,
            attributes: kvs_to_json(&s.span_attrs),
            resource: kvs_to_json(&s.resource_attrs),
        })
        .collect();
    rows.sort_by(|a, b| b.timestamp_ns.cmp(&a.timestamp_ns));
    rows.truncate(limit);
    let payload = serde_json::json!({
        "meta": header.as_meta(),
        "rows": rows,
    });
    println!("{}", serde_json::to_string_pretty(&payload).unwrap());
}

fn span_kind_str(kind: u8) -> &'static str {
    match kind {
        0 => "UNSPECIFIED",
        1 => "INTERNAL",
        2 => "SERVER",
        3 => "CLIENT",
        4 => "PRODUCER",
        5 => "CONSUMER",
        _ => "UNSPECIFIED",
    }
}

fn status_code_str(code: u8) -> &'static str {
    match code {
        0 => "UNSET",
        1 => "OK",
        2 => "ERROR",
        _ => "UNSET",
    }
}

fn print_scan_warnings(stats: &ScanStats) {
    if stats.skipped_unreadable_files > 0 {
        eprintln!(
            "warning: skipped {} unreadable telemetry file(s)",
            stats.skipped_unreadable_files
        );
    }
    if stats.skipped_malformed_lines > 0 {
        eprintln!(
            "warning: skipped {} malformed line(s)",
            stats.skipped_malformed_lines
        );
    }
}

fn render_logs(header: &Header, rows: &[LogRow], format: TelemetryFormat) {
    match format {
        TelemetryFormat::Table => {
            header.print_text();
            println!("{:<22}{:<7}{:<22}{}", "TIME", "LEVEL", "TARGET", "MESSAGE");
            for row in rows {
                let time = format_timestamp_ns(row.timestamp_ns);
                let attrs = format_inline_attrs(&row.log_attrs);
                if attrs.is_empty() {
                    println!(
                        "{:<22}{:<7}{:<22}{}",
                        time,
                        &row.level,
                        truncate(&row.target, 21),
                        &row.message
                    );
                } else {
                    println!(
                        "{:<22}{:<7}{:<22}{}  {}",
                        time,
                        &row.level,
                        truncate(&row.target, 21),
                        &row.message,
                        attrs
                    );
                }
            }
            if rows.is_empty() {
                println!("No matches. Try a wider --from, or drop filters.");
            }
        }
        TelemetryFormat::Json => {
            #[derive(Serialize)]
            struct JsonLog<'a> {
                timestamp_ns: u64,
                level: &'a str,
                target: &'a str,
                message: &'a str,
                trace_id: &'a Option<String>,
                span_id: &'a Option<String>,
                attributes: Value,
                resource: Value,
            }
            let json_rows: Vec<JsonLog> = rows
                .iter()
                .map(|r| JsonLog {
                    timestamp_ns: r.timestamp_ns,
                    level: &r.level,
                    target: &r.target,
                    message: &r.message,
                    trace_id: &r.trace_id,
                    span_id: &r.span_id,
                    attributes: kvs_to_json(&r.log_attrs),
                    resource: kvs_to_json(&r.resource_attrs),
                })
                .collect();
            let payload = serde_json::json!({
                "meta": header.as_meta(),
                "rows": json_rows,
            });
            println!("{}", serde_json::to_string_pretty(&payload).unwrap());
        }
    }
}

fn format_timestamp_ns(nanos: u64) -> String {
    use chrono::{DateTime, Local, Utc};
    let secs = (nanos / 1_000_000_000) as i64;
    let sub_nanos = (nanos % 1_000_000_000) as u32;
    DateTime::<Utc>::from_timestamp(secs, sub_nanos)
        .map(|dt| dt.with_timezone(&Local).format("%H:%M:%S%.3f %z").to_string())
        .unwrap_or_else(|| format!("{nanos}ns"))
}

fn format_inline_attrs(kvs: &[KeyValue]) -> String {
    let parts: Vec<String> = kvs
        .iter()
        .map(|kv| {
            let val = kv
                .value
                .as_ref()
                .and_then(|v| v.get("stringValue"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            format!("{}={}", kv.key, val)
        })
        .collect();
    parts.join(" ")
}

fn parse_attr_filters(raw: &[String]) -> Result<Vec<(String, String)>> {
    raw.iter()
        .map(|s| {
            let (k, v) = s
                .split_once('=')
                .ok_or_else(|| anyhow::anyhow!("--attr must be KEY=VALUE, got: {s}"))?;
            Ok((k.to_string(), v.to_string()))
        })
        .collect()
}

fn truncate(s: &str, max: usize) -> std::borrow::Cow<'_, str> {
    if s.chars().count() <= max {
        std::borrow::Cow::Borrowed(s)
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        std::borrow::Cow::Owned(out)
    }
}
