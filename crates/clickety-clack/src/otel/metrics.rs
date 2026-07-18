//! Engine self-observability metrics on the same PUBLIC OTLP path as the engine traces
//! (see `engine.rs`): a small, fixed set of instruments describing the health of the
//! scheduler → queue → evaluator → dispatcher pipeline, shipped to everr's internal
//! tenant. Cardinality is kept deliberately low: `tenant` is the only high-ish-cardinality
//! attribute and per-rule attributes are never recorded.
//!
//! [`EngineMetrics`] is a cheap-to-clone handle threaded through the components that own
//! each measured operation (the same way the alert-log sink is threaded). When the engine
//! OTLP env vars are unset the handle is constructed [`disabled`](EngineMetrics::disabled)
//! and every recording method is a no-op.

use opentelemetry::metrics::{Counter, Histogram, Meter};
use opentelemetry::KeyValue;
use std::sync::Arc;

/// Outcome attribute of one ClickHouse evaluation query round-trip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryOutcome {
    Success,
    Error,
}

impl QueryOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            QueryOutcome::Success => "success",
            QueryOutcome::Error => "error",
        }
    }
}

/// What failed, for `cc.eval.errors`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvalErrorKind {
    /// The ClickHouse evaluation query itself failed.
    Query,
    /// The query succeeded but evaluating one rule against the rows errored.
    RuleEval,
    /// The evaluator's queue consume call failed.
    Consume,
    /// A whole consume batch panicked and was caught by the per-batch isolation.
    BatchPanic,
}

impl EvalErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EvalErrorKind::Query => "query",
            EvalErrorKind::RuleEval => "rule_eval",
            EvalErrorKind::Consume => "consume",
            EvalErrorKind::BatchPanic => "batch_panic",
        }
    }
}

/// Outcome attribute of one notification delivery attempt chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryOutcome {
    /// Delivered (possibly after retries).
    Sent,
    /// Retries exhausted or permanent failure; the event was dead-lettered.
    Failed,
    /// No notifier registered for the receiver's channel; dead-lettered.
    NoNotifier,
}

impl DeliveryOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            DeliveryOutcome::Sent => "sent",
            DeliveryOutcome::Failed => "failed",
            DeliveryOutcome::NoNotifier => "no_notifier",
        }
    }
}

/// Non-negative elapsed seconds from `from` to `to`; clock skew or an out-of-order pair
/// clamps to zero rather than recording a negative duration.
pub fn elapsed_seconds(from: time::OffsetDateTime, to: time::OffsetDateTime) -> f64 {
    (to - from).as_seconds_f64().max(0.0)
}

/// Bucket boundaries (seconds) for operation latencies: sub-millisecond up to 30s.
const DURATION_BOUNDARIES: [f64; 14] = [
    0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0,
];

/// Bucket boundaries (seconds) for lag/drift: milliseconds up to minutes.
const LAG_BOUNDARIES: [f64; 13] = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0,
];

/// Bucket boundaries for consume batch sizes (the consume cap is 16 today; headroom above).
const BATCH_SIZE_BOUNDARIES: [f64; 7] = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0];

struct Instruments {
    eval_duration: Histogram<f64>,
    eval_errors: Counter<u64>,
    queue_consume_lag: Histogram<f64>,
    queue_batch_size: Histogram<u64>,
    queue_slo_consume_lag: Histogram<f64>,
    queue_slo_batch_size: Histogram<u64>,
    notify_deliveries: Counter<u64>,
    scheduler_drift: Histogram<f64>,
    outbox_relayed: Counter<u64>,
}

/// Handle over the engine's self-observability instruments. Cloning is cheap (one `Arc`).
/// The `Default` value is the disabled (no-op) handle.
#[derive(Clone, Default)]
pub struct EngineMetrics {
    inner: Option<Arc<Instruments>>,
}

impl EngineMetrics {
    /// The no-op handle used when `CC_ENGINE_OTLP_ENDPOINT` / `CC_ENGINE_INGEST_API_KEY`
    /// are unset: every recording method returns immediately.
    pub fn disabled() -> Self {
        Self { inner: None }
    }

    /// Build every instrument on `meter`. Called once at startup by
    /// [`init_engine_telemetry`](super::engine::init_engine_telemetry).
    pub fn new(meter: &Meter) -> Self {
        let inner = Instruments {
            eval_duration: meter
                .f64_histogram("cc.eval.duration")
                .with_unit("s")
                .with_description(
                    "Evaluator latency: one consume batch (stage=batch) or one coalesced \
                     ClickHouse query round-trip (stage=query).",
                )
                .with_boundaries(DURATION_BOUNDARIES.to_vec())
                .build(),
            eval_errors: meter
                .u64_counter("cc.eval.errors")
                .with_unit("{error}")
                .with_description(
                    "Evaluation failures by kind: query (ClickHouse), rule_eval (per-rule \
                     evaluation), consume (queue consume).",
                )
                .build(),
            queue_consume_lag: meter
                .f64_histogram("cc.queue.consume.lag")
                .with_unit("s")
                .with_description(
                    "Age of each consumed eval job: consume time minus enqueue time \
                     (from the Redis stream entry id).",
                )
                .with_boundaries(LAG_BOUNDARIES.to_vec())
                .build(),
            queue_batch_size: meter
                .u64_histogram("cc.queue.batch.size")
                .with_unit("{job}")
                .with_description("Jobs returned per non-empty eval-queue consume call.")
                .with_boundaries(BATCH_SIZE_BOUNDARIES.to_vec())
                .build(),
            queue_slo_consume_lag: meter
                .f64_histogram("cc.queue.slo.consume.lag")
                .with_unit("s")
                .with_description(
                    "Age of each consumed SLO eval job: consume time minus enqueue time \
                     (from the Redis stream entry id).",
                )
                .with_boundaries(LAG_BOUNDARIES.to_vec())
                .build(),
            queue_slo_batch_size: meter
                .u64_histogram("cc.queue.slo.batch.size")
                .with_unit("{job}")
                .with_description("Jobs returned per non-empty SLO-queue consume call.")
                .with_boundaries(BATCH_SIZE_BOUNDARIES.to_vec())
                .build(),
            notify_deliveries: meter
                .u64_counter("cc.notify.deliveries")
                .with_unit("{delivery}")
                .with_description("Notification delivery attempts by channel and outcome.")
                .build(),
            scheduler_drift: meter
                .f64_histogram("cc.scheduler.drift")
                .with_unit("s")
                .with_description(
                    "Scheduling drift per claimed rule: claim time minus the rule's \
                     next_eval due time.",
                )
                .with_boundaries(LAG_BOUNDARIES.to_vec())
                .build(),
            outbox_relayed: meter
                .u64_counter("cc.outbox.relayed")
                .with_unit("{event}")
                .with_description(
                    "Outbox rows re-published by the maintenance relay (events whose \
                     first publish did not complete).",
                )
                .build(),
        };
        Self {
            inner: Some(Arc::new(inner)),
        }
    }

    /// Whether this handle records anywhere (false for [`disabled`](Self::disabled)).
    pub fn is_enabled(&self) -> bool {
        self.inner.is_some()
    }

    /// One evaluator consume batch processed end to end.
    pub fn record_eval_batch(&self, seconds: f64) {
        if let Some(m) = &self.inner {
            m.eval_duration
                .record(seconds, &[KeyValue::new("stage", "batch")]);
        }
    }

    /// One ClickHouse evaluation query round-trip. An `Error` outcome also counts under
    /// `cc.eval.errors` with `kind=query`.
    pub fn record_eval_query(&self, seconds: f64, tenant: &str, outcome: QueryOutcome) {
        if let Some(m) = &self.inner {
            m.eval_duration.record(
                seconds,
                &[
                    KeyValue::new("stage", "query"),
                    KeyValue::new("outcome", outcome.as_str()),
                    KeyValue::new("tenant", tenant.to_string()),
                ],
            );
            if outcome == QueryOutcome::Error {
                m.eval_errors.add(
                    1,
                    &[
                        KeyValue::new("kind", EvalErrorKind::Query.as_str()),
                        KeyValue::new("tenant", tenant.to_string()),
                    ],
                );
            }
        }
    }

    /// One evaluation failure. `tenant` is omitted when unknown (e.g. a consume failure
    /// spans tenants).
    pub fn record_eval_error(&self, kind: EvalErrorKind, tenant: Option<&str>) {
        if let Some(m) = &self.inner {
            let mut attrs = vec![KeyValue::new("kind", kind.as_str())];
            if let Some(t) = tenant {
                attrs.push(KeyValue::new("tenant", t.to_string()));
            }
            m.eval_errors.add(1, &attrs);
        }
    }

    /// Size of one non-empty eval-queue consume batch.
    pub fn record_queue_batch_size(&self, size: usize) {
        if let Some(m) = &self.inner {
            m.queue_batch_size.record(size as u64, &[]);
        }
    }

    /// Enqueue-to-consume lag of one eval job.
    pub fn record_queue_lag(&self, seconds: f64) {
        if let Some(m) = &self.inner {
            m.queue_consume_lag.record(seconds, &[]);
        }
    }

    /// Size of one non-empty SLO-queue consume batch.
    pub fn record_queue_slo_batch_size(&self, size: usize) {
        if let Some(m) = &self.inner {
            m.queue_slo_batch_size.record(size as u64, &[]);
        }
    }

    /// Enqueue-to-consume lag of one SLO eval job.
    pub fn record_queue_slo_lag(&self, seconds: f64) {
        if let Some(m) = &self.inner {
            m.queue_slo_consume_lag.record(seconds, &[]);
        }
    }

    /// One notification delivery attempt chain (post-retry outcome).
    pub fn record_delivery(&self, channel: &str, tenant: &str, outcome: DeliveryOutcome) {
        if let Some(m) = &self.inner {
            m.notify_deliveries.add(
                1,
                &[
                    KeyValue::new("channel", channel.to_string()),
                    KeyValue::new("outcome", outcome.as_str()),
                    KeyValue::new("tenant", tenant.to_string()),
                ],
            );
        }
    }

    /// Drift of one claimed rule: claim time minus its `next_eval` due time.
    pub fn record_scheduler_drift(&self, seconds: f64, tenant: &str) {
        if let Some(m) = &self.inner {
            m.scheduler_drift
                .record(seconds, &[KeyValue::new("tenant", tenant.to_string())]);
        }
    }

    /// `count` outbox rows re-published by one maintenance relay pass.
    pub fn record_outbox_relayed(&self, count: u64) {
        if let Some(m) = &self.inner {
            if count > 0 {
                m.outbox_relayed.add(count, &[]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::{Duration, OffsetDateTime};

    #[test]
    fn elapsed_seconds_is_nonnegative_and_exact() {
        let t0 = OffsetDateTime::UNIX_EPOCH;
        assert_eq!(elapsed_seconds(t0, t0 + Duration::milliseconds(1500)), 1.5);
        assert_eq!(elapsed_seconds(t0, t0), 0.0);
        // Out-of-order (clock skew) clamps to zero instead of going negative.
        assert_eq!(elapsed_seconds(t0 + Duration::seconds(5), t0), 0.0);
    }

    #[test]
    fn outcome_and_kind_label_mapping() {
        assert_eq!(QueryOutcome::Success.as_str(), "success");
        assert_eq!(QueryOutcome::Error.as_str(), "error");
        assert_eq!(EvalErrorKind::Query.as_str(), "query");
        assert_eq!(EvalErrorKind::RuleEval.as_str(), "rule_eval");
        assert_eq!(EvalErrorKind::Consume.as_str(), "consume");
        assert_eq!(DeliveryOutcome::Sent.as_str(), "sent");
        assert_eq!(DeliveryOutcome::Failed.as_str(), "failed");
        assert_eq!(DeliveryOutcome::NoNotifier.as_str(), "no_notifier");
    }

    /// The unconfigured handle must be safe to call from every instrumentation point.
    #[test]
    fn disabled_handle_is_a_noop() {
        let m = EngineMetrics::disabled();
        assert!(!m.is_enabled());
        m.record_eval_batch(0.1);
        m.record_eval_query(0.1, "t1", QueryOutcome::Error);
        m.record_eval_error(EvalErrorKind::Consume, None);
        m.record_queue_batch_size(16);
        m.record_queue_lag(0.05);
        m.record_queue_slo_batch_size(16);
        m.record_queue_slo_lag(0.05);
        m.record_delivery("webhook", "t1", DeliveryOutcome::Sent);
        m.record_scheduler_drift(0.2, "t1");
        m.record_outbox_relayed(3);
        // Default is the disabled handle too.
        assert!(!EngineMetrics::default().is_enabled());
    }

    /// Enabled-path smoke + name/attribute assertions against an in-memory exporter.
    #[test]
    fn enabled_handle_records_expected_instruments() {
        use opentelemetry::metrics::MeterProvider as _;
        use opentelemetry_sdk::metrics::data::AggregatedMetrics;
        use opentelemetry_sdk::metrics::{InMemoryMetricExporter, PeriodicReader};

        let exporter = InMemoryMetricExporter::default();
        let provider = opentelemetry_sdk::metrics::SdkMeterProvider::builder()
            .with_reader(PeriodicReader::builder(exporter.clone()).build())
            .build();
        let meter = provider.meter("cc-engine-test");
        let m = EngineMetrics::new(&meter);
        assert!(m.is_enabled());

        m.record_eval_batch(0.010);
        m.record_eval_query(0.020, "t1", QueryOutcome::Error);
        m.record_eval_error(EvalErrorKind::RuleEval, Some("t1"));
        m.record_queue_batch_size(4);
        m.record_queue_lag(0.5);
        m.record_queue_slo_batch_size(4);
        m.record_queue_slo_lag(0.5);
        m.record_delivery("slack", "t1", DeliveryOutcome::Failed);
        m.record_scheduler_drift(1.5, "t1");
        m.record_outbox_relayed(2);
        // Zero republished rows must not create a data point.
        m.record_outbox_relayed(0);

        provider.force_flush().unwrap();
        let finished = exporter.get_finished_metrics().unwrap();
        let names: Vec<String> = finished
            .iter()
            .flat_map(|rm| rm.scope_metrics())
            .flat_map(|sm| sm.metrics())
            .map(|metric| metric.name().to_string())
            .collect();
        for expected in [
            "cc.eval.duration",
            "cc.eval.errors",
            "cc.queue.consume.lag",
            "cc.queue.batch.size",
            "cc.queue.slo.consume.lag",
            "cc.queue.slo.batch.size",
            "cc.notify.deliveries",
            "cc.scheduler.drift",
            "cc.outbox.relayed",
        ] {
            assert!(names.contains(&expected.to_string()), "missing {expected}");
        }

        // cc.eval.errors carries both the query-outcome-derived and the explicit error:
        // 1 (kind=query) + 1 (kind=rule_eval) = 2 total across data points.
        let error_total: u64 = finished
            .iter()
            .flat_map(|rm| rm.scope_metrics())
            .flat_map(|sm| sm.metrics())
            .filter(|metric| metric.name() == "cc.eval.errors")
            .map(|metric| match metric.data() {
                AggregatedMetrics::U64(opentelemetry_sdk::metrics::data::MetricData::Sum(sum)) => {
                    sum.data_points().map(|dp| dp.value()).sum::<u64>()
                }
                _ => panic!("cc.eval.errors must be a u64 sum"),
            })
            .sum();
        assert_eq!(error_total, 2);

        provider.shutdown().unwrap();
    }
}
