use std::io::BufRead;
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::telemetry::otlp::{self, KeyValue, OtlpSignal};
use crate::telemetry::store::{StoreError, TelemetryStore};

#[derive(Debug, Default, Clone)]
pub struct TraceFilter {
    pub since: Option<Duration>,
    pub name_like: Option<String>,
    pub trace_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Default, Clone)]
pub struct LogFilter {
    pub since: Option<Duration>,
    pub level: Option<String>,
    pub egrep: Option<String>,
    pub service: Option<String>,
    pub target: Option<String>,
    pub trace_id: Option<String>,
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

impl ScanStats {
    pub fn merge(&mut self, other: &ScanStats) {
        self.skipped_unreadable_files += other.skipped_unreadable_files;
        self.skipped_malformed_lines += other.skipped_malformed_lines;
    }
}

pub struct TraceTree {
    pub trace_id: String,
    pub activity_timestamp_ns: u64,
    pub service_name: String,
    pub spans: Vec<TraceRow>,
    /// Span IDs that matched the discovery-pass filters (for `← match` highlighting).
    pub matched_span_ids: std::collections::HashSet<String>,
}

pub(crate) fn system_time_ns(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        // as_nanos() returns u128; the cast is safe — u64 holds nanoseconds
        // up to year ~2554, well beyond any realistic timestamp.
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

impl TelemetryStore {
    pub fn logs(&self, filter: LogFilter) -> Result<(Vec<LogRow>, ScanStats), StoreError> {
        let files = self.otlp_files()?;
        if files.is_empty() {
            return Ok((Vec::new(), ScanStats::default()));
        }

        let cutoff_ns = filter.since.map(|dur| {
            system_time_ns(SystemTime::now()).saturating_sub(dur.as_nanos() as u64)
        });

        let grep_re = filter.egrep.as_ref().map(|pat| {
            regex::Regex::new(pat).unwrap_or_else(|_| regex::Regex::new(&regex::escape(pat)).unwrap())
        });

        let mut rows = Vec::new();
        let mut stats = ScanStats::default();

        for path in &files {
            let file = match std::fs::File::open(path) {
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

                            if let Some(cutoff) = cutoff_ns {
                                if ts < cutoff {
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
                                    Some(tid) if tid.eq_ignore_ascii_case(filter_tid) => {}
                                    _ => continue,
                                }
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

    /// Two-pass query: discovery finds matching trace IDs, hydration loads
    /// all spans for those traces. This reads files twice — an explicit
    /// tradeoff: acceptable for local telemetry volumes (typically <100 files),
    /// avoids unbounded memory from loading all spans in a single pass before
    /// knowing which traces survive filtering. Could be collapsed to a single
    /// pass with a HashMap<trace_id, Vec<TraceRow>> if volumes grow.
    pub fn trace_trees(&self, filter: TraceFilter) -> Result<(Vec<TraceTree>, ScanStats), StoreError> {
        let files = self.otlp_files()?;
        if files.is_empty() {
            return Ok((Vec::new(), ScanStats::default()));
        }

        // When --trace-id is set, skip the --since cutoff during discovery
        // so any known trace can be found regardless of age.
        let cutoff_ns = if filter.trace_id.is_some() {
            None
        } else {
            filter.since.map(|dur| {
                system_time_ns(SystemTime::now()).saturating_sub(dur.as_nanos() as u64)
            })
        };

        // --- Discovery pass: find candidate trace IDs and record matched span IDs ---
        let mut candidates: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        let mut matched_spans: std::collections::HashMap<String, std::collections::HashSet<String>> =
            std::collections::HashMap::new();
        let mut stats = ScanStats::default();

        for path in &files {
            let file = match std::fs::File::open(path) {
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
                    for ss in &rs.scope_spans {
                        for span in &ss.spans {
                            let ts = span.start_time_unix_nano.unwrap_or(0);

                            if let Some(cutoff) = cutoff_ns {
                                if ts < cutoff {
                                    continue;
                                }
                            }

                            if let Some(ref name_sub) = filter.name_like {
                                if !span.name.contains(name_sub.as_str()) {
                                    continue;
                                }
                            }

                            if let Some(ref filter_tid) = filter.trace_id {
                                if !span.trace_id.eq_ignore_ascii_case(filter_tid) {
                                    continue;
                                }
                            }

                            let entry = candidates
                                .entry(span.trace_id.clone())
                                .or_insert(0);
                            if ts > *entry {
                                *entry = ts;
                            }
                            matched_spans
                                .entry(span.trace_id.clone())
                                .or_default()
                                .insert(span.span_id.clone());
                        }
                    }
                }
            }
        }

        if candidates.is_empty() {
            return Ok((Vec::new(), stats));
        }

        // Sort by activity_timestamp descending, apply limit
        let mut sorted: Vec<(String, u64)> = candidates.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        if let Some(limit) = filter.limit {
            sorted.truncate(limit);
        }

        let selected_ids: std::collections::HashSet<String> =
            sorted.iter().map(|(id, _)| id.clone()).collect();
        let activity_timestamps: std::collections::HashMap<String, u64> =
            sorted.into_iter().collect();

        // --- Hydration pass: load all spans for selected traces ---
        let mut all_spans: Vec<TraceRow> = Vec::new();
        let mut hydrate_stats = ScanStats::default();

        for path in &files {
            let file = match std::fs::File::open(path) {
                Ok(f) => f,
                Err(_) => {
                    hydrate_stats.skipped_unreadable_files += 1;
                    continue;
                }
            };
            let reader = std::io::BufReader::new(file);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => {
                        hydrate_stats.skipped_malformed_lines += 1;
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
                        hydrate_stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };

                // Only collect spans for selected trace IDs
                for rs in &req.resource_spans {
                    for ss in &rs.scope_spans {
                        for span in &ss.spans {
                            if !selected_ids.contains(&span.trace_id) {
                                continue;
                            }
                            let start = span.start_time_unix_nano.unwrap_or(0);
                            let end = span.end_time_unix_nano.unwrap_or(0);
                            let parent = if span.parent_span_id.is_empty() {
                                None
                            } else {
                                Some(span.parent_span_id.clone())
                            };

                            all_spans.push(TraceRow {
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
                            });
                        }
                    }
                }
            }
        }

        stats.merge(&hydrate_stats);

        // Group spans into TraceTree structs
        let mut tree_map: std::collections::HashMap<String, Vec<TraceRow>> =
            std::collections::HashMap::new();
        for span in all_spans {
            tree_map.entry(span.trace_id.clone()).or_default().push(span);
        }

        let mut trees: Vec<TraceTree> = tree_map
            .into_iter()
            .map(|(trace_id, spans)| {
                let activity_ts = activity_timestamps.get(&trace_id).copied().unwrap_or(0);
                let service_name = spans
                    .first()
                    .and_then(|s| otlp::kv_str(&s.resource_attrs, "service.name"))
                    .unwrap_or("")
                    .to_string();
                let matched = matched_spans.remove(&trace_id).unwrap_or_default();
                TraceTree {
                    trace_id,
                    activity_timestamp_ns: activity_ts,
                    service_name,
                    spans,
                    matched_span_ids: matched,
                }
            })
            .collect();

        trees.sort_by(|a, b| b.activity_timestamp_ns.cmp(&a.activity_timestamp_ns));

        Ok((trees, stats))
    }
}
