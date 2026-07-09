use crate::domain::Event;
use crate::queue::QueueError;
use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::Script;
use serde::{Deserialize, Serialize};

const FLUSH_ZSET: &str = "cc:groupflush";
/// Group hashes expire if untouched for this long (bounds storage for silent groups).
const GROUP_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

fn group_key(group_id: &str) -> String {
    format!("cc:group:{group_id}")
}

/// Stored once per group (first event wins via HSETNX). Carries the receiver's channel
/// NAMES and the human group key; no secret ever reaches Redis. The flusher resolves
/// the names to their stored configs at delivery time, so a channel edit (secret
/// rotation) between buffering and flush is picked up. Group identity stays keyed by
/// receiver name (see `grouping::group_id`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupMeta {
    pub tenant: String,
    pub channels: Vec<String>,
    pub group_key: String,
    /// Clean receiver name (no grouping-value suffix); used as the delivery-target label.
    pub receiver: String,
}

/// Snapshot of one claimed group at flush time. Every field beyond `meta`/`events` is
/// carried by hash fields that simply do not exist on groups written by an older binary,
/// so an old-format group reads as "no firing membership, no repeat, never notified"
/// (rolling-upgrade safe by construction).
#[derive(Debug, Clone)]
pub struct GroupBatch {
    pub meta: GroupMeta,
    /// The buffered batch (`ev:*` fields), cleared by this take.
    pub events: Vec<Event>,
    /// Still-firing membership (`fi:*` fields). Survives takes; an instance leaves when
    /// a resolved event for it is buffered. Feeds `repeat_interval` reminders.
    pub firing: Vec<Event>,
    /// Route repeat interval in ms (`__repeat_ms__`), refreshed on every buffered event.
    /// None = never re-notify.
    pub repeat_interval_ms: Option<i64>,
    /// When a notification for this group was last actually sent (`__last_notified__`).
    pub last_notified_ms: Option<i64>,
}

/// Redis-backed group buffer + flush-timer store. Membership lives in a hash
/// `cc:group:{id}` (field `ev:{instance}` → event JSON, `fi:{instance}` → still-firing
/// membership, plus `__meta__`/`__last_flush__`/`__last_notified__`/`__repeat_ms__`);
/// flush times live in a ZSET `cc:groupflush`. All mutations are atomic Lua so any
/// dispatcher replica can buffer and flush without sticky ownership.
#[async_trait]
pub trait GroupStore: Send + Sync {
    /// Buffer `ev` into `group_id` (overwriting any prior event for the same instance)
    /// and arm a flush. New group → due = now + group_wait. Previously-flushed group →
    /// due = max(now, last_flush + group_interval). An already-armed group is only
    /// pulled EARLIER, never pushed out (so a pending repeat reminder cannot delay a
    /// fresh batch beyond group_interval). `firing` maintains the still-firing
    /// membership; `repeat_interval_ms` (None = never) records the route's reminder
    /// cadence, latest write wins.
    #[allow(clippy::too_many_arguments)]
    async fn add_to_group(
        &self,
        group_id: &str,
        meta: &GroupMeta,
        fingerprint: &str,
        ev: &Event,
        now_ms: i64,
        group_wait_ms: i64,
        group_interval_ms: i64,
        firing: bool,
        repeat_interval_ms: Option<i64>,
    ) -> Result<(), QueueError>;

    /// Atomically claim (remove from the timer) up to `max` group ids whose flush is due
    /// (score <= now_ms). Each id is then owned by this caller for flushing.
    async fn claim_due(&self, now_ms: i64, max: usize) -> Result<Vec<String>, QueueError>;

    /// Snapshot a claimed group, atomically clearing the buffered event fields and
    /// stamping `__last_flush__ = now_ms` (so re-arrivals form a new batch). Firing
    /// membership and repeat/notify bookkeeping are returned but NOT cleared.
    /// Returns None if the group has no metadata (already taken / expired).
    async fn take_group(
        &self,
        group_id: &str,
        now_ms: i64,
    ) -> Result<Option<GroupBatch>, QueueError>;

    /// Record that a notification for this group was sent at `now_ms` (drives the
    /// `repeat_interval` elapsed check). No-op if the group hash no longer exists.
    async fn mark_notified(&self, group_id: &str, now_ms: i64) -> Result<(), QueueError>;

    /// Arm (or pull in) the group's flush timer so it fires no later than `due_ms`.
    /// Used to schedule the next still-firing reminder check after a flush. No-op if
    /// the group hash no longer exists.
    async fn arm_repeat(&self, group_id: &str, due_ms: i64) -> Result<(), QueueError>;
}

pub struct RedisGroups {
    conn: ConnectionManager,
}

impl RedisGroups {
    pub async fn connect(url: &str) -> Result<Self, QueueError> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }
}

const ADD_LUA: &str = r#"
redis.call('HSET', KEYS[1], 'ev:'..ARGV[2], ARGV[3])
if ARGV[9] == '1' then
  redis.call('HSET', KEYS[1], 'fi:'..ARGV[2], ARGV[3])
else
  redis.call('HDEL', KEYS[1], 'fi:'..ARGV[2])
end
if ARGV[10] ~= '' then
  redis.call('HSET', KEYS[1], '__repeat_ms__', ARGV[10])
else
  redis.call('HDEL', KEYS[1], '__repeat_ms__')
end
redis.call('HSETNX', KEYS[1], '__meta__', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[8])
local last = redis.call('HGET', KEYS[1], '__last_flush__')
local due
if last then
  due = tonumber(last) + tonumber(ARGV[7])
  local floor = tonumber(ARGV[5])
  if due < floor then due = floor end
else
  due = tonumber(ARGV[5]) + tonumber(ARGV[6])
end
local armed = redis.call('ZSCORE', KEYS[2], ARGV[1])
if (not armed) or (due < tonumber(armed)) then
  redis.call('ZADD', KEYS[2], due, ARGV[1])
end
return 1
"#;

const CLAIM_LUA: &str = r#"
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for i=1,#due do redis.call('ZREM', KEYS[1], due[i]) end
return due
"#;

const TAKE_LUA: &str = r#"
local all = redis.call('HGETALL', KEYS[1])
for i=1,#all,2 do
  if string.sub(all[i],1,3) == 'ev:' then
    redis.call('HDEL', KEYS[1], all[i])
  end
end
redis.call('HSET', KEYS[1], '__last_flush__', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return all
"#;

const MARK_NOTIFIED_LUA: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('HSET', KEYS[1], '__last_notified__', ARGV[1])
end
return 1
"#;

const ARM_REPEAT_LUA: &str = r#"
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local armed = redis.call('ZSCORE', KEYS[2], ARGV[1])
if (not armed) or (tonumber(ARGV[2]) < tonumber(armed)) then
  redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
end
return 1
"#;

#[async_trait]
impl GroupStore for RedisGroups {
    async fn add_to_group(
        &self,
        group_id: &str,
        meta: &GroupMeta,
        fingerprint: &str,
        ev: &Event,
        now_ms: i64,
        group_wait_ms: i64,
        group_interval_ms: i64,
        firing: bool,
        repeat_interval_ms: Option<i64>,
    ) -> Result<(), QueueError> {
        let ev_json = serde_json::to_string(ev)?;
        let meta_json = serde_json::to_string(meta)?;
        let repeat_arg = repeat_interval_ms
            .map(|v| v.to_string())
            .unwrap_or_default();
        let mut conn = self.conn.clone();
        let _: i64 = Script::new(ADD_LUA)
            .key(group_key(group_id))
            .key(FLUSH_ZSET)
            .arg(group_id)
            .arg(fingerprint)
            .arg(ev_json)
            .arg(meta_json)
            .arg(now_ms)
            .arg(group_wait_ms)
            .arg(group_interval_ms)
            .arg(GROUP_TTL_MS)
            .arg(if firing { "1" } else { "0" })
            .arg(repeat_arg)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    async fn claim_due(&self, now_ms: i64, max: usize) -> Result<Vec<String>, QueueError> {
        let mut conn = self.conn.clone();
        let ids: Vec<String> = Script::new(CLAIM_LUA)
            .key(FLUSH_ZSET)
            .arg(now_ms)
            .arg(max as i64)
            .invoke_async(&mut conn)
            .await?;
        Ok(ids)
    }

    async fn take_group(
        &self,
        group_id: &str,
        now_ms: i64,
    ) -> Result<Option<GroupBatch>, QueueError> {
        let mut conn = self.conn.clone();
        let flat: Vec<String> = Script::new(TAKE_LUA)
            .key(group_key(group_id))
            .arg(now_ms)
            .arg(GROUP_TTL_MS)
            .invoke_async(&mut conn)
            .await?;
        let mut meta: Option<GroupMeta> = None;
        let mut events: Vec<Event> = Vec::new();
        let mut firing: Vec<Event> = Vec::new();
        let mut repeat_interval_ms: Option<i64> = None;
        let mut last_notified_ms: Option<i64> = None;
        let mut i = 0;
        while i + 1 < flat.len() {
            let k = &flat[i];
            let v = &flat[i + 1];
            if k == "__meta__" {
                meta = Some(serde_json::from_str(v)?);
            } else if k == "__repeat_ms__" {
                repeat_interval_ms = v.parse::<i64>().ok();
            } else if k == "__last_notified__" {
                last_notified_ms = v.parse::<i64>().ok();
            } else if k.strip_prefix("ev:").is_some() {
                events.push(serde_json::from_str(v)?);
            } else if k.strip_prefix("fi:").is_some() {
                firing.push(serde_json::from_str(v)?);
            }
            i += 2;
        }
        Ok(meta.map(|m| GroupBatch {
            meta: m,
            events,
            firing,
            repeat_interval_ms,
            last_notified_ms,
        }))
    }

    async fn mark_notified(&self, group_id: &str, now_ms: i64) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = Script::new(MARK_NOTIFIED_LUA)
            .key(group_key(group_id))
            .arg(now_ms)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    async fn arm_repeat(&self, group_id: &str, due_ms: i64) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = Script::new(ARM_REPEAT_LUA)
            .key(group_key(group_id))
            .key(FLUSH_ZSET)
            .arg(group_id)
            .arg(due_ms)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::GroupMeta;

    #[test]
    fn group_meta_channel_names_round_trip() {
        let meta = GroupMeta {
            tenant: "t".into(),
            channels: vec!["team-slack".into(), "ops-mail".into()],
            group_key: "oncall|env=prod".into(),
            receiver: "oncall".into(),
        };
        let raw = serde_json::to_string(&meta).unwrap();
        assert!(
            !raw.contains("target"),
            "metas carry channel names only, never targets"
        );
        let back: GroupMeta = serde_json::from_str(&raw).unwrap();
        assert_eq!(back, meta);
        assert_eq!(back.channels, vec!["team-slack", "ops-mail"]);
    }
}
