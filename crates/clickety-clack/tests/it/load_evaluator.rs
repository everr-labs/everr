use crate::common::*;

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::support::create_test_rule;
use cc::clickhouse::RowQuerier;
use cc::domain::ids::{RuleId, TenantId};
use cc::domain::rule::{RuleSpec, Severity};
use cc::evaluator::process_batch_inner;
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EvalJob, Queue};
use cc::stores::PgStore;
use time::OffsetDateTime;
use uuid::Uuid;

const BLOCK_MS: usize = 100;

fn enqueue_round(
    queue: &Arc<dyn Queue>,
    tenant: &TenantId,
    rule_ids: &[RuleId],
    eval_ts: OffsetDateTime,
) -> impl std::future::Future<Output = ()> + Send {
    let queue = queue.clone();
    let tenant = tenant.clone();
    let rule_ids = rule_ids.to_vec();
    async move {
        for rule in rule_ids {
            queue
                .enqueue(&EvalJob {
                    tenant: tenant.clone(),
                    rule,
                    eval_ts,
                })
                .await
                .unwrap();
        }
    }
}

/// Measure steady-state evaluator throughput.
///
/// Workers are spawned ONCE and hold a PERSISTENT per-worker `health` map, exactly as the
/// long-running `run_evaluator` does. Each map is pre-seeded with every rule as known-healthy
/// so the measured phase exercises the steady-state path that SKIPS the `record_rule_success`
/// round-trip (the optimization under test) on EVERY worker. A processing-only warm phase
/// cannot guarantee that: it enqueues one job per rule, so each rule warms on just the one
/// worker that happens to draw it, and a measured job landing on a different worker would
/// still pay the cold path and skew the result. The warm phase is still run, untimed, so the
/// measured phase upserts existing instance rows rather than inserting them.
///
/// A `gate` parks the workers while measured jobs are enqueued (so enqueue is excluded from
/// the timer), and a settle longer than `BLOCK_MS` ensures no in-flight blocking `consume`
/// picks up a measured job before the timer starts. Returns the measured-phase wall-clock.
#[allow(clippy::too_many_arguments)]
async fn measure_steady_state(
    store: &PgStore,
    ch: Arc<dyn RowQuerier>,
    queue: &Arc<dyn Queue>,
    workers: usize,
    tenant: &TenantId,
    rule_ids: &[RuleId],
    warm_ts: OffsetDateTime,
    meas_ts: OffsetDateTime,
) -> Duration {
    let total = rule_ids.len();
    let all = total * 2;
    let processed = Arc::new(AtomicUsize::new(0));
    let gate = Arc::new(AtomicBool::new(true)); // true = parked
    let stop = Arc::new(AtomicBool::new(false));

    // Pre-seed every worker's health map with all rules known-healthy (false = not
    // degraded), so each worker skips record_rule_success on the measured phase regardless
    // of which worker draws which rule. See the function doc for why the warm phase alone
    // cannot guarantee this.
    let warm_health: HashMap<RuleId, bool> = rule_ids.iter().map(|&r| (r, false)).collect();

    let mut handles = Vec::new();
    for w in 0..workers {
        let store = store.clone();
        let ch = ch.clone();
        let queue = queue.clone();
        let processed = processed.clone();
        let gate = gate.clone();
        let stop = stop.clone();
        let mut health = warm_health.clone();
        handles.push(tokio::spawn(async move {
            let consumer = format!("eval-w{w}");
            loop {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                if gate.load(Ordering::Relaxed) {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                    continue;
                }
                let deliveries = queue.consume(&consumer, 16, BLOCK_MS).await.unwrap();
                if deliveries.is_empty() {
                    continue;
                }
                let n = deliveries.len();
                let acks = process_batch_inner(
                    &store,
                    ch.as_ref(),
                    &NoopBus,
                    3,
                    deliveries,
                    &mut health,
                    &cc::otel::EngineMetrics::disabled(),
                )
                .await;
                for id in &acks {
                    queue.ack(id).await.unwrap();
                }
                processed.fetch_add(n, Ordering::Relaxed);
            }
        }));
    }

    // Warm phase (untimed): one evaluation per rule so the measured phase upserts existing
    // instance rows. Health is already pre-seeded above, so this need not warm the maps.
    enqueue_round(queue, tenant, rule_ids, warm_ts).await;
    gate.store(false, Ordering::Relaxed);
    while processed.load(Ordering::Relaxed) < total {
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    // Park workers and let any in-flight blocking consume return before enqueuing measured.
    gate.store(true, Ordering::Relaxed);
    tokio::time::sleep(Duration::from_millis(BLOCK_MS as u64 + 50)).await;

    // Measured phase: enqueue while parked (excluded from timer), then release and time.
    enqueue_round(queue, tenant, rule_ids, meas_ts).await;
    let t0 = Instant::now();
    gate.store(false, Ordering::Relaxed);
    while processed.load(Ordering::Relaxed) < all {
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    let elapsed = t0.elapsed();

    stop.store(true, Ordering::Relaxed);
    gate.store(false, Ordering::Relaxed);
    for h in handles {
        h.await.unwrap();
    }
    elapsed
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --features container-tests --test it -- --ignored --nocapture load_evaluator_throughput"]
async fn load_evaluator_throughput() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    let ch = ch_backend(&cfg, cfg.instances_per_rule).await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    // Seed rules (distinct SQL unless coalesce forced).
    let mut rule_ids = Vec::with_capacity(cfg.rules);
    for i in 0..cfg.rules {
        let spec = RuleSpec {
            sql: rule_sql(i, cfg.coalesce),
            interval_secs: 30,
            for_secs: 0,
            label_columns: vec!["svc".into()],
            value_column: Some("val".into()),
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            resolve_after: 1,
            max_interval_secs: None,
            suppressed: false,
        };
        let rule =
            create_test_rule(&pg.store, tenant.clone(), &format!("load/rule-{i}"), &spec).await;
        rule_ids.push(rule.id);
    }

    let queue: Arc<dyn Queue> = Arc::new(RedisQueue::connect(&redis.url).await.unwrap());

    // Distinct eval_ts per phase so try_claim_eval treats them as separate evaluations.
    let warm_ts = OffsetDateTime::now_utc();
    let meas_ts = warm_ts + time::Duration::seconds(60);
    let elapsed = measure_steady_state(
        &pg.store,
        ch.querier.clone(),
        &queue,
        cfg.eval_workers,
        &tenant,
        &rule_ids,
        warm_ts,
        meas_ts,
    )
    .await;

    // Correctness gate: a sampled rule has its instances persisted.
    let sample = pg.store.load_instances(&tenant, rule_ids[0]).await.unwrap();
    assert_eq!(
        sample.len(),
        cfg.instances_per_rule,
        "evaluator persisted instances"
    );

    report(
        "evaluator",
        &[
            ("CH backend", format!("{:?}", cfg.ch)),
            ("coalesce", cfg.coalesce.to_string()),
            (
                "path",
                "steady-state (warm health, no transitions)".to_string(),
            ),
            ("rules", cfg.rules.to_string()),
            ("instances/rule", cfg.instances_per_rule.to_string()),
            ("workers", cfg.eval_workers.to_string()),
            ("wall", format!("{:.3}s", elapsed.as_secs_f64())),
            ("rules/sec", format!("{:.0}", per_sec(cfg.rules, elapsed))),
            (
                "evaluations/sec",
                format!(
                    "{:.0}",
                    per_sec(cfg.rules * cfg.instances_per_rule, elapsed)
                ),
            ),
        ],
    );
}
