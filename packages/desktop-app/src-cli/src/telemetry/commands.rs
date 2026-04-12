use std::io::{self, IsTerminal};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use serde::Serialize;

use crate::cli::{
    TelemetryArgs, TelemetryFormat, TelemetryLogsArgs, TelemetryPathArgs, TelemetryQueryArgs,
    TelemetrySubcommand,
};
use crate::telemetry::query::{LogFilter, LogRow, TraceFilter, TraceRow};
use crate::telemetry::store::{
    STALE_SIBLING_THRESHOLD, StoreError, TelemetryStore, count_otlp_files, newest_otlp_mtime,
};

pub fn run(args: TelemetryArgs) -> Result<()> {
    match args.command {
        TelemetrySubcommand::Traces(q) => run_traces(q),
        TelemetrySubcommand::Logs(q) => run_logs(q),
        TelemetrySubcommand::Path(p) => run_path(p),
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
        Err(other) => {
            render_store_error(&other);
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
            let rows = store
                .traces(filter)
                .context("query failed — see above for details")?;
            render_traces(&header, &rows, format);
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
        Err(other) => {
            render_store_error(&other);
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
            let rows = store
                .logs(filter)
                .context("query failed — see above for details")?;
            render_logs(&header, &rows, format);
            Ok(())
        }
    }
}

fn run_path(args: TelemetryPathArgs) -> Result<()> {
    let dir = resolved_dir(args.telemetry_dir.as_deref())?;
    println!("{}", dir.display());
    Ok(())
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

fn render_traces(header: &Header, rows: &[TraceRow], format: TelemetryFormat) {
    match format {
        TelemetryFormat::Table => {
            header.print_text();
            println!(
                "{:<22}{:<28}{:<11}{:<9}{:<14}",
                "TIME", "NAME", "DURATION", "STATUS", "TRACE"
            );
            for row in rows {
                // timestamp_ns stores nanoseconds from the OTLP trace data
                let time = format_timestamp_ns(row.timestamp_ns);
                let duration = format_duration_ns(row.duration_ns);
                let trace = row.trace_id.get(..8).unwrap_or("").to_lowercase();
                println!(
                    "{:<22}{:<28}{:<11}{:<9}{:<14}",
                    time,
                    truncate(&row.name, 27),
                    duration,
                    &row.status,
                    format!("{trace}…")
                );
            }
            if rows.is_empty() {
                println!("No matches. Try a wider --since, or drop filters.");
            }
        }
        TelemetryFormat::Json => {
            let payload = serde_json::json!({
                "meta": header.as_meta(),
                "rows": rows,
            });
            println!("{}", serde_json::to_string_pretty(&payload).unwrap());
        }
    }
}

fn render_logs(header: &Header, rows: &[LogRow], format: TelemetryFormat) {
    match format {
        TelemetryFormat::Table => {
            header.print_text();
            println!("{:<22}{:<7}{:<22}{}", "TIME", "LEVEL", "TARGET", "MESSAGE");
            for row in rows {
                // timestamp_ns stores milliseconds: extract('epoch') * 1000
                let time = format_timestamp_ms(row.timestamp_ns);
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
            let payload = serde_json::json!({
                "meta": header.as_meta(),
                "rows": rows,
            });
            println!("{}", serde_json::to_string_pretty(&payload).unwrap());
        }
    }
}

fn render_store_error(err: &StoreError) {
    match err {
        StoreError::DirMissing(_) => {}
        StoreError::ExtensionUnavailable(msg) => {
            eprintln!(
                "DuckDB otlp extension isn't installed yet. This is a one-time install and requires network access — run this command once while online and it'll work offline after that."
            );
            eprintln!("underlying error: {msg}");
        }
        StoreError::Query(err) => eprintln!("query error: {err}"),
    }
}

/// Format a nanosecond timestamp (as stored in TraceRow::timestamp_ns, which
/// comes from epoch_ms("timestamp") * 1000 — DuckDB returns nanoseconds for
/// nanosecond-precision OTLP timestamps via epoch_ms).
fn format_timestamp_ns(nanos: u64) -> String {
    use chrono::{DateTime, Utc};
    let secs = (nanos / 1_000_000_000) as i64;
    let sub_nanos = (nanos % 1_000_000_000) as u32;
    DateTime::<Utc>::from_timestamp(secs, sub_nanos)
        .map(|dt| dt.format("%H:%M:%S%.3f %z").to_string())
        .unwrap_or_else(|| format!("{nanos}ns"))
}

/// Format a microsecond timestamp (as stored in LogRow::timestamp_ns, which
/// comes from extract('epoch')::BIGINT * 1000 where the OTLP extension's
/// extract returns microseconds, giving microseconds after * 1000).
fn format_timestamp_ms(micros: u64) -> String {
    use chrono::{DateTime, Utc};
    let secs = (micros / 1_000_000) as i64;
    let sub_nanos = ((micros % 1_000_000) * 1_000) as u32;
    DateTime::<Utc>::from_timestamp(secs, sub_nanos)
        .map(|dt| dt.format("%H:%M:%S%.3f %z").to_string())
        .unwrap_or_else(|| format!("{micros}µs"))
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
