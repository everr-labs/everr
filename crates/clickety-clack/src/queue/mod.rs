pub mod event_bus;
pub mod groups;
pub mod redis_streams;

use crate::domain::ids::{RuleId, SloId, TenantId};
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

/// Opaque transport id for a consumed evaluation job.
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

/// Opaque transport id for a consumed stream event. Same sealing rationale as
/// [`JobId`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EventId(pub(crate) String);

impl EventId {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
    /// Construct an id for out-of-crate test fakes.
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

/// One SLO evaluation job on the independent `cc:slo:jobs` queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SloEvalJob {
    pub tenant: TenantId,
    pub slo: SloId,
    #[serde(with = "time::serde::rfc3339")]
    pub eval_ts: OffsetDateTime,
}

/// Opaque handle used to ack a consumed SLO job.
#[derive(Debug, Clone)]
pub struct SloDelivery {
    pub id: JobId,
    pub job: SloEvalJob,
}

/// Swappable transport for evaluation jobs. Redis Streams now, Kafka later.
///
/// # Backend contract
/// Any implementation MUST provide: at-least-once delivery (a job survives until acked);
/// `ack(id)` permanently removes that delivery from the never-delivered set; and
/// `consume` returns each job to exactly one consumer in the group until acked. Unacked
/// jobs remain claimable for redelivery via a backend reclaim mechanism (Redis:
/// `RedisQueue::consume`/`consume_slo` run a throttled `XAUTOCLAIM` pre-pass over
/// the consumer-group PEL ahead of reads). See `tests/conformance.rs`.
///
/// The `_slo` methods provide the same contract on a separate stream for SLO
/// evaluation jobs, kept independent of the rule-evaluation stream above.
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
    /// Ack a whole batch. The default loops [`Queue::ack`] (so implementors stay
    /// compatible); backends may override with a single variadic ack. On error,
    /// unacked ids stay pending and are redelivered via the reclaim mechanism, so
    /// stopping at the first failure is safe.
    async fn ack_batch(&self, ids: &[JobId]) -> Result<(), QueueError> {
        for id in ids {
            self.ack(id).await?;
        }
        Ok(())
    }

    async fn enqueue_slo(&self, job: &SloEvalJob) -> Result<(), QueueError>;
    /// Read up to `count` SLO jobs for this consumer (blocking up to `block_ms`).
    async fn consume_slo(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<SloDelivery>, QueueError>;
    async fn ack_slo(&self, id: &JobId) -> Result<(), QueueError>;
    /// Batch counterpart of [`Queue::ack_slo`]; same contract as [`Queue::ack_batch`].
    async fn ack_slo_batch(&self, ids: &[JobId]) -> Result<(), QueueError> {
        for id in ids {
            self.ack_slo(id).await?;
        }
        Ok(())
    }
}

/// One event read from the event stream.
#[derive(Debug, Clone, PartialEq)]
pub struct EventEntry {
    pub id: EventId,
    pub event: Event,
}

/// Transport for firing/resolved events: evaluator publishes, dispatcher consumes
/// (shared group). Redis Streams now, Kafka later.
///
/// # Backend contract
/// `consume` is an at-least-once shared-group read acked by `ack(id)`. Unacked
/// entries remain claimable for redelivery via a backend reclaim mechanism
/// (Redis: `RedisEventBus::consume`/`consume_logexport` run a throttled
/// `XAUTOCLAIM` pre-pass over their group's PEL ahead of reads, same as
/// `RedisQueue`).
/// `dead_letter` records a permanently-undeliverable event out-of-band. See
/// `tests/conformance.rs`.
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
    /// Ack a whole batch of dispatcher-group deliveries. The default loops
    /// [`EventBus::ack`] (so implementors stay compatible); backends may override
    /// with a single variadic ack. On error, unacked ids stay pending and are
    /// redelivered via the reclaim mechanism, so stopping at the first failure is safe.
    async fn ack_batch(&self, ids: &[EventId]) -> Result<(), QueueError> {
        for id in ids {
            self.ack(id).await?;
        }
        Ok(())
    }
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
    /// Record a permanently-undeliverable event on the dead-letter stream.
    async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError>;
}
