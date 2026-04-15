use std::io::BufRead;

use serde::Serialize;

use crate::telemetry::otlp::{self, KeyValue, OtlpSignal};
use crate::telemetry::store::{StoreError, TelemetryStore};

#[derive(Debug, Default, Clone)]
pub struct TraceFilter {
    /// Minimum timestamp (epoch nanoseconds, inclusive).
    pub from_ns: Option<u64>,
    /// Maximum timestamp (epoch nanoseconds, inclusive).
    pub to_ns: Option<u64>,
    pub name_like: Option<String>,
    pub service: Option<String>,
    pub trace_id: Option<String>,
    pub attrs: Vec<(String, String)>,
    pub limit: Option<usize>,
}

#[derive(Debug, Default, Clone)]
pub struct LogFilter {
    /// Minimum timestamp (epoch nanoseconds, inclusive).
    pub from_ns: Option<u64>,
    /// Maximum timestamp (epoch nanoseconds, inclusive).
    pub to_ns: Option<u64>,
    pub level: Option<String>,
    pub egrep: Option<String>,
    pub service: Option<String>,
    pub target: Option<String>,
    pub trace_id: Option<String>,
    pub attrs: Vec<(String, String)>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TraceRow {
    pub timestamp_ns: u64,
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub name: String,
    pub kind: u8,
    pub status_code: u8,
    pub duration_ns: u64,
    #[serde(skip)]
    pub resource_attrs: Vec<KeyValue>,
    #[serde(skip)]
    pub span_attrs: Vec<KeyValue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogRow {
    pub timestamp_ns: u64,
    pub level: String,
    pub target: String,
    pub message: String,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    #[serde(skip)]
    pub resource_attrs: Vec<KeyValue>,
    #[serde(skip)]
    pub log_attrs: Vec<KeyValue>,
}

#[derive(Debug, Default, Clone)]
pub struct ScanStats {
    pub skipped_unreadable_files: usize,
    pub skipped_malformed_lines: usize,
}

pub struct TraceTree {
    #[allow(dead_code)] // consumed by integration tests
    pub trace_id: String,
    pub activity_timestamp_ns: u64,
    #[allow(dead_code)] // consumed by integration tests
    pub service_name: String,
    pub spans: Vec<TraceRow>,
    /// Span IDs that matched the discovery filter within this trace. The rest of
    /// `spans` are hydrated context (parents/siblings of matched spans).
    #[allow(dead_code)] // consumed by integration tests
    pub matched_span_ids: Vec<String>,
}


impl TelemetryStore {
    pub fn logs(&self, filter: LogFilter) -> Result<(Vec<LogRow>, ScanStats), StoreError> {
        let files = self.otlp_files()?;
        if files.is_empty() {
            return Ok((Vec::new(), ScanStats::default()));
        }

        let from_ns = filter.from_ns;
        let to_ns = filter.to_ns;

        let grep_re = filter.egrep.as_ref().map(|pat| {
            regex::Regex::new(pat).unwrap_or_else(|_| regex::Regex::new(&regex::escape(pat)).unwrap())
        });

        let mut rows = Vec::new();
        let mut stats = ScanStats::default();

        for entry in &files {
            // File-level prune: `rotation_time_ns` is an upper bound on event
            // timestamps inside the file, so if it's already below --from the
            // file can't contain matching events. Files are sorted newest-first
            // with current/unparseable first, so once we hit this we can stop.
            if let (Some(rotation), Some(from)) = (entry.rotation_time_ns, from_ns) {
                if rotation < from {
                    break;
                }
            }

            let file = match std::fs::File::open(&entry.path) {
                Ok(f) => f,
                Err(_) => {
                    stats.skipped_unreadable_files += 1;
                    continue;
                }
            };
            let reader = std::io::BufReader::new(file);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => {
                        stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }

                let req = match otlp::dispatch_line(&line) {
                    Some(OtlpSignal::Logs(r)) => r,
                    Some(OtlpSignal::Traces(_)) => continue, // expected, not an error
                    None => {
                        stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };

                for rl in &req.resource_logs {
                    if let Some(ref svc) = filter.service {
                        let actual = otlp::kv_str(&rl.resource.attributes, "service.name")
                            .unwrap_or("");
                        if !actual.contains(svc.as_str()) {
                            continue;
                        }
                    }
                    for sl in &rl.scope_logs {
                        let target = if sl.scope.name.is_empty() {
                            String::new()
                        } else {
                            sl.scope.name.clone()
                        };
                        if let Some(ref tgt) = filter.target {
                            if !target.contains(tgt.as_str()) {
                                continue;
                            }
                        }
                        for record in &sl.log_records {
                            let ts = otlp::resolve_log_timestamp(
                                record.time_unix_nano,
                                record.observed_time_unix_nano,
                            );

                            if let Some(from) = from_ns {
                                if ts < from {
                                    continue;
                                }
                            }
                            if let Some(to) = to_ns {
                                if ts > to {
                                    continue;
                                }
                            }

                            let level = &record.severity_text;
                            if let Some(ref lvl) = filter.level {
                                if !level.eq_ignore_ascii_case(lvl) {
                                    continue;
                                }
                            }

                            let message = otlp::body_string(&record.body);
                            if let Some(ref re) = grep_re {
                                if !re.is_match(&message) {
                                    continue;
                                }
                            }

                            let trace_id = if record.trace_id.is_empty() {
                                None
                            } else {
                                Some(record.trace_id.clone())
                            };

                            if let Some(ref filter_tid) = filter.trace_id {
                                match &trace_id {
                                    Some(tid) if tid.to_ascii_lowercase().starts_with(&filter_tid.to_ascii_lowercase()) => {}
                                    _ => continue,
                                }
                            }

                            if !attrs_match(&record.attributes, &filter.attrs) {
                                continue;
                            }

                            let span_id = if record.span_id.is_empty() {
                                None
                            } else {
                                Some(record.span_id.clone())
                            };

                            rows.push(LogRow {
                                timestamp_ns: ts,
                                level: level.clone(),
                                target: target.clone(),
                                message,
                                trace_id,
                                span_id,
                                resource_attrs: rl.resource.attributes.clone(),
                                log_attrs: record.attributes.clone(),
                            });
                        }
                    }
                }
            }
        }

        rows.sort_by(|a, b| b.timestamp_ns.cmp(&a.timestamp_ns));
        if let Some(limit) = filter.limit {
            rows.truncate(limit);
        }

        Ok((rows, stats))
    }

    /// Single-pass query. For each file we build a per-file map of
    /// `trace_id -> (spans, matched_span_ids)` and emit trees whose traces had
    /// at least one span matching the discovery filter.
    ///
    /// **Assumption: all spans for a given trace are written to the same
    /// rotated file.** The collector batches and rotates at a few MB, so a
    /// trace that straddles a rotation boundary would have some spans in the
    /// previous backup. We accept this truncation rather than pay the cost of
    /// a cross-file hydration pass — traces on this scale complete in
    /// milliseconds and the rotation window is many seconds of activity.
    /// Hydration of parent/sibling spans therefore stays within a single file.
    pub fn trace_trees(&self, filter: TraceFilter) -> Result<(Vec<TraceTree>, ScanStats), StoreError> {
        let files = self.otlp_files()?;
        if files.is_empty() {
            return Ok((Vec::new(), ScanStats::default()));
        }

        // When --trace-id is set, skip the --from cutoff during discovery
        // so any known trace can be found regardless of age.
        let from_ns = if filter.trace_id.is_some() {
            None
        } else {
            filter.from_ns
        };
        let to_ns = if filter.trace_id.is_some() {
            None
        } else {
            filter.to_ns
        };

        struct TraceAccum {
            activity_ts: u64,
            service_name: String,
            spans: Vec<TraceRow>,
            matched_span_ids: Vec<String>,
        }

        let mut trees_by_id: std::collections::HashMap<String, TraceAccum> =
            std::collections::HashMap::new();
        let mut stats = ScanStats::default();

        for entry in &files {
            // File-level prune by --from: `rotation_time_ns` is an upper bound
            // on event timestamps in a rotated file, so if it's below --from
            // the file can't contribute. Files are newest-first with the
            // current file (None) sorting first, so once we hit a skip we're
            // done. Suppressed when --trace-id is set, matching the per-span
            // behavior above.
            if let (Some(rotation), Some(from)) = (entry.rotation_time_ns, from_ns) {
                if rotation < from {
                    break;
                }
            }

            let file = match std::fs::File::open(&entry.path) {
                Ok(f) => f,
                Err(_) => {
                    stats.skipped_unreadable_files += 1;
                    continue;
                }
            };
            let reader = std::io::BufReader::new(file);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => {
                        stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }

                let req = match otlp::dispatch_line(&line) {
                    Some(OtlpSignal::Traces(r)) => r,
                    Some(OtlpSignal::Logs(_)) => continue,
                    None => {
                        stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };

                for rs in &req.resource_spans {
                    let svc_name = otlp::kv_str(&rs.resource.attributes, "service.name")
                        .unwrap_or("")
                        .to_string();
                    if let Some(ref svc) = filter.service {
                        if !svc_name.contains(svc.as_str()) {
                            continue;
                        }
                    }
                    for ss in &rs.scope_spans {
                        for span in &ss.spans {
                            let start = span.start_time_unix_nano.unwrap_or(0);
                            let end = span.end_time_unix_nano.unwrap_or(0);

                            let matches_filter = {
                                let in_window = from_ns.is_none_or(|f| start >= f)
                                    && to_ns.is_none_or(|t| start <= t);
                                let name_ok = filter
                                    .name_like
                                    .as_ref()
                                    .is_none_or(|n| span.name.contains(n.as_str()));
                                let tid_ok = filter.trace_id.as_ref().is_none_or(|t| {
                                    span.trace_id
                                        .to_ascii_lowercase()
                                        .starts_with(&t.to_ascii_lowercase())
                                });
                                let attrs_ok = attrs_match(&span.attributes, &filter.attrs);
                                in_window && name_ok && tid_ok && attrs_ok
                            };

                            let parent = if span.parent_span_id.is_empty() {
                                None
                            } else {
                                Some(span.parent_span_id.clone())
                            };

                            let row = TraceRow {
                                timestamp_ns: start,
                                trace_id: span.trace_id.clone(),
                                span_id: span.span_id.clone(),
                                parent_span_id: parent,
                                name: span.name.clone(),
                                kind: span.kind,
                                status_code: span.status.code,
                                duration_ns: end.saturating_sub(start),
                                resource_attrs: rs.resource.attributes.clone(),
                                span_attrs: span.attributes.clone(),
                            };

                            let accum = trees_by_id
                                .entry(span.trace_id.clone())
                                .or_insert_with(|| TraceAccum {
                                    activity_ts: 0,
                                    service_name: svc_name.clone(),
                                    spans: Vec::new(),
                                    matched_span_ids: Vec::new(),
                                });
                            if matches_filter {
                                if start > accum.activity_ts {
                                    accum.activity_ts = start;
                                }
                                accum.matched_span_ids.push(span.span_id.clone());
                            }
                            accum.spans.push(row);
                        }
                    }
                }
            }
        }

        let mut trees: Vec<TraceTree> = trees_by_id
            .into_iter()
            .filter(|(_, a)| !a.matched_span_ids.is_empty())
            .map(|(trace_id, a)| TraceTree {
                trace_id,
                activity_timestamp_ns: a.activity_ts,
                service_name: a.service_name,
                spans: a.spans,
                matched_span_ids: a.matched_span_ids,
            })
            .collect();

        trees.sort_by(|a, b| b.activity_timestamp_ns.cmp(&a.activity_timestamp_ns));
        if let Some(limit) = filter.limit {
            trees.truncate(limit);
        }

        Ok((trees, stats))
    }
}

/// Returns true if every (key, value) pair in `filter` is present in `kvs`.
/// Uses substring match on the stringValue representation.
fn attrs_match(kvs: &[otlp::KeyValue], filter: &[(String, String)]) -> bool {
    filter.iter().all(|(fk, fv)| {
        otlp::kv_str(kvs, fk)
            .map(|actual| actual.contains(fv.as_str()))
            .unwrap_or(false)
    })
}
