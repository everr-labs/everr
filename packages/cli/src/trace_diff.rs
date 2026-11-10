use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow, bail};
use serde::Serialize;
use serde_json::Value;

use crate::cli::{TraceDiffArgs, TraceDiffFormat, TraceSnapshotArgs, TraceWindowArgs};
use crate::datemath;
use crate::telemetry::client::Rows;
use crate::telemetry::commands::query_local;

const MAX_RENDERED_CHANGES: usize = 100;
// Rates are ratios of small integers, so anything closer than this is equal.
const EPSILON: f64 = 1e-9;

/// Columns a snapshot file keeps. The diff reads only the trace structure
/// today. Durations and attributes are kept so later comparisons (latency,
/// attribute signatures) work on baselines that already exist.
const SNAPSHOT_COLUMNS: &str = "Timestamp, TraceId, SpanId, ParentSpanId, ServiceName, \
    ScopeName, toString(SpanKind) AS SpanKind, SpanName, toString(StatusCode) AS StatusCode, \
    StatusMessage, Duration, toJSONString(SpanAttributes) AS SpanAttributes, \
    toJSONString(ResourceAttributes) AS ResourceAttributes";

#[derive(Serialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Signature {
    pub service: String,
    pub kind: String,
    pub name: String,
}

/// Span counts of one run, grouped by the entry point of each trace.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RunStats {
    pub entry_points: Vec<EntryPoint>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EntryPoint {
    pub entry: Signature,
    pub traces: u64,
    pub spans: Vec<SpanStats>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpanStats {
    pub signature: Signature,
    pub count: u64,
    pub errors: u64,
}

impl RunStats {
    pub fn traces(&self) -> u64 {
        self.entry_points.iter().map(|entry| entry.traces).sum()
    }

    fn entry(&self, signature: &Signature) -> Option<&EntryPoint> {
        self.entry_points
            .iter()
            .find(|entry| &entry.entry == signature)
    }
}

impl EntryPoint {
    fn span(&self, signature: &Signature) -> Option<&SpanStats> {
        self.spans.iter().find(|span| &span.signature == signature)
    }

    fn per_trace(&self, signature: &Signature) -> (f64, f64) {
        let traces = self.traces.max(1) as f64;
        self.span(signature).map_or((0.0, 0.0), |span| {
            (span.count as f64 / traces, span.errors as f64 / traces)
        })
    }
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

impl Range {
    fn of(values: impl IntoIterator<Item = f64>) -> Self {
        values.into_iter().fold(
            Range {
                min: f64::INFINITY,
                max: f64::NEG_INFINITY,
            },
            |range, value| Range {
                min: range.min.min(value),
                max: range.max.max(value),
            },
        )
    }

    fn contains(&self, value: f64) -> bool {
        value >= self.min - EPSILON && value <= self.max + EPSILON
    }
}

#[derive(clap::ValueEnum, Serialize, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeKind {
    NewEntryPoint,
    RemovedEntryPoint,
    NewSpan,
    RemovedSpan,
    CountChanged,
    ErrorsIncreased,
    ErrorsDecreased,
}

impl ChangeKind {
    fn label(self) -> &'static str {
        match self {
            ChangeKind::NewEntryPoint => "new entry point",
            ChangeKind::RemovedEntryPoint => "removed entry point",
            ChangeKind::NewSpan => "new span",
            ChangeKind::RemovedSpan => "removed span",
            ChangeKind::CountChanged => "count changed",
            ChangeKind::ErrorsIncreased => "errors increased",
            ChangeKind::ErrorsDecreased => "errors decreased",
        }
    }
}

/// `base` and `head` are per-trace rates for span changes. Entry point changes
/// carry no rates, only the head trace count.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Change {
    pub kind: ChangeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<Signature>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<f64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct EntryChanges {
    pub entry: Signature,
    pub head_traces: u64,
    pub changes: Vec<Change>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Report {
    pub baselines: usize,
    pub entry_points: usize,
    pub traces: u64,
    pub entries: Vec<EntryChanges>,
}

impl Report {
    pub fn changes(&self) -> impl Iterator<Item = &Change> {
        self.entries.iter().flat_map(|entry| entry.changes.iter())
    }
}

/// Compare one run against baseline runs. A per-trace rate counts as changed
/// only when it falls outside the range the baselines showed, so baselines
/// from several runs absorb ordinary run-to-run variation.
pub fn diff(baselines: &[RunStats], head: &RunStats) -> Report {
    // Without a baseline there is nothing to compare, not a run where every
    // entry point is new.
    if baselines.is_empty() {
        return Report {
            baselines: 0,
            entry_points: head.entry_points.len(),
            traces: head.traces(),
            entries: Vec::new(),
        };
    }

    let entries: BTreeSet<&Signature> = baselines
        .iter()
        .chain(std::iter::once(head))
        .flat_map(|snapshot| snapshot.entry_points.iter().map(|entry| &entry.entry))
        .collect();

    let entries = entries
        .into_iter()
        .filter_map(|signature| {
            let in_base: Vec<&EntryPoint> = baselines
                .iter()
                .filter_map(|snapshot| snapshot.entry(signature))
                .collect();
            let in_head = head.entry(signature);
            let changes = match in_head {
                None if !baselines.is_empty() && in_base.len() == baselines.len() => {
                    vec![Change {
                        kind: ChangeKind::RemovedEntryPoint,
                        span: None,
                        base: None,
                        head: None,
                    }]
                }
                // Missing from some baselines and from head: an entry point
                // that only shows up sometimes, so its absence says nothing.
                None => return None,
                Some(_) if in_base.is_empty() => vec![Change {
                    kind: ChangeKind::NewEntryPoint,
                    span: None,
                    base: None,
                    head: None,
                }],
                Some(head_entry) => diff_spans(&in_base, head_entry),
            };
            (!changes.is_empty()).then(|| EntryChanges {
                entry: signature.clone(),
                head_traces: in_head.map_or(0, |entry| entry.traces),
                changes,
            })
        })
        .collect();

    Report {
        baselines: baselines.len(),
        entry_points: head.entry_points.len(),
        traces: head.traces(),
        entries,
    }
}

fn diff_spans(base: &[&EntryPoint], head: &EntryPoint) -> Vec<Change> {
    let spans: BTreeSet<&Signature> = base
        .iter()
        .copied()
        .chain(std::iter::once(head))
        .flat_map(|entry| entry.spans.iter().map(|span| &span.signature))
        .collect();

    let mut changes = Vec::new();
    for signature in spans {
        let rates: Vec<(f64, f64)> = base
            .iter()
            .map(|entry| entry.per_trace(signature))
            .collect();
        let counts = Range::of(rates.iter().map(|(count, _)| *count));
        let errors = Range::of(rates.iter().map(|(_, errors)| *errors));
        let (head_count, head_errors) = head.per_trace(signature);

        if !counts.contains(head_count) {
            let kind = if counts.max <= EPSILON {
                ChangeKind::NewSpan
            } else if head_count <= EPSILON {
                ChangeKind::RemovedSpan
            } else {
                ChangeKind::CountChanged
            };
            changes.push(Change {
                kind,
                span: Some(signature.clone()),
                base: Some(counts),
                head: Some(head_count),
            });
        }

        // A span that stopped appearing also stops erroring, which is already
        // reported as the removal.
        if head_count > EPSILON && !errors.contains(head_errors) {
            let kind = if head_errors > errors.max {
                ChangeKind::ErrorsIncreased
            } else {
                ChangeKind::ErrorsDecreased
            };
            changes.push(Change {
                kind,
                span: Some(signature.clone()),
                base: Some(errors),
                head: Some(head_errors),
            });
        }
    }
    changes.sort_by(|a, b| (a.kind, &a.span).cmp(&(b.kind, &b.span)));
    changes
}

pub fn render_markdown(report: &Report) -> String {
    let mut out = String::from("## Trace diff\n\n");
    if report.baselines == 0 {
        let _ = writeln!(
            out,
            "No baseline snapshot to compare against. Captured {} across {}.",
            plural(report.traces, "trace"),
            plural(report.entry_points as u64, "entry point"),
        );
        return out;
    }

    let total = report.changes().count();
    let _ = writeln!(
        out,
        "Compared {} across {} with {}: {}.",
        plural(report.traces, "trace"),
        plural(report.entry_points as u64, "entry point"),
        plural(report.baselines as u64, "baseline snapshot"),
        if total == 0 {
            "no changes".to_string()
        } else {
            format!(
                "{} in {}",
                plural(total as u64, "change"),
                plural(report.entries.len() as u64, "entry point")
            )
        },
    );
    if total > 0 {
        out.push_str("\nValues are spans per trace of the entry point.\n");
    }

    let mut rendered = 0;
    for entry in &report.entries {
        if rendered >= MAX_RENDERED_CHANGES {
            break;
        }
        let _ = write!(out, "\n### {}", signature_label(&entry.entry));
        if entry.head_traces > 0 {
            let _ = write!(out, " ({})", plural(entry.head_traces, "trace"));
        }
        out.push_str("\n\n");

        let span_changes: Vec<&Change> = entry
            .changes
            .iter()
            .filter(|change| change.span.is_some())
            .collect();
        for change in entry.changes.iter().filter(|change| change.span.is_none()) {
            let _ = writeln!(out, "{}.", capitalize(change.kind.label()));
            rendered += 1;
        }
        if span_changes.is_empty() {
            continue;
        }

        out.push_str("| Change | Span | Base | Head |\n| --- | --- | --- | --- |\n");
        for change in span_changes {
            if rendered >= MAX_RENDERED_CHANGES {
                break;
            }
            let span = change
                .span
                .as_ref()
                .map(signature_label)
                .unwrap_or_default();
            let base = change.base.map(format_range).unwrap_or_default();
            let head = change.head.map(format_rate).unwrap_or_default();
            let _ = writeln!(
                out,
                "| {} | {span} | {base} | {head} |",
                change.kind.label()
            );
            rendered += 1;
        }
    }

    if rendered < total {
        let _ = writeln!(
            out,
            "\n{} more not shown.",
            plural((total - rendered) as u64, "change")
        );
    }
    out
}

fn signature_label(signature: &Signature) -> String {
    format!(
        "`{}` {} `{}`",
        signature.service, signature.kind, signature.name
    )
}

fn format_range(range: Range) -> String {
    if (range.max - range.min).abs() <= EPSILON {
        format_rate(range.min)
    } else {
        format!("{} to {}", format_rate(range.min), format_rate(range.max))
    }
}

fn format_rate(value: f64) -> String {
    if (value - value.round()).abs() < 0.005 {
        format!("{}", value.round() as i64)
    } else {
        format!("{value:.2}")
    }
}

fn plural(count: u64, noun: &str) -> String {
    if count == 1 {
        format!("1 {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// Which change kinds the report holds out of `fail_on`, with counts.
pub fn gate(report: &Report, fail_on: &[ChangeKind]) -> Vec<(ChangeKind, usize)> {
    let mut counts: BTreeMap<ChangeKind, usize> = BTreeMap::new();
    for change in report
        .changes()
        .filter(|change| fail_on.contains(&change.kind))
    {
        *counts.entry(change.kind).or_default() += 1;
    }
    counts.into_iter().collect()
}

/// Where a run's spans come from: the local collector's `traces` table, or a
/// snapshot file written by `trace-snapshot`.
enum Source<'a> {
    Collector {
        window: &'a TraceWindowArgs,
        from: i64,
        to: i64,
    },
    File(&'a Path),
}

fn window_condition(from: i64, to: i64) -> String {
    format!(
        "Timestamp >= fromUnixTimestamp64Nano(toInt64({from})) \
         AND Timestamp <= fromUnixTimestamp64Nano(toInt64({to}))"
    )
}

fn sql_string(text: &str) -> String {
    format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn source_sql(run: usize, source: &Source) -> String {
    match source {
        Source::Collector { from, to, .. } => format!(
            "SELECT {run} AS run, TraceId, ParentSpanId, Timestamp, ServiceName, \
               toString(SpanKind) AS SpanKind, SpanName, toString(StatusCode) AS StatusCode \
             FROM traces WHERE {}",
            window_condition(*from, *to)
        ),
        Source::File(path) => format!(
            "SELECT {run} AS run, TraceId, ParentSpanId, Timestamp, ServiceName, \
               SpanKind, SpanName, StatusCode \
             FROM file({}, 'Parquet')",
            sql_string(&path.to_string_lossy())
        ),
    }
}

// The entry point of a trace is its root span. Traces whose root was never
// exported (a test runner that propagates context but exports nothing) fall
// back to their earliest span.
// Ignored spans are dropped before entry points are chosen, so an ignored
// root does not leave its trace keyed by its first child instead.
fn aggregate_sql(sources: &[Source], ignore_spans: &[String]) -> (String, String) {
    let mut spans = sources
        .iter()
        .enumerate()
        .map(|(run, source)| source_sql(run, source))
        .collect::<Vec<_>>()
        .join(" UNION ALL ");
    if !ignore_spans.is_empty() {
        let names: Vec<String> = ignore_spans.iter().map(|name| sql_string(name)).collect();
        spans = format!(
            "SELECT * FROM ({spans}) WHERE SpanName NOT IN ({})",
            names.join(", ")
        );
    }
    let with = format!(
        "WITH spans AS ({spans}), \
         entries AS (\
           SELECT run, TraceId, \
             argMin((ServiceName, SpanKind, SpanName), (ParentSpanId != '', Timestamp)) AS entry \
           FROM spans GROUP BY run, TraceId\
         ) "
    );
    let traces = format!(
        "{with}SELECT run, entry.1 AS entry_service, entry.2 AS entry_kind, entry.3 AS entry_name, \
           toUInt32(count()) AS traces \
         FROM entries GROUP BY run, entry_service, entry_kind, entry_name \
         LIMIT 100000"
    );
    let spans = format!(
        "{with}SELECT run, entry.1 AS entry_service, entry.2 AS entry_kind, entry.3 AS entry_name, \
           ServiceName AS service, SpanKind AS kind, SpanName AS name, \
           toUInt32(count()) AS count, toUInt32(countIf(StatusCode = 'Error')) AS errors \
         FROM spans INNER JOIN entries USING (run, TraceId) \
         GROUP BY run, entry_service, entry_kind, entry_name, service, kind, name \
         LIMIT 100000"
    );
    (traces, spans)
}

/// Turn the aggregate rows into one [`RunStats`] per run, indexed like the
/// sources. A run with no spans has no rows and comes back empty.
fn runs_from_rows(runs: usize, traces: &Rows, spans: &Rows) -> Result<Vec<RunStats>> {
    let mut entries: Vec<BTreeMap<Signature, EntryPoint>> = vec![BTreeMap::new(); runs];
    let run_of = |row: &Value| -> Result<usize> {
        let run = number(row, "run")? as usize;
        if run >= runs {
            bail!("query returned rows for unknown run {run}");
        }
        Ok(run)
    };

    for row in &traces.values {
        let entry = signature(row, "entry_service", "entry_kind", "entry_name")?;
        entries[run_of(row)?].insert(
            entry.clone(),
            EntryPoint {
                entry,
                traces: number(row, "traces")?,
                spans: Vec::new(),
            },
        );
    }
    for row in &spans.values {
        let entry = signature(row, "entry_service", "entry_kind", "entry_name")?;
        let target = entries[run_of(row)?]
            .get_mut(&entry)
            .ok_or_else(|| anyhow!("span row for unknown entry point {entry:?}"))?;
        target.spans.push(SpanStats {
            signature: signature(row, "service", "kind", "name")?,
            count: number(row, "count")?,
            errors: number(row, "errors")?,
        });
    }

    Ok(entries
        .into_iter()
        .map(|entries| RunStats {
            entry_points: entries
                .into_values()
                .map(|mut entry| {
                    entry.spans.sort_by(|a, b| a.signature.cmp(&b.signature));
                    entry
                })
                .collect(),
        })
        .collect())
}

fn signature(row: &Value, service: &str, kind: &str, name: &str) -> Result<Signature> {
    let text = |key: &str| {
        row.get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| anyhow!("query row is missing `{key}`"))
    };
    Ok(Signature {
        service: text(service)?,
        kind: text(kind)?,
        name: text(name)?,
    })
}

// ClickHouse quotes 64-bit integers in JSON output by default, so accept both.
fn number(row: &Value, key: &str) -> Result<u64> {
    match row.get(key) {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(text)) => text.parse().ok(),
        _ => None,
    }
    .ok_or_else(|| anyhow!("query row is missing a numeric `{key}`"))
}

fn window_nanos(window: &TraceWindowArgs) -> Result<(i64, i64)> {
    let now = SystemTime::now();
    let resolve = |expression: &str| -> Result<i64> {
        let time = datemath::resolve(expression, now)
            .map_err(|error| anyhow!("invalid time `{expression}`: {error}"))?;
        let nanos = time
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        i64::try_from(nanos).context("time out of range")
    };
    Ok((resolve(&window.from)?, resolve(&window.to)?))
}

/// Read every source in one pass and fail on any that has no spans: an empty
/// head or baseline would turn every entry point into a change.
async fn collect_runs(sources: &[Source<'_>], ignore_spans: &[String]) -> Result<Vec<RunStats>> {
    let (traces_sql, spans_sql) = aggregate_sql(sources, ignore_spans);
    let traces = query_local(&traces_sql).await?;
    let spans = query_local(&spans_sql).await?;
    let runs = runs_from_rows(sources.len(), &traces, &spans)?;

    for (source, run) in sources.iter().zip(&runs) {
        if !run.entry_points.is_empty() {
            continue;
        }
        match source {
            Source::Collector { window, .. } => bail!(
                "no traces in the local collector between {} and {}. Check that the services \
                 export OTLP to the local collector and were stopped before this step, so \
                 their last spans were flushed.",
                window.from,
                window.to
            ),
            Source::File(path) => bail!("snapshot {} has no spans", path.display()),
        }
    }
    Ok(runs)
}

// The collector reads and writes snapshot files itself, so paths must be
// absolute: its working directory is not this command's.
fn absolute(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    Ok(std::env::current_dir()
        .context("resolve current directory")?
        .join(path))
}

fn existing_snapshot(path: &Path) -> Result<PathBuf> {
    std::fs::canonicalize(path).with_context(|| format!("read snapshot {}", path.display()))
}

pub async fn run_snapshot(args: TraceSnapshotArgs) -> Result<()> {
    let (from, to) = window_nanos(&args.window)?;
    let collector = Source::Collector {
        window: &args.window,
        from,
        to,
    };
    let stats = collect_runs(std::slice::from_ref(&collector), &[]).await?;
    let out = absolute(&args.out)?;

    let sql = format!(
        "INSERT INTO FUNCTION file({}, 'Parquet') \
         SETTINGS output_format_parquet_compression_method = 'zstd', \
           engine_file_truncate_on_insert = 1 \
         SELECT {SNAPSHOT_COLUMNS} FROM traces WHERE {} \
         ORDER BY TraceId, Timestamp",
        sql_string(&out.to_string_lossy()),
        window_condition(from, to)
    );
    query_local(&sql)
        .await
        .with_context(|| format!("write snapshot {}", out.display()))?;

    let run = &stats[0];
    eprintln!(
        "Wrote {} ({} across {}).",
        out.display(),
        plural(run.traces(), "trace"),
        plural(run.entry_points.len() as u64, "entry point")
    );
    Ok(())
}

pub async fn run_diff(args: TraceDiffArgs) -> Result<()> {
    let (from, to) = window_nanos(&args.window)?;
    let head_path = args.head.as_deref().map(existing_snapshot).transpose()?;
    let base_paths = args
        .base
        .iter()
        .map(|path| existing_snapshot(path))
        .collect::<Result<Vec<_>>>()?;

    let mut sources = vec![match &head_path {
        Some(path) => Source::File(path),
        None => Source::Collector {
            window: &args.window,
            from,
            to,
        },
    }];
    sources.extend(base_paths.iter().map(|path| Source::File(path)));

    let mut runs = collect_runs(&sources, &args.ignore_span).await?;
    let head = runs.remove(0);
    let report = diff(&runs, &head);

    let markdown = render_markdown(&report);
    match args.format {
        TraceDiffFormat::Markdown => print!("{markdown}"),
        TraceDiffFormat::Json => println!("{}", serde_json::to_string_pretty(&report)?),
    }
    if let Some(summary) = std::env::var_os("GITHUB_STEP_SUMMARY").filter(|path| !path.is_empty()) {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&summary)
            .context("open GITHUB_STEP_SUMMARY")?;
        writeln!(file, "{markdown}").context("write GITHUB_STEP_SUMMARY")?;
    }

    let failed = gate(&report, &args.fail_on);
    if !failed.is_empty() {
        let kinds: Vec<String> = failed
            .iter()
            .map(|(kind, count)| format!("{} ({count})", kind.label()))
            .collect();
        bail!(
            "trace diff found changes covered by --fail-on: {}",
            kinds.join(", ")
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sig(service: &str, name: &str) -> Signature {
        Signature {
            service: service.into(),
            kind: "Server".into(),
            name: name.into(),
        }
    }

    fn entry(name: &str, traces: u64, spans: &[(&str, u64, u64)]) -> EntryPoint {
        EntryPoint {
            entry: sig("api", name),
            traces,
            spans: spans
                .iter()
                .map(|(span, count, errors)| SpanStats {
                    signature: sig("db", span),
                    count: *count,
                    errors: *errors,
                })
                .collect(),
        }
    }

    fn stats(entries: Vec<EntryPoint>) -> RunStats {
        RunStats {
            entry_points: entries,
        }
    }

    fn kinds(report: &Report) -> Vec<ChangeKind> {
        report.changes().map(|change| change.kind).collect()
    }

    #[test]
    fn identical_runs_have_no_changes() {
        let run = stats(vec![entry("GET /orders", 2, &[("SELECT orders", 2, 0)])]);
        assert!(diff(std::slice::from_ref(&run), &run).entries.is_empty());
    }

    #[test]
    fn rates_are_per_trace_so_more_traces_alone_is_not_a_change() {
        let base = stats(vec![entry("GET /orders", 1, &[("SELECT orders", 1, 0)])]);
        let head = stats(vec![entry("GET /orders", 3, &[("SELECT orders", 3, 0)])]);
        assert!(diff(&[base], &head).entries.is_empty());
    }

    #[test]
    fn reports_a_query_running_more_often_per_request() {
        let base = stats(vec![entry("GET /orders", 1, &[("SELECT items", 1, 0)])]);
        let head = stats(vec![entry("GET /orders", 1, &[("SELECT items", 12, 0)])]);
        let report = diff(&[base], &head);

        let change = report.changes().next().unwrap();
        assert_eq!(change.kind, ChangeKind::CountChanged);
        assert_eq!(change.base, Some(Range { min: 1.0, max: 1.0 }));
        assert_eq!(change.head, Some(12.0));
    }

    #[test]
    fn a_value_inside_the_baseline_range_is_not_a_change() {
        let one = stats(vec![entry("GET /orders", 1, &[("SELECT items", 1, 0)])]);
        let three = stats(vec![entry("GET /orders", 1, &[("SELECT items", 3, 0)])]);
        let head = stats(vec![entry("GET /orders", 1, &[("SELECT items", 2, 0)])]);
        assert!(diff(&[one, three], &head).entries.is_empty());
    }

    #[test]
    fn reports_new_and_removed_spans() {
        let base = stats(vec![entry("GET /orders", 1, &[("SELECT orders", 1, 0)])]);
        let head = stats(vec![entry("GET /orders", 1, &[("SELECT carts", 1, 0)])]);
        assert_eq!(
            kinds(&diff(&[base], &head)),
            [ChangeKind::NewSpan, ChangeKind::RemovedSpan]
        );
    }

    #[test]
    fn a_span_seen_in_only_some_baselines_is_neither_new_nor_removed() {
        let with = stats(vec![entry("GET /orders", 1, &[("cache miss", 1, 0)])]);
        let without = stats(vec![entry("GET /orders", 1, &[])]);
        assert!(
            diff(&[with.clone(), without.clone()], &without)
                .entries
                .is_empty()
        );
        assert!(diff(&[with.clone(), without], &with).entries.is_empty());
    }

    #[test]
    fn reports_new_errors_on_an_existing_span() {
        let base = stats(vec![entry("GET /orders", 2, &[("SELECT orders", 2, 0)])]);
        let head = stats(vec![entry("GET /orders", 2, &[("SELECT orders", 2, 1)])]);
        let report = diff(&[base], &head);

        let change = report.changes().next().unwrap();
        assert_eq!(change.kind, ChangeKind::ErrorsIncreased);
        assert_eq!(change.head, Some(0.5));
    }

    #[test]
    fn reports_new_entry_points_and_ones_every_baseline_had() {
        let base = stats(vec![entry("GET /orders", 1, &[])]);
        let head = stats(vec![entry("GET /carts", 1, &[])]);
        assert_eq!(
            kinds(&diff(&[base], &head)),
            [ChangeKind::NewEntryPoint, ChangeKind::RemovedEntryPoint]
        );
    }

    #[test]
    fn gate_counts_only_the_requested_kinds() {
        let base = stats(vec![entry("GET /orders", 1, &[("SELECT orders", 1, 0)])]);
        let head = stats(vec![entry("GET /orders", 1, &[("SELECT carts", 1, 0)])]);
        let report = diff(&[base], &head);

        assert_eq!(
            gate(&report, &[ChangeKind::NewSpan]),
            [(ChangeKind::NewSpan, 1)]
        );
        assert!(gate(&report, &[ChangeKind::CountChanged]).is_empty());
    }

    #[test]
    fn markdown_shows_each_change_under_its_entry_point() {
        let base = stats(vec![entry("GET /orders", 1, &[("SELECT items", 1, 0)])]);
        let head = stats(vec![entry("GET /orders", 2, &[("SELECT items", 24, 0)])]);
        let markdown = render_markdown(&diff(&[base], &head));

        assert!(markdown.contains("### `api` Server `GET /orders` (2 traces)"));
        assert!(markdown.contains("| count changed | `db` Server `SELECT items` | 1 | 12 |"));
    }

    #[test]
    fn markdown_says_when_nothing_changed_or_there_is_no_baseline() {
        let run = stats(vec![entry("GET /orders", 1, &[])]);
        assert!(render_markdown(&diff(std::slice::from_ref(&run), &run)).contains("no changes"));
        assert!(render_markdown(&diff(&[], &run)).contains("No baseline snapshot"));
    }

    #[test]
    fn without_a_baseline_nothing_counts_as_new() {
        let run = stats(vec![entry("GET /orders", 1, &[])]);
        assert!(gate(&diff(&[], &run), &[ChangeKind::NewEntryPoint]).is_empty());
    }

    #[test]
    fn splits_query_rows_into_runs_with_quoted_or_plain_numbers() {
        let traces = Rows {
            values: vec![json!({
                "run": 1,
                "entry_service": "api", "entry_kind": "Server", "entry_name": "GET /orders",
                "traces": "2",
            })],
        };
        let spans = Rows {
            values: vec![json!({
                "run": "1",
                "entry_service": "api", "entry_kind": "Server", "entry_name": "GET /orders",
                "service": "db", "kind": "Server", "name": "SELECT orders",
                "count": 4, "errors": "1",
            })],
        };

        assert_eq!(
            runs_from_rows(2, &traces, &spans).unwrap(),
            [
                RunStats::default(),
                stats(vec![entry("GET /orders", 2, &[("SELECT orders", 4, 1)])])
            ]
        );
    }

    #[test]
    fn quotes_paths_safely_in_sql() {
        assert_eq!(sql_string(r"/tmp/it's\here"), r"'/tmp/it\'s\\here'");
    }
}
