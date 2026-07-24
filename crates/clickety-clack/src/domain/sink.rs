//! Dispatcher-side alert-log sink abstraction.
//!
//! Placed in `cc-domain` (which has no crate deps) so that `cc-otel` can implement the
//! sink and the dispatcher can consume it as a trait object, without a
//! `cc-otel` <-> `cc-dispatcher` dependency cycle.

use crate::domain::Event;
use async_trait::async_trait;
use std::collections::BTreeMap;

/// What the dispatcher knows post-routing / post-silence: which receivers an event was
/// delivered to, and (if suppressed) the silence that matched.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeliveryFacts {
    pub delivery_targets: Vec<String>,
    pub silence_id: Option<String>,
    pub silenced: bool,
}

/// Sink for dispatcher-side alert logs (delivery + silenced records). Implemented by
/// `cc-otel` in production; the no-op `NullSink` keeps tests and no-export deploys simple.
#[async_trait]
pub trait AlertLogSink: Send + Sync {
    async fn record_delivery(&self, ev: &Event, facts: &DeliveryFacts);
}

/// No-op sink for tests and deployments that don't export alert logs.
pub struct NullSink;

#[async_trait]
impl AlertLogSink for NullSink {
    async fn record_delivery(&self, _ev: &Event, _facts: &DeliveryFacts) {}
}

/// One raw SLO measurement: the `(good, valid)` counts a single window's SLI
/// query returned for one group this evaluation tick. The engine records these
/// as-is; burn rate and remaining budget are derived at read time by consumers
/// (mirroring `engine/slo_math.rs`) so no derived value is ever frozen into
/// storage.
#[derive(Debug, Clone, PartialEq)]
pub struct SloSample {
    pub tenant: String,
    /// The SLO's uuid, as a string (the `slo.id` datapoint attribute).
    pub slo_id: String,
    /// The SLO's first-class name (the `slo.name` datapoint attribute).
    pub slo_name: String,
    /// The window this measurement is over, as the engine's stable key
    /// (`WindowReq.name`, e.g. "3600s"): the `slo.window` datapoint attribute.
    pub window: String,
    /// The group's label columns (empty for a scalar SLO), emitted as
    /// `slo.group.<column>` datapoint attributes.
    pub labels: BTreeMap<String, String>,
    pub good: f64,
    pub valid: f64,
    /// Evaluation time, unix nanoseconds (the datapoint `TimeUnixNano`).
    pub time_unix_nanos: u64,
}

/// Sink for SLO evaluation samples. Implemented by `otel` (which ships them as
/// OTLP gauges to the trusted collector path -> `app.metrics_gauge`); the no-op
/// `NullSink` keeps tests and no-export deploys simple. `record` only buffers,
/// so it is cheap to call inside the evaluation loop; the batch is exported once
/// per consume batch via `flush`, which is best-effort (errors logged, never
/// propagated, so a telemetry hiccup can never fail an evaluation).
#[async_trait]
pub trait SloSampleSink: Send + Sync {
    fn record(&self, samples: Vec<SloSample>);
    async fn flush(&self);
}

#[async_trait]
impl SloSampleSink for NullSink {
    fn record(&self, _samples: Vec<SloSample>) {}
    async fn flush(&self) {}
}
