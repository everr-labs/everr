use std::time::{Duration, SystemTime};

use duckdb::params_from_iter;
use serde::Serialize;
use serde_json::Value;

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
    pub grep: Option<String>,
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
    pub kind: String,
    pub status: String,
    pub duration_ns: u64,
    pub attributes: Value,
    pub resource: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogRow {
    pub timestamp_ns: u64,
    pub level: String,
    pub target: String,
    pub message: String,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    pub attributes: Value,
    pub resource: Value,
}

impl TelemetryStore {
    pub fn traces(&self, filter: TraceFilter) -> Result<Vec<TraceRow>, StoreError> {
        if crate::telemetry::store::count_otlp_files(self.dir()) == 0 {
            return Ok(Vec::new());
        }
        let glob = self.dir().join("otlp*.json*");
        let mut sql = format!(
            "SELECT \
                epoch_ms(\"timestamp\")::UBIGINT * 1000, \
                trace_id, \
                span_id, \
                nullif(parent_span_id, ''), \
                span_name, \
                span_kind::VARCHAR, \
                status_code::VARCHAR, \
                (end_timestamp * 1000000 - epoch_ms(\"timestamp\") * 1000)::UBIGINT, \
                coalesce(to_json(span_attributes)::VARCHAR, '{{}}'), \
                coalesce(to_json(resource_attributes)::VARCHAR, '{{}}') \
             FROM read_otlp_traces('{}')",
            glob.display()
        );
        let mut clauses: Vec<String> = Vec::new();
        let mut binds: Vec<String> = Vec::new();

        if let Some(dur) = filter.since {
            let cutoff_us = (system_time_ns(SystemTime::now()) - dur.as_nanos() as u64) / 1_000;
            clauses.push(format!("epoch_ms(\"timestamp\") >= {cutoff_us}"));
        }
        if let Some(substr) = &filter.name_like {
            clauses.push("span_name LIKE ?".into());
            binds.push(format!("%{substr}%"));
        }
        if let Some(trace) = &filter.trace_id {
            clauses.push("lower(trace_id) = lower(?)".into());
            binds.push(trace.clone());
        }
        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(" ORDER BY \"timestamp\" DESC");
        if let Some(limit) = filter.limit {
            sql.push_str(&format!(" LIMIT {limit}"));
        }

        let mut stmt = self.conn().prepare(&sql)?;
        let rows = stmt
            .query_map(params_from_iter(binds), |row| {
                Ok(TraceRow {
                    timestamp_ns: row.get::<_, u64>(0)?,
                    trace_id: row.get::<_, String>(1)?,
                    span_id: row.get::<_, String>(2)?,
                    parent_span_id: row.get::<_, Option<String>>(3)?,
                    name: row.get::<_, String>(4)?,
                    kind: row.get::<_, String>(5)?,
                    status: row.get::<_, String>(6)?,
                    duration_ns: row.get::<_, u64>(7)?,
                    attributes: parse_json(row.get::<_, String>(8)?),
                    resource: parse_json(row.get::<_, String>(9)?),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn logs(&self, filter: LogFilter) -> Result<Vec<LogRow>, StoreError> {
        if crate::telemetry::store::count_otlp_files(self.dir()) == 0 {
            return Ok(Vec::new());
        }
        let glob = self.dir().join("otlp*.json*");
        let mut sql = format!(
            "SELECT \
                extract('epoch' FROM \"timestamp\")::BIGINT * 1000, \
                severity_text, \
                '', \
                body::VARCHAR, \
                nullif(trace_id, ''), \
                nullif(span_id, ''), \
                coalesce(to_json(log_attributes)::VARCHAR, '{{}}'), \
                coalesce(to_json(resource_attributes)::VARCHAR, '{{}}') \
             FROM read_otlp_logs('{}')",
            glob.display()
        );
        let mut clauses: Vec<String> = Vec::new();
        let mut binds: Vec<String> = Vec::new();

        if let Some(dur) = filter.since {
            // The column expression is extract('epoch')::BIGINT * 1000 which
            // yields microseconds (DuckDB OTLP extension's extract('epoch')
            // returns milliseconds; * 1000 converts to microseconds).
            // Compute the cutoff in the same unit.
            let cutoff_us = system_time_ns(SystemTime::now()) / 1_000 - dur.as_micros() as u64;
            clauses.push(format!(
                "extract('epoch' FROM \"timestamp\")::BIGINT * 1000 >= {cutoff_us}"
            ));
        }
        if let Some(level) = &filter.level {
            clauses.push("upper(severity_text) = upper(?)".into());
            binds.push(level.clone());
        }
        if let Some(grep) = &filter.grep {
            clauses.push("regexp_matches(body::VARCHAR, ?)".into());
            binds.push(grep.clone());
        }
        if let Some(trace) = &filter.trace_id {
            clauses.push("lower(trace_id) = lower(?)".into());
            binds.push(trace.clone());
        }
        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(" ORDER BY epoch_ms(\"timestamp\") DESC");
        if let Some(limit) = filter.limit {
            sql.push_str(&format!(" LIMIT {limit}"));
        }

        let mut stmt = self.conn().prepare(&sql)?;
        let rows = stmt
            .query_map(params_from_iter(binds), |row| {
                Ok(LogRow {
                    timestamp_ns: row.get::<_, u64>(0)?,
                    level: row.get::<_, String>(1)?,
                    target: row.get::<_, String>(2)?,
                    message: row.get::<_, String>(3)?,
                    trace_id: row.get::<_, Option<String>>(4)?,
                    span_id: row.get::<_, Option<String>>(5)?,
                    attributes: parse_json(row.get::<_, String>(6)?),
                    resource: parse_json(row.get::<_, String>(7)?),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

fn parse_json(s: String) -> Value {
    let Ok(mut value) = serde_json::from_str::<Value>(&s) else {
        return Value::Null;
    };

    loop {
        let Value::String(inner) = value else {
            return value;
        };

        match serde_json::from_str::<Value>(&inner) {
            Ok(parsed) => value = parsed,
            Err(_) => return Value::String(inner),
        }
    }
}

fn system_time_ns(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}
