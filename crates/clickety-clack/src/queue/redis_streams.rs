use crate::queue::{Delivery, EvalJob, JobId, Queue, QueueError, SloDelivery, SloEvalJob};
use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::AsyncCommands;

const STREAM: &str = "cc:eval:jobs";
const GROUP: &str = "evaluators";
const SLO_STREAM: &str = "cc:slo:jobs";
const SLO_GROUP: &str = "slo-evaluators";

pub struct RedisQueue {
    conn: ConnectionManager,
    /// Engine self-observability (`cc.queue.consume.lag`, `cc.queue.batch.size`).
    /// Disabled by default; attached by `main` when engine telemetry is configured.
    metrics: crate::otel::EngineMetrics,
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
        })
    }

    /// Attach the engine-metrics handle so consume lag and batch size are measured.
    pub fn with_engine_metrics(mut self, metrics: crate::otel::EngineMetrics) -> Self {
        self.metrics = metrics;
        self
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
        let opts = StreamReadOptions::default()
            .group(GROUP, consumer)
            .count(count)
            .block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[STREAM], &[">"], &opts).await?;
        let now_ms = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
        let mut out = Vec::new();
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
        let opts = StreamReadOptions::default()
            .group(SLO_GROUP, consumer)
            .count(count)
            .block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[SLO_STREAM], &[">"], &opts).await?;
        let mut out = Vec::new();
        for key in reply.keys {
            for entry in key.ids {
                if let Some(redis::Value::BulkString(bytes)) = entry.map.get("job") {
                    let job: SloEvalJob = serde_json::from_slice(bytes)?;
                    out.push(SloDelivery {
                        id: JobId(entry.id),
                        job,
                    });
                }
            }
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
