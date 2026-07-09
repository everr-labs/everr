pub mod event_bus;
pub mod groups;
pub mod redis_streams;

use crate::domain::ids::{RuleId, TenantId};
use crate::domain::Event;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use time::OffsetDateTime;

#[derive(Debug, Error)]
pub enum QueueError {
    #[error("redis: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

/// Opaque transport id for a consumed eval job. The backend's id/offset format is sealed
/// inside this crate; callers only move it around and ack with it (Redis stream id today,
/// Kafka partition/offset later).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct JobId(pub(crate) String);

impl JobId {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for JobId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Opaque transport id for a consumed/tailed stream event. Same sealing rationale as
/// [`JobId`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EventId(pub(crate) String);

impl EventId {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
    /// Construct an `EventId` from a raw backend id. Hidden from the public surface; it
    /// exists so out-of-crate tests (e.g. `cc-events`' fake bus) can fabricate entries
    /// without a live Redis stream. Production code never needs it — ids come from the
    /// backend via `consume`/`tail`.
    #[doc(hidden)]
    pub fn from_raw(id: impl Into<String>) -> Self {
        EventId(id.into())
    }
}

impl std::fmt::Display for EventId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Where a fan-out tail starts. Backend-agnostic: `Live` = the current tail (Redis `"$"`,
/// Kafka latest offset); `After(id)` resumes strictly after a previously-seen position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TailCursor {
    Live,
    After(EventId),
}

/// One evaluation job: evaluate `rule` as-of `eval_ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvalJob {
    pub tenant: TenantId,
    pub rule: RuleId,
    #[serde(with = "time::serde::rfc3339")]
    pub eval_ts: OffsetDateTime,
}

/// Opaque handle used to ack a consumed message.
#[derive(Debug, Clone)]
pub struct Delivery {
    pub id: JobId,
    pub job: EvalJob,
}

/// Swappable transport for evaluation jobs. Redis Streams now, Kafka later.
///
/// # Backend contract
/// Any implementation MUST provide: at-least-once delivery (a job survives until acked);
/// `ack(id)` permanently removes that delivery from the never-delivered set; and
/// `consume` returns each job to exactly one consumer in the group until acked. Unacked
/// jobs remain claimable for redelivery via a backend reclaim mechanism (Redis: the
/// consumer-group PEL; reclaim wiring is future work). See `tests/conformance.rs`.
#[async_trait]
pub trait Queue: Send + Sync {
    async fn enqueue(&self, job: &EvalJob) -> Result<(), QueueError>;
    /// Read up to `count` jobs for this consumer (blocking up to `block_ms`).
    async fn consume(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<Delivery>, QueueError>;
    async fn ack(&self, id: &JobId) -> Result<(), QueueError>;
}

/// One event read from the event stream (consume-group or tail).
#[derive(Debug, Clone, PartialEq)]
pub struct EventEntry {
    pub id: EventId,
    pub event: Event,
}

/// Transport for firing/resolved events: evaluator publishes, dispatcher consumes
/// (shared group), api tails (fan-out) for SSE. Redis Streams now, Kafka later.
///
/// # Backend contract
/// `consume` is an at-least-once shared-group read acked by `ack(id)`. `tail` is a
/// group-less fan-out: every caller sees every event, `Live` starts at the current tail
/// and `After(id)` resumes strictly after a prior position. `dead_letter` records a
/// permanently-undeliverable event out-of-band. See `tests/conformance.rs`.
#[async_trait]
pub trait EventBus: Send + Sync {
    /// Publish one event to the stream.
    async fn publish(&self, ev: &Event) -> Result<(), QueueError>;
    /// Publish many events. Returns the indices (into `evs`) that were published
    /// successfully, so the caller can delete exactly those outbox rows. The default loops
    /// `publish`; backends may override with a pipelined fast path.
    async fn publish_batch(&self, evs: &[Event]) -> Result<Vec<usize>, QueueError> {
        let mut ok = Vec::with_capacity(evs.len());
        for (i, ev) in evs.iter().enumerate() {
            if self.publish(ev).await.is_ok() {
                ok.push(i);
            }
        }
        Ok(ok)
    }
    /// Consume via the shared "dispatchers" group (at-least-once). Ack with `ack`.
    async fn consume(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError>;
    async fn ack(&self, id: &EventId) -> Result<(), QueueError>;
    /// Consume via the SECOND shared group (`cc:logexport`), independent of the dispatcher
    /// group, so the log-export consumer never competes with delivery. At-least-once;
    /// ack with `ack_logexport`. Default returns empty (test fakes don't need it).
    async fn consume_logexport(
        &self,
        _consumer: &str,
        _count: usize,
        _block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        Ok(Vec::new())
    }
    async fn ack_logexport(&self, _id: &EventId) -> Result<(), QueueError> {
        Ok(())
    }
    /// Fan-out tail for SSE: read entries strictly after `cursor` (`TailCursor::Live`
    /// starts at the live tail). Returns entries in order; the caller advances its own
    /// cursor with `TailCursor::After(last_returned_id)`. No consumer group — every caller
    /// sees every event.
    async fn tail(
        &self,
        cursor: &TailCursor,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError>;
    /// Record a permanently-undeliverable event on the dead-letter stream.
    async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError>;
}
