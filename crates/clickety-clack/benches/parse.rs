use cc::clickhouse::{parse_rows, ResultRow};
use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use std::collections::BTreeMap;
use std::hint::black_box;

fn body(rows: usize) -> String {
    let mut s = String::new();
    for i in 0..rows {
        s.push_str(&format!(
            "{{\"svc\":\"api-{i}\",\"region\":\"eu\",\"v\":{i}}}\n"
        ));
    }
    s
}

/// Parse each non-empty line separately for the benchmark baseline.
fn parse_lines_baseline(
    text: &str,
    label_columns: &[String],
    value_column: Option<&str>,
) -> Vec<ResultRow> {
    fn json_to_string(v: &serde_json::Value) -> String {
        match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }
    fn json_to_f64(v: &serde_json::Value) -> Option<f64> {
        match v {
            serde_json::Value::Number(n) => n.as_f64(),
            serde_json::Value::String(s) => s.parse().ok(),
            _ => None,
        }
    }
    let mut rows = Vec::new();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let obj: serde_json::Map<String, serde_json::Value> = serde_json::from_str(line).unwrap();
        let mut labels = BTreeMap::new();
        for col in label_columns {
            if let Some(v) = obj.get(col) {
                labels.insert(col.clone(), json_to_string(v));
            }
        }
        let value = value_column.and_then(|c| obj.get(c)).and_then(json_to_f64);
        // Match `parse_rows` by collecting non-label fields too.
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
    rows
}

// Compare streaming deserialization with parsing each line separately.
const ROWS: usize = 1000;

fn bench_parse(c: &mut Criterion) {
    let text = body(ROWS);
    let labels = vec!["svc".to_string(), "region".to_string()];
    let mut g = c.benchmark_group("parse_rows_1000");
    // Each element is one decoded row.
    g.throughput(Throughput::Elements(ROWS as u64));
    g.bench_function("stream", |b| {
        b.iter(|| black_box(parse_rows(black_box(&text), &labels, Some("v")).unwrap()))
    });
    g.bench_function("line_split_baseline", |b| {
        b.iter(|| black_box(parse_lines_baseline(black_box(&text), &labels, Some("v"))))
    });
    g.finish();
}

criterion_group!(benches, bench_parse);
criterion_main!(benches);
