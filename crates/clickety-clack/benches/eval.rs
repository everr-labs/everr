use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::instance::InstanceState;
use cc::domain::rule::Severity;
use cc::engine::{evaluate, EvalInput};
use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use std::collections::BTreeMap;
use std::hint::black_box;
use time::OffsetDateTime;
use uuid::Uuid;

fn labels(n: usize) -> BTreeMap<String, String> {
    (0..n).map(|i| (format!("k{i}"), format!("v{i}"))).collect()
}

// 2b: present-row transition over a realistic label set.
// `move` is the current code — labels are moved into `next.labels`.
// `clone_baseline` simulates the pre-change path, which performed one extra per-row label
// clone inside `evaluate` (`next.labels = input.labels.clone()`). The delta between the two
// arms is precisely that eliminated clone (both arms share the input-labels clone and the
// `prev.clone()` that the move did not change).
fn bench_evaluate(c: &mut Criterion) {
    let tenant = TenantId::from_trusted(Uuid::nil().to_string());
    let rule = RuleId(Uuid::nil());
    let ann = BTreeMap::new();
    let base = InstanceState::new_inactive(InstanceKey("k".into()), rule, tenant, labels(8));
    let src = labels(8);

    let mut g = c.benchmark_group("evaluate_present_fire");
    // One `evaluate` call == one instance evaluation; criterion prints elements/sec, i.e.
    // the single-core ceiling of state transitions ("evaluations/sec").
    g.throughput(Throughput::Elements(1));
    g.bench_function("move", |b| {
        b.iter(|| {
            let input = EvalInput {
                present: true,
                value: Some(1.0),
                labels: src.clone(),
                for_duration: time::Duration::seconds(0),
                resolve_after: 1,
                severity: Severity::Warning,
                annotations: &ann,
                eval_ts: OffsetDateTime::UNIX_EPOCH,
            };
            black_box(evaluate(black_box(base.clone()), input))
        })
    });
    g.bench_function("clone_baseline", |b| {
        b.iter(|| {
            let labels = src.clone();
            // The extra clone the pre-change `evaluate` did internally.
            let extra = black_box(labels.clone());
            let input = EvalInput {
                present: true,
                value: Some(1.0),
                labels,
                for_duration: time::Duration::seconds(0),
                resolve_after: 1,
                severity: Severity::Warning,
                annotations: &ann,
                eval_ts: OffsetDateTime::UNIX_EPOCH,
            };
            black_box((evaluate(black_box(base.clone()), input), extra))
        })
    });
    g.finish();
}

criterion_group!(benches, bench_evaluate);
criterion_main!(benches);
