use crate::queue::{Delivery, EvalJob, JobId, Queue, QueueError, SloDelivery, SloEvalJob};
use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::streams::{
    StreamAutoClaimOptions, StreamAutoClaimReply, StreamReadOptions, StreamReadReply,
};
use redis::AsyncCommands;

const STREAM: &str = "cc:eval:jobs";
const GROUP: &str = "evaluators";
const SLO_STREAM: &str = "cc:slo:jobs";
const SLO_GROUP: &str = "slo-evaluators";

/// Crash-recovery reclaim cadence: how long a job must sit idle in another
/// consumer's pending-entries-list before `consume`/`consume_slo` will steal it
/// back via `XAUTOCLAIM`. This is recovery for a consumer that died mid-job, not
/// a fast-retry knob, so it's set well above normal processing time.
const PEL_RECLAIM_IDLE_MS: usize = 60_000;

pub struct RedisQueue {
    conn: ConnectionManager,
    /// Engine self-observability (`cc.queue.consume.lag`, `cc.queue.batch.size`,
    /// `cc.queue.slo.consume.lag`, `cc.queue.slo.batch.size`).
    /// Disabled by default; attached by `main` when engine telemetry is configured.
    metrics: crate::otel::EngineMetrics,
    /// Minimum PEL idle time (ms) before a pending entry is reclaimed. Defaults
    /// to `PEL_RECLAIM_IDLE_MS`; overridable via `with_reclaim_idle_ms`.
    reclaim_idle_ms: usize,
}

/// True if `err` is Redis rejecting a command it doesn't recognize (the
/// `ERR unknown command '...'` reply), as opposed to some other server-side
/// failure. Used to detect a pre-6.2 server that has no `XAUTOCLAIM`.
fn is_unknown_command(err: &redis::RedisError) -> bool {
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
        })
    }

    /// Attach the engine-metrics handle so consume lag and batch size are measured.
    pub fn with_engine_metrics(mut self, metrics: crate::otel::EngineMetrics) -> Self {
        self.metrics = metrics;
        self
    }

    /// Test seam: shrink the PEL reclaim idle threshold so container tests don't
    /// have to wait out the full crash-recovery cadence. Production callers should
    /// leave this at the `PEL_RECLAIM_IDLE_MS` default set by `connect`.
    pub fn with_reclaim_idle_ms(mut self, ms: usize) -> Self {
        self.reclaim_idle_ms = ms;
        self
    }

    /// Steal entries idle for at least `min_idle_ms` in `group`'s pending-entries-list
    /// and hand them to `consumer`, via a combined XPENDING+XCLAIM (`XAUTOCLAIM`) pass
    /// starting from the beginning of the PEL. Returns each claimed entry's id and its
    /// raw `"job"` field (still JSON, undeserialized — callers know the target type).
    ///
    /// `XAUTOCLAIM` needs Redis >= 6.2. Against an older server this degrades to a
    /// no-op (logged once per call) instead of failing `consume`/`consume_slo`
    /// outright, so the reclaim pre-pass stays additive rather than a hard
    /// requirement on the Redis version in use.
    ///
    /// Entries with no parseable `"job"` field can never be salvaged, so they're acked
    /// here and dropped rather than reclaimed forever (a poison-pill guard, same
    /// philosophy as the batch-panic guard in the evaluator loop).
    async fn reclaim_pending(
        &self,
        stream: &str,
        group: &str,
        consumer: &str,
        min_idle_ms: usize,
        count: usize,
    ) -> Result<Vec<(String, String)>, QueueError> {
        let mut conn = self.conn.clone();
        let opts = StreamAutoClaimOptions::default().count(count);
        let reply: StreamAutoClaimReply = match conn
            .xautoclaim_options(stream, group, consumer, min_idle_ms, "0-0", opts)
            .await
        {
            Ok(reply) => reply,
            Err(e) if is_unknown_command(&e) => {
                tracing::warn!(
                    stream,
                    group,
                    error = %e,
                    "XAUTOCLAIM unsupported by this Redis server (needs >= 6.2); \
                     skipping the stale-PEL reclaim pass"
                );
                return Ok(Vec::new());
            }
            Err(e) => return Err(e.into()),
        };
        let mut out = Vec::with_capacity(reply.claimed.len());
        for entry in reply.claimed {
            let job_json = match entry.map.get("job") {
                Some(redis::Value::BulkString(bytes)) => String::from_utf8(bytes.clone()).ok(),
                _ => None,
            };
            match job_json {
                Some(json) => out.push((entry.id, json)),
                None => {
                    tracing::warn!(
                        stream,
                        group,
                        id = %entry.id,
                        "reclaimed entry missing a valid \"job\" field; acking as poison pill"
                    );
                    let _: Result<i64, redis::RedisError> =
                        conn.xack(stream, group, &[entry.id.as_str()]).await;
                }
            }
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
        let mut conn = self.conn.clone();
        // Reclaim pre-pass: hand this consumer any jobs left stuck in another
        // (presumably crashed) consumer's PEL before reading new work.
        let reclaimed = self
            .reclaim_pending(STREAM, GROUP, consumer, self.reclaim_idle_ms, count)
            .await?;

        let opts = StreamReadOptions::default()
            .group(GROUP, consumer)
            .count(count)
            .block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[STREAM], &[">"], &opts).await?;
        let now_ms = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
        let mut out = Vec::with_capacity(reclaimed.len());

        for (id, job_json) in reclaimed {
            match serde_json::from_str::<EvalJob>(&job_json) {
                Ok(job) => {
                    if let Some(enq_ms) = entry_enqueue_unix_ms(&id) {
                        self.metrics
                            .record_queue_lag((now_ms - enq_ms).max(0) as f64 / 1000.0);
                    }
                    out.push(Delivery { id: JobId(id), job });
                }
                Err(e) => {
                    // Poison pill: this payload will never deserialize, so ack it
                    // instead of leaving it to be reclaimed (and fail) forever.
                    tracing::warn!(
                        id = %id,
                        error = %e,
                        "reclaimed rule job payload failed to deserialize; acking as poison pill"
                    );
                    let _: Result<i64, redis::RedisError> =
                        conn.xack(STREAM, GROUP, &[id.as_str()]).await;
                }
            }
        }

        for key in reply.keys {
            for entry in key.ids {
                if let Some(redis::Value::BulkString(bytes)) = entry.map.get("job") {
                    let job: EvalJob = serde_json::from_slice(bytes)?;
                    // Stream ids are `<enqueue-unix-ms>-<seq>`, so enqueue-to-consume
                    // lag falls out of the id itself. Clamp at 0 against clock skew.
                    if let Some(enq_ms) = entry_enqueue_unix_ms(&entry.id) {
                        self.metrics
                            .record_queue_lag((now_ms - enq_ms).max(0) as f64 / 1000.0);
                    }
                    out.push(Delivery {
                        id: JobId(entry.id),
                        job,
                    });
                }
            }
        }
        // Empty replies (the XREAD block timeout on an idle queue) are not batches;
        // recording them would drown the size distribution in zeros.
        if !out.is_empty() {
            self.metrics.record_queue_batch_size(out.len());
        }
        Ok(out)
    }

    async fn ack(&self, id: &JobId) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(STREAM, GROUP, &[id.as_str()]).await?;
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
        let mut conn = self.conn.clone();
        // Reclaim pre-pass, mirroring `consume` above for the SLO stream/group.
        let reclaimed = self
            .reclaim_pending(SLO_STREAM, SLO_GROUP, consumer, self.reclaim_idle_ms, count)
            .await?;

        let opts = StreamReadOptions::default()
            .group(SLO_GROUP, consumer)
            .count(count)
            .block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[SLO_STREAM], &[">"], &opts).await?;
        let now_ms = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
        let mut out = Vec::with_capacity(reclaimed.len());

        for (id, job_json) in reclaimed {
            match serde_json::from_str::<SloEvalJob>(&job_json) {
                Ok(job) => {
                    if let Some(enq_ms) = entry_enqueue_unix_ms(&id) {
                        self.metrics
                            .record_queue_slo_lag((now_ms - enq_ms).max(0) as f64 / 1000.0);
                    }
                    out.push(SloDelivery { id: JobId(id), job });
                }
                Err(e) => {
                    tracing::warn!(
                        id = %id,
                        error = %e,
                        "reclaimed SLO job payload failed to deserialize; acking as poison pill"
                    );
                    let _: Result<i64, redis::RedisError> =
                        conn.xack(SLO_STREAM, SLO_GROUP, &[id.as_str()]).await;
                }
            }
        }

        for key in reply.keys {
            for entry in key.ids {
                if let Some(redis::Value::BulkString(bytes)) = entry.map.get("job") {
                    let job: SloEvalJob = serde_json::from_slice(bytes)?;
                    // Stream ids are `<enqueue-unix-ms>-<seq>`, so enqueue-to-consume
                    // lag falls out of the id itself. Clamp at 0 against clock skew.
                    if let Some(enq_ms) = entry_enqueue_unix_ms(&entry.id) {
                        self.metrics
                            .record_queue_slo_lag((now_ms - enq_ms).max(0) as f64 / 1000.0);
                    }
                    out.push(SloDelivery {
                        id: JobId(entry.id),
                        job,
                    });
                }
            }
        }
        // Empty replies (the XREAD block timeout on an idle queue) are not batches;
        // recording them would drown the size distribution in zeros.
        if !out.is_empty() {
            self.metrics.record_queue_slo_batch_size(out.len());
        }
        Ok(out)
    }

    async fn ack_slo(&self, id: &JobId) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(SLO_STREAM, SLO_GROUP, &[id.as_str()]).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::entry_enqueue_unix_ms;

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
