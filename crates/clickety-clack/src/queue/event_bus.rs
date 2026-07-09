use crate::domain::Event;
use crate::queue::{EventBus, EventEntry, EventId, QueueError};
use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::streams::{StreamMaxlen, StreamReadOptions, StreamReadReply};
use redis::AsyncCommands;

const STREAM: &str = "cc:events";
const GROUP: &str = "dispatchers";
const GROUP_LOGEXPORT: &str = "cc:logexport";
const DEADLETTER: &str = "cc:events:deadletter";

pub struct RedisEventBus {
    conn: ConnectionManager,
}

impl RedisEventBus {
    /// Connect and ensure both consumer groups exist (idempotent): the dispatcher group
    /// and the independent `cc:logexport` group consumed by the `events` role. Competing
    /// consumer groups each receive every event, so log-export never steals deliveries.
    pub async fn connect(url: &str) -> Result<Self, QueueError> {
        let client = redis::Client::open(url)?;
        let mut conn = ConnectionManager::new(client).await?;
        for group in [GROUP, GROUP_LOGEXPORT] {
            let _: Result<(), redis::RedisError> = redis::cmd("XGROUP")
                .arg("CREATE")
                .arg(STREAM)
                .arg(group)
                .arg("$")
                .arg("MKSTREAM")
                .query_async(&mut conn)
                .await;
        }
        Ok(Self { conn })
    }

    fn parse_entries(reply: StreamReadReply) -> Result<Vec<EventEntry>, QueueError> {
        let mut out = Vec::new();
        for key in reply.keys {
            for entry in key.ids {
                if let Some(redis::Value::BulkString(bytes)) = entry.map.get("event") {
                    let event: Event = serde_json::from_slice(bytes)?;
                    out.push(EventEntry {
                        id: EventId(entry.id),
                        event,
                    });
                }
            }
        }
        Ok(out)
    }
}

#[async_trait]
impl EventBus for RedisEventBus {
    async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
        let payload = serde_json::to_string(ev)?;
        let mut conn = self.conn.clone();
        let _: String = conn
            .xadd_maxlen(
                STREAM,
                StreamMaxlen::Approx(1_000_000),
                "*",
                &[("event", payload)],
            )
            .await?;
        Ok(())
    }

    async fn consume(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        let mut conn = self.conn.clone();
        let opts = StreamReadOptions::default()
            .group(GROUP, consumer)
            .count(count)
            .block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[STREAM], &[">"], &opts).await?;
        Self::parse_entries(reply)
    }

    async fn ack(&self, id: &EventId) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(STREAM, GROUP, &[id.as_str()]).await?;
        Ok(())
    }

    async fn consume_logexport(
        &self,
        consumer: &str,
        count: usize,
        block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        let mut conn = self.conn.clone();
        let opts = StreamReadOptions::default()
            .group(GROUP_LOGEXPORT, consumer)
            .count(count)
            .block(block_ms);
        let reply: StreamReadReply = conn.xread_options(&[STREAM], &[">"], &opts).await?;
        Self::parse_entries(reply)
    }

    async fn ack_logexport(&self, id: &EventId) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.xack(STREAM, GROUP_LOGEXPORT, &[id.as_str()]).await?;
        Ok(())
    }

    async fn publish_batch(&self, evs: &[Event]) -> Result<Vec<usize>, QueueError> {
        if evs.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.conn.clone();
        let mut pipe = redis::pipe();
        for ev in evs {
            let payload = serde_json::to_string(ev)?;
            pipe.xadd_maxlen(
                STREAM,
                StreamMaxlen::Approx(1_000_000),
                "*",
                &[("event", payload)],
            );
        }
        match pipe.query_async::<Vec<String>>(&mut conn).await {
            Ok(_) => Ok((0..evs.len()).collect()),
            Err(e) => {
                tracing::warn!(error = %e, "publish_batch pipeline failed; falling back to per-event publish");
                // Pipeline failed wholesale: fall back to per-event publish for exact
                // partial-success accounting (so we only delete outbox rows that landed).
                let mut ok = Vec::with_capacity(evs.len());
                for (i, ev) in evs.iter().enumerate() {
                    if self.publish(ev).await.is_ok() {
                        ok.push(i);
                    }
                }
                Ok(ok)
            }
        }
    }

    async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError> {
        let payload = serde_json::to_string(ev)?;
        let mut conn = self.conn.clone();
        let reason_owned = reason.to_string();
        let _: String = conn
            .xadd_maxlen(
                DEADLETTER,
                StreamMaxlen::Approx(100_000),
                "*",
                &[("event", payload), ("reason", reason_owned)],
            )
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod publish_batch_tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use crate::domain::{Event, EventStatus};
    use std::collections::BTreeMap;
    use std::sync::Mutex;
    use time::OffsetDateTime;
    use uuid::Uuid;

    struct CountingBus {
        published: Mutex<Vec<String>>,
        fail_on: Option<String>,
    }

    impl CountingBus {
        fn new(fail_on: Option<&str>) -> Self {
            Self {
                published: Mutex::new(Vec::new()),
                fail_on: fail_on.map(str::to_string),
            }
        }
    }

    #[async_trait]
    impl EventBus for CountingBus {
        async fn publish(&self, ev: &Event) -> Result<(), QueueError> {
            if self.fail_on.as_deref() == Some(ev.instance_key.0.as_str()) {
                // Produce a QueueError::Json without adding a new variant.
                let e: serde_json::Error = serde_json::from_str::<i32>("x").unwrap_err();
                return Err(QueueError::Json(e));
            }
            self.published
                .lock()
                .unwrap()
                .push(ev.instance_key.0.clone());
            Ok(())
        }

        async fn consume(
            &self,
            _consumer: &str,
            _count: usize,
            _block_ms: usize,
        ) -> Result<Vec<EventEntry>, QueueError> {
            Ok(Vec::new())
        }

        async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
            Ok(())
        }

        async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
            Ok(())
        }
    }

    fn ev(key: &str) -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey(key.to_string()),
            EventStatus::Firing,
            BTreeMap::new(),
            None,
            Severity::Critical,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    #[tokio::test]
    async fn default_batch_reports_only_succeeded_indices() {
        // "b" will fail; "a" and "c" should succeed => indices [0, 2]
        let bus = CountingBus::new(Some("b"));
        let evs = vec![ev("a"), ev("b"), ev("c")];
        let result = bus.publish_batch(&evs).await.unwrap();
        assert_eq!(result, vec![0, 2]);

        let published = bus.published.lock().unwrap();
        assert_eq!(*published, vec!["a", "c"]);
    }

    #[tokio::test]
    async fn default_batch_all_succeed() {
        let bus = CountingBus::new(None);
        let evs = vec![ev("x"), ev("y")];
        let result = bus.publish_batch(&evs).await.unwrap();
        assert_eq!(result, vec![0, 1]);
    }

    #[tokio::test]
    async fn default_batch_empty_input() {
        let bus = CountingBus::new(None);
        let result = bus.publish_batch(&[]).await.unwrap();
        assert_eq!(result, Vec::<usize>::new());
    }
}
