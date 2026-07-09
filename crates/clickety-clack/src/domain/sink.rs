//! Dispatcher-side alert-log sink abstraction.
//!
//! Placed in `cc-domain` (which has no crate deps) so that `cc-otel` can implement the
//! sink and the dispatcher can consume it as a trait object, without a
//! `cc-otel` <-> `cc-dispatcher` dependency cycle.

use crate::domain::Event;
use async_trait::async_trait;

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
