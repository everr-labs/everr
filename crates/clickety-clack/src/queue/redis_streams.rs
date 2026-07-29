use crate::queue::{Delivery, EvalJob, JobId, Queue, QueueError, SloDelivery, SloEvalJob};
use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::streams::{
    StreamAutoClaimOptions, StreamAutoClaimReply, StreamReadOptions, StreamReadReply,
};
use redis::AsyncCommands;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const STREAM: &str = "cc:eval:jobs";
const GROUP: &str = "evaluators";
const SLO_STREAM: &str = "cc:slo:jobs";
const SLO_GROUP: &str = "slo-evaluators";

/// Idle time before reclaiming work from a crashed consumer.
pub(crate) const PEL_RECLAIM_IDLE_MS: usize = 60_000;

/// Throttle reclaim probes to half the idle threshold. Each stream gets a
/// separate probe so one consumer loop cannot starve another.
pub(crate) struct ReclaimProbe {
    last: Mutex<Option<Instant>>,
}

impl ReclaimProbe {
    pub(crate) fn new() -> Self {
        Self {
            last: Mutex::new(None),
        }
    }

    /// Return and consume whether a reclaim probe is due.
    pub(crate) fn due(&self, reclaim_idle_ms: usize) -> bool {
        let interval = Duration::from_millis((reclaim_idle_ms / 2) as u64);
        let mut last = self.last.lock().expect("reclaim probe lock poisoned");
        match *last {
            Some(at) if at.elapsed() < interval => false,
            _ => {
                *last = Some(Instant::now());
                true
            }
        }
    }
}

pub struct RedisQueue {
    conn: ConnectionManager,
    /// Optional queue lag and batch-size metrics.
    metrics: crate::otel::EngineMetrics,
    /// Minimum idle time before a pending entry is reclaimed.
    reclaim_idle_ms: usize,
    /// Disables reclaim after detecting Redis without XAUTOCLAIM.
    reclaim_unsupported: Arc<AtomicBool>,
    /// Per-stream probe throttles (see [`ReclaimProbe`]); the two job streams
    /// are consumed by independent loops sharing this handle.
    reclaim_probe: ReclaimProbe,
    slo_reclaim_probe: ReclaimProbe,
}

/// Whether Redis rejected an unsupported command.
pub(crate) fn is_unknown_command(err: &redis::RedisError) -> bool {
    err.kind() == redis::ErrorKind::ResponseError
        && err
            .detail()
            .is_some_and(|detail| detail.contains("unknown command"))
}

/// Enqueue time in unix milliseconds encoded in a Redis stream entry id
/// (`<ms>-<seq>`). `None` for ids that don't follow that shape.
fn entry_enqueue_unix_ms(entry_id: &str) -> Option<i64> {
    entry_id.split('-').next()?.parse().ok()
}

/// Redis coordinates and payload field for one reclaim pass.
pub(crate) struct ReclaimTarget<'a> {
    pub stream: &'a str,
    pub group: &'a str,
    pub field: &'a str,
}

/// Reclaim idle entries and return their raw payloads.
///
/// Redis versions without XAUTOCLAIM disable reclaim without breaking consume.
///
/// Entries without a payload are acked so they cannot become poison pills.
pub(crate) async fn reclaim_pending_raw(
    conn: &mut ConnectionManager,
    unsupported: &AtomicBool,
    target: &ReclaimTarget<'_>,
    consumer: &str,
    min_idle_ms: usize,
    count: usize,
) -> Result<Vec<(String, Vec<u8>)>, QueueError> {
    if unsupported.load(Ordering::Relaxed) {
        return Ok(Vec::new());
    }

    let ReclaimTarget {
        stream,
        group,
        field,
    } = *target;
    let opts = StreamAutoClaimOptions::default().count(count);
    let reply: StreamAutoClaimReply = match conn
        .xautoclaim_options(stream, group, consumer, min_idle_ms, "0-0", opts)
        .await
    {
        Ok(reply) => reply,
        Err(e) if is_unknown_command(&e) => {
            unsupported.store(true, Ordering::Relaxed);
            tracing::warn!(
                stream,
                group,
                error = %e,
                "XAUTOCLAIM unsupported by this Redis server (needs >= 6.2); \
                 reclaim disabled until restart"
            );
            return Ok(Vec::new());
        }
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::with_capacity(reply.claimed.len());
    for entry in reply.claimed {
        match entry.map.get(field) {
            Some(redis::Value::BulkString(bytes)) => out.push((entry.id, bytes.clone())),
            _ => {
                tracing::warn!(
                    stream,
                    group,
                    id = %entry.id,
                    field,
                    "reclaimed entry missing its payload field; acking as poison pill"
                );
                let _: Result<i64, redis::RedisError> =
                    conn.xack(stream, group, &[entry.id.as_str()]).await;
            }
        }
    }
    Ok(out)
}

impl RedisQueue {
    /// Connect and ensure the consumer group exists (idempotent).
    pub async fn connect(url: &str) -> Result<Self, QueueError> {
        let client = redis::Client::open(url)?;
        let mut conn = ConnectionManager::new(client).await?;
        // MKSTREAM creates the stream; ignore BUSYGROUP if it already exists.
        let _: Result<(), redis::RedisError> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(STREAM)
            .arg(GROUP)
            .arg("$")
            .arg("MKSTREAM")
            .query_async(&mut conn)
            .await;
        // Same idempotent group-creation dance for the SLO stream (separate from the
        // rule stream above).
        let _: Result<(), redis::RedisError> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(SLO_STREAM)
            .arg(SLO_GROUP)
            .arg("$")
            .arg("MKSTREAM")
            .query_async(&mut conn)
            .await;
        Ok(Self {
            conn,
            metrics: crate::otel::EngineMetrics::disabled(),
            reclaim_idle_ms: PEL_RECLAIM_IDLE_MS,
            reclaim_unsupported: Arc::new(AtomicBool::new(false)),
            reclaim_probe: ReclaimProbe::new(),
            slo_reclaim_probe: ReclaimProbe::new(),
        })
    }

    /// Attach the engine-metrics handle so consume lag and batch size are measured.
    pub fn with_engine_metrics(mut self, metrics: crate::otel::EngineMetrics) -> Self {
        self.metrics = metrics;
        self
    }

    /// Override the reclaim threshold for integration tests.
    pub fn with_reclaim_idle_ms(mut self, ms: usize) -> Self {
        self.reclaim_idle_ms = ms;
        self
    }

    /// Shared reclaim, read, poison handling, and metrics path for both streams.
    #[allow(clippy::too_many_arguments)]
    async fn consume_stream<J: serde::de::DeserializeOwned>(
        &self,
        stream: &str,
        group: &str,
        probe: &ReclaimProbe,
        consumer: &str,
        count: usize,
        block_ms: usize,
        record_lag: impl Fn(f64),
        record_batch_size: impl Fn(usize),
    ) -> Result<Vec<(JobId, J)>, QueueError> {
        let mut conn = self.conn.clone();
        // Reclaim abandoned jobs before reading new work.
        let reclaimed = if probe.due(self.reclaim_idle_ms) {
            reclaim_pending_raw(
                &mut conn,
                &self.reclaim_unsupported,
                &ReclaimTarget {
                    stream,
                    group,
                    field: "job",
                },
                consumer,
                self.reclaim_idle_ms,
                count,
            )
            .await?
        } else {
            Vec::new()
        };

        let opts = StreamReadOptions::default()
            .group(group, consumer)
            .count(count)
            .block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[stream], &[">"], &opts).await?;
        let now_ms = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
        let mut out = Vec::with_capacity(reclaimed.len());

        for (id, payload) in reclaimed {
            match serde_json::from_slice::<J>(&payload) {
                Ok(job) => {
                    if let Some(enq_ms) = entry_enqueue_unix_ms(&id) {
                        record_lag((now_ms - enq_ms).max(0) as f64 / 1000.0);
                    }
                    out.push((JobId(id), job));
                }
                Err(e) => {
                    // Ack malformed payloads so they cannot be reclaimed forever.
                    tracing::warn!(
                        stream,
                        id = %id,
                        error = %e,
                        "reclaimed job payload failed to deserialize; acking as poison pill"
                    );
                    let _: Result<i64, redis::RedisError> =
                        conn.xack(stream, group, &[id.as_str()]).await;
                }
            }
        }

        for key in reply.keys {
            for entry in key.ids {
                if let Some(redis::Value::BulkString(bytes)) = entry.map.get("job") {
                    let job: J = serde_json::from_slice(bytes)?;
                    // Stream ids carry enqueue time. Clamp lag against clock skew.
                    if let Some(enq_ms) = entry_enqueue_unix_ms(&entry.id) {
                        record_lag((now_ms - enq_ms).max(0) as f64 / 1000.0);
                    }
                    out.push((JobId(entry.id), job));
                }
            }
        }
        // Do not record idle read timeouts as empty batches.
        if !out.is_empty() {
            record_batch_size(out.len());
        }
        Ok(out)
    }
}

#[async_trait]
impl Queue for RedisQueue {
    async fn enqueue(&self, job: &EvalJob) -> Result<(), QueueError> {
        let payload = serde_json::to_string(job)?;
        let mut conn = self.conn.clone();
        let _: String = conn.xadd(STREAM, "*", &[("job", payload)]).await?;
        Ok(())
    }

    async fn consume(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<Delivery>, QueueError> {
        let jobs = self
            .consume_stream::<EvalJob>(
                STREAM,
                GROUP,
                &self.reclaim_probe,
                consumer,
                count,
                block_ms,
                |lag| self.metrics.record_queue_lag(lag),
                |n| self.metrics.record_queue_batch_size(n),
            )
            .await?;
        Ok(jobs
            .into_iter()
            .map(|(id, job)| Delivery { id, job })
            .collect())
    }

    async fn ack(&self, id: &JobId) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(STREAM, GROUP, &[id.as_str()]).await?;
        Ok(())
    }

    async fn ack_batch(&self, ids: &[JobId]) -> Result<(), QueueError> {
        if ids.is_empty() {
            return Ok(());
        }
        let raw: Vec<&str> = ids.iter().map(JobId::as_str).collect();
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(STREAM, GROUP, &raw).await?;
        Ok(())
    }

    async fn enqueue_slo(&self, job: &SloEvalJob) -> Result<(), QueueError> {
        let payload = serde_json::to_string(job)?;
        let mut conn = self.conn.clone();
        let _: String = conn.xadd(SLO_STREAM, "*", &[("job", payload)]).await?;
        Ok(())
    }

    async fn consume_slo(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<SloDelivery>, QueueError> {
        let jobs = self
            .consume_stream::<SloEvalJob>(
                SLO_STREAM,
                SLO_GROUP,
                &self.slo_reclaim_probe,
                consumer,
                count,
                block_ms,
                |lag| self.metrics.record_queue_slo_lag(lag),
                |n| self.metrics.record_queue_slo_batch_size(n),
            )
            .await?;
        Ok(jobs
            .into_iter()
            .map(|(id, job)| SloDelivery { id, job })
            .collect())
    }

    async fn ack_slo(&self, id: &JobId) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(SLO_STREAM, SLO_GROUP, &[id.as_str()]).await?;
        Ok(())
    }

    async fn ack_slo_batch(&self, ids: &[JobId]) -> Result<(), QueueError> {
        if ids.is_empty() {
            return Ok(());
        }
        let raw: Vec<&str> = ids.iter().map(JobId::as_str).collect();
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(SLO_STREAM, SLO_GROUP, &raw).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{entry_enqueue_unix_ms, ReclaimProbe, PEL_RECLAIM_IDLE_MS};

    #[test]
    fn probe_is_throttled_to_half_the_idle_threshold() {
        let probe = ReclaimProbe::new();
        assert!(probe.due(PEL_RECLAIM_IDLE_MS));
        assert!(
            !probe.due(PEL_RECLAIM_IDLE_MS),
            "a second probe within reclaim_idle_ms / 2 must be skipped"
        );
    }

    #[test]
    fn tiny_idle_threshold_disables_the_throttle() {
        // A sub-2ms threshold rounds to no throttle.
        let probe = ReclaimProbe::new();
        assert!(probe.due(1));
        assert!(probe.due(1));
        assert!(probe.due(0));
    }

    #[test]
    fn entry_id_millisecond_prefix_parses() {
        assert_eq!(
            entry_enqueue_unix_ms("1719216000123-0"),
            Some(1719216000123)
        );
        assert_eq!(entry_enqueue_unix_ms("0-1"), Some(0));
    }

    #[test]
    fn malformed_entry_ids_yield_none() {
        assert_eq!(entry_enqueue_unix_ms(""), None);
        assert_eq!(entry_enqueue_unix_ms("abc-0"), None);
        assert_eq!(entry_enqueue_unix_ms("-5"), None);
    }
}
