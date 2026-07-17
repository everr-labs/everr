use cc::dispatcher::inhibition::is_inhibited;
use cc::dispatcher::routing::{match_labels, select_grouping_targets};
use cc::dispatcher::silence::is_silenced;
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::inhibition::InhibitionRule;
use cc::domain::routing::{MatchOp, Matcher, Route};
use cc::domain::rule::Severity;
use cc::domain::silence::Silence;
use cc::domain::{Event, EventStatus};
use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use std::collections::BTreeMap;
use std::hint::black_box;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

// 1c: cached regex match vs. compiling on every call (the pre-change baseline).
fn bench_regex(c: &mut Criterion) {
    let mut g = c.benchmark_group("regex_full_match");
    // One match per iteration; criterion prints elements/sec == matches/sec.
    g.throughput(Throughput::Elements(1));
    g.bench_function("cached", |b| {
        b.iter(|| {
            cc::dispatcher::matching::regex_full_match(black_box("api-.*"), black_box("api-1"))
        })
    });
    g.bench_function("uncached_baseline", |b| {
        b.iter(|| {
            let re = regex::Regex::new("^(?:api-.*)$").unwrap();
            black_box(re.is_match(black_box("api-1")))
        })
    });
    g.finish();
}

fn tenant() -> TenantId {
    TenantId::from_trusted(Uuid::nil().to_string())
}

fn m(label: &str, op: MatchOp, value: &str) -> Matcher {
    Matcher {
        label: label.into(),
        op,
        value: value.into(),
    }
}

fn route(receiver: &str, cont: bool, matchers: Vec<Matcher>) -> Route {
    Route {
        id: Uuid::nil(),
        tenant: tenant(),
        matchers,
        receiver: receiver.into(),
        continue_matching: cont,
        priority: 0,
        group_by: None,
        group_wait_secs: None,
        group_interval_secs: None,
        repeat_interval_secs: None,
    }
}

fn silence(matchers: Vec<Matcher>, now: OffsetDateTime) -> Silence {
    Silence {
        id: Uuid::nil(),
        tenant: tenant(),
        matchers,
        starts_at: now - Duration::seconds(1),
        ends_at: now + Duration::hours(1),
        comment: String::new(),
        author: String::new(),
        created_at: now,
    }
}

fn inhibition(source: Vec<Matcher>, target: Vec<Matcher>, equal: &[&str]) -> InhibitionRule {
    InhibitionRule {
        id: Uuid::nil(),
        tenant: tenant(),
        source_matchers: source,
        target_matchers: target,
        equal: equal.iter().map(|s| s.to_string()).collect(),
        created_at: OffsetDateTime::UNIX_EPOCH,
    }
}

// The per-event routing/filter decision that `process_event` runs on the CPU before any
// Redis/Postgres I/O: build the matchable label set, test silences, test inhibitions, then
// select grouping targets. Criterion prints elements/sec == events/sec (the single-core
// dispatch-decision ceiling; the real system is gated by snapshot load + group writes).
fn bench_route_decision(c: &mut Criterion) {
    let now = OffsetDateTime::UNIX_EPOCH;
    let ev = Event {
        tenant: tenant(),
        rule: RuleId(Uuid::nil()),
        slo: None,
        instance_key: InstanceKey("inst-db1".into()),
        status: EventStatus::Firing,
        kind: cc::domain::EventKind::Alert,
        labels: (0..8)
            .map(|i| (format!("k{i}"), format!("v{i}")))
            .chain([("svc".to_string(), "api".to_string())])
            .collect(),
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: now,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    };

    // A handful of routes; the matching one is last (worst case: full walk).
    let routes = vec![
        route("a", false, vec![m("svc", MatchOp::Eq, "web")]),
        route("b", false, vec![m("severity", MatchOp::Eq, "critical")]),
        route("c", false, vec![m("k0", MatchOp::Eq, "nope")]),
        route("d", false, vec![m("svc", MatchOp::Regex, "db-.*")]),
        route("ops", false, vec![m("svc", MatchOp::Eq, "api")]),
    ];
    // Active silences that exercise the matcher path but do not match the event.
    let silences = vec![
        silence(vec![m("svc", MatchOp::Eq, "web")], now),
        silence(vec![m("k1", MatchOp::Eq, "other")], now),
        silence(vec![m("severity", MatchOp::Eq, "critical")], now),
    ];
    // Inhibition rules whose target matches (so the firing set is scanned) but `equal`
    // never lines up — representative of the common "checked, not inhibited" path.
    let inhibitions = vec![inhibition(
        vec![m("severity", MatchOp::Eq, "critical")],
        vec![m("severity", MatchOp::Eq, "warning")],
        &["instance"],
    )];
    let firing: Vec<(InstanceKey, BTreeMap<String, String>)> = (0..10)
        .map(|i| {
            (
                InstanceKey(format!("src-{i}")),
                [
                    ("severity".to_string(), "critical".to_string()),
                    ("instance".to_string(), format!("host-{i}")),
                ]
                .into_iter()
                .collect(),
            )
        })
        .collect();

    let mut g = c.benchmark_group("dispatch_route_decision");
    g.throughput(Throughput::Elements(1));
    g.bench_function("match_silence_inhibit_route", |b| {
        b.iter(|| {
            let labels = match_labels(black_box(&ev));
            let silenced = is_silenced(&labels, black_box(&silences), now);
            let inhibited =
                is_inhibited(&labels, &ev.instance_key, black_box(&inhibitions), &firing);
            let targets = select_grouping_targets(black_box(&routes), &labels);
            black_box((silenced, inhibited, targets))
        })
    });
    g.finish();
}

criterion_group!(benches, bench_regex, bench_route_decision);
criterion_main!(benches);
