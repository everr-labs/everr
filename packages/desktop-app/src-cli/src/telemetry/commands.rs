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
use crate::telemetry::query::{LogFilter, LogRow, ScanStats, TraceFilter, TraceRow, TraceTree, system_time_ns};
use crate::telemetry::store::{
    STALE_SIBLING_THRESHOLD, StoreError, TelemetryStore, count_otlp_files, newest_otlp_mtime,
};

pub fn run(args: TelemetryArgs) -> Result<()> {
    match args.command {
        TelemetrySubcommand::Traces(q) => run_traces(q),
        TelemetrySubcommand::Logs(q) => run_logs(q),
    }
}

fn run_traces(args: TelemetryQueryArgs) -> Result<()> {
    let since = parse_duration(&args.since)?;
    let format = resolve_format(args.format);
    let resolved_dir = resolved_dir(args.telemetry_dir.as_deref())?;

    match TelemetryStore::open_at(&resolved_dir) {
        Err(StoreError::DirMissing(path)) => {
            emit_missing_or_sibling_hint(&path)?;
            Ok(())
        }
        Err(StoreError::Io(err)) => {
            eprintln!("telemetry store error: {err}");
            Err(anyhow::anyhow!("telemetry store error"))
        }
        Ok(store) => {
            maybe_stale_sibling_banner(store.dir());
            let header = Header::compute(store.dir());
            let filter = TraceFilter {
                since: Some(since),
                name_like: args.name.clone(),
                trace_id: args.trace_id.clone(),
                limit: Some(args.limit),
            };
            let (trees, stats) = store
                .trace_trees(filter)
                .context("query failed")?;
            match format {
                TelemetryFormat::Json => render_traces_json(&header, &trees, args.limit),
                TelemetryFormat::Table => render_trace_trees(&header, &trees),
            }
            print_scan_warnings(&stats);
            Ok(())
        }
    }
}

fn run_logs(args: TelemetryLogsArgs) -> Result<()> {
    let since = parse_duration(&args.since)?;
    let format = resolve_format(args.format);
    let resolved_dir = resolved_dir(args.telemetry_dir.as_deref())?;

    match TelemetryStore::open_at(&resolved_dir) {
        Err(StoreError::DirMissing(path)) => {
            emit_missing_or_sibling_hint(&path)?;
            Ok(())
        }
        Err(StoreError::Io(err)) => {
            eprintln!("telemetry store error: {err}");
            Err(anyhow::anyhow!("telemetry store error"))
        }
        Ok(store) => {
            maybe_stale_sibling_banner(store.dir());
            let header = Header::compute(store.dir());
            let filter = LogFilter {
                since: Some(since),
                level: args.level.clone(),
                grep: args.grep.clone(),
                trace_id: args.trace_id.clone(),
                limit: Some(args.limit),
            };
            let (rows, stats) = store
                .logs(filter)
                .context("query failed")?;
            render_logs(&header, &rows, format);
            print_scan_warnings(&stats);
            Ok(())
        }
    }
}

fn resolved_dir(explicit: Option<&Path>) -> Result<PathBuf> {
    if let Some(explicit) = explicit {
        return Ok(explicit.to_path_buf());
    }
    everr_core::build::telemetry_dir().context("resolve telemetry directory")
}

fn parse_duration(s: &str) -> Result<Duration> {
    let (num_end, suffix) = match s.find(|c: char| !c.is_ascii_digit()) {
        Some(idx) => (idx, &s[idx..]),
        None => return Err(anyhow::anyhow!("missing unit in duration: {s}")),
    };
    let number: u64 = s[..num_end]
        .parse()
        .map_err(|_| anyhow::anyhow!("invalid number in duration: {s}"))?;
    let seconds = match suffix {
        "s" => number,
        "m" => number * 60,
        "h" => number * 3600,
        "d" => number * 86_400,
        other => return Err(anyhow::anyhow!("unknown duration unit: {other}")),
    };
    Ok(Duration::from_secs(seconds))
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
        if count_otlp_files(sibling) > 0 {
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
    let resolved_mtime = newest_otlp_mtime(resolved);
    let sibling_mtime = newest_otlp_mtime(&sibling);
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
        let age = newest_otlp_mtime(dir).and_then(|t| SystemTime::now().duration_since(t).ok());
        Self {
            dir: dir.to_path_buf(),
            file_count: count_otlp_files(dir),
            newest_age: age,
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

fn render_trace_trees(header: &Header, trees: &[TraceTree]) {
    header.print_text();
    if trees.is_empty() {
        println!("No matches. Try a wider --since, or drop filters.");
        return;
    }
    for (i, tree) in trees.iter().enumerate() {
        if i > 0 {
            println!();
        }
        let trace_short = tree.trace_id.get(..8).unwrap_or(&tree.trace_id);
        let age = format_age_ns(tree.activity_timestamp_ns);
        let service = if tree.service_name.is_empty() {
            String::new()
        } else {
            format!("  service: {}", tree.service_name)
        };
        println!("TRACE {trace_short}  {age}{service}");

        // Build parent→children map and collect all known span IDs
        let mut children: std::collections::HashMap<Option<&str>, Vec<&TraceRow>> =
            std::collections::HashMap::new();
        let known_ids: std::collections::HashSet<&str> =
            tree.spans.iter().map(|s| s.span_id.as_str()).collect();
        for span in &tree.spans {
            // Orphan check: if parent_span_id points to a missing parent,
            // promote this span to root level instead of dropping it.
            let parent_key = match span.parent_span_id.as_deref() {
                Some(pid) if known_ids.contains(pid) => Some(pid),
                _ => None,
            };
            children.entry(parent_key).or_default().push(span);
        }

        // Sort children by timestamp ascending (earliest first within each group)
        for group in children.values_mut() {
            group.sort_by_key(|s| s.timestamp_ns);
        }

        // Render from root spans (no parent, or orphans promoted to root)
        let roots = children.get(&None).cloned().unwrap_or_default();
        render_span_children(&roots, &children, &tree.matched_span_ids, "");
    }
}

fn render_span_children(
    spans: &[&TraceRow],
    children: &std::collections::HashMap<Option<&str>, Vec<&TraceRow>>,
    matched: &std::collections::HashSet<String>,
    prefix: &str,
) {
    for (i, span) in spans.iter().enumerate() {
        let is_last = i == spans.len() - 1;
        let connector = if is_last { "└─ " } else { "├─ " };
        let duration = format_duration_ns(span.duration_ns);
        let status = status_code_str(span.status_code);
        let is_match = matched.contains(&span.span_id);
        let marker = if is_match { "  ← match" } else { "" };
        let name_display = if is_match {
            format!("\x1b[1m{}\x1b[0m", truncate(&span.name, 29))
        } else {
            truncate(&span.name, 29)
        };
        println!(
            "{prefix}{connector}{:<30} {:<8} {}{}",
            name_display,
            duration,
            status,
            marker
        );

        let child_prefix = if is_last {
            format!("{prefix}   ")
        } else {
            format!("{prefix}│  ")
        };
        if let Some(kids) = children.get(&Some(span.span_id.as_str())) {
            render_span_children(kids, children, matched, &child_prefix);
        }
    }
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

fn format_age_ns(timestamp_ns: u64) -> String {
    let now_ns = system_time_ns(SystemTime::now());
    if timestamp_ns == 0 || timestamp_ns > now_ns {
        return "just now".to_string();
    }
    let diff_secs = (now_ns - timestamp_ns) / 1_000_000_000;
    if diff_secs < 60 {
        format!("{diff_secs}s ago")
    } else if diff_secs < 3600 {
        format!("{}m ago", diff_secs / 60)
    } else if diff_secs < 86400 {
        format!("{}h ago", diff_secs / 3600)
    } else {
        format!("{}d ago", diff_secs / 86400)
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
                println!(
                    "{:<22}{:<7}{:<22}{}",
                    time,
                    &row.level,
                    truncate(&row.target, 21),
                    &row.message
                );
            }
            if rows.is_empty() {
                println!("No matches. Try a wider --since, or drop filters.");
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

fn format_duration_ns(ns: u64) -> String {
    if ns < 1_000 {
        format!("{ns}ns")
    } else if ns < 1_000_000 {
        format!("{:.1}µs", ns as f64 / 1_000.0)
    } else if ns < 1_000_000_000 {
        format!("{:.1}ms", ns as f64 / 1_000_000.0)
    } else {
        format!("{:.2}s", ns as f64 / 1_000_000_000.0)
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out = s.chars().take(max.saturating_sub(1)).collect::<String>();
        out.push('…');
        out
    }
}
