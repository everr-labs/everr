use crate::domain::Event;
use crate::queue::QueueError;
use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::Script;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

const FLUSH_ZSET: &str = "cc:groupflush";
/// In-flight lease set: a group claimed for flushing sits here (score = lease deadline)
/// until the flusher releases it. If the flusher dies between claiming and taking the
/// group, the lease expires and [`GroupStore::reclaim_expired`] returns it to `FLUSH_ZSET`
/// so another replica reflushes it, instead of stranding the buffered group forever.
const INFLIGHT_ZSET: &str = "cc:groupflush:inflight";
/// How long a claimed group may stay in flight before its lease is reclaimable. Must
/// comfortably exceed a worst-case flush (snapshot load + fan-out delivery with retries),
/// so a healthy but slow flush is never reclaimed under it.
const CLAIM_LEASE_MS: i64 = 60_000;
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
    /// `default` so a group hash written by a pre-named-channels binary (which had
    /// `channel`/`target` instead) still deserializes during a rolling upgrade,
    /// reading as no channels (drained, never notified) rather than erroring.
    #[serde(default)]
    pub channels: Vec<String>,
    pub group_key: String,
    /// Clean receiver name (no grouping-value suffix); used as the delivery-target label.
    /// `default` for the same rolling-upgrade reason: legacy meta had no `receiver`.
    #[serde(default)]
    pub receiver: String,
}

/// Snapshot of one claimed group at flush time. Every field beyond `meta`/`events` is
/// carried by hash fields that simply do not exist on groups written by an older binary,
/// so an old-format group reads as "no firing membership, no repeat, never notified"
/// (rolling-upgrade safe by construction).
#[derive(Debug, Clone)]
pub struct GroupBatch {
    pub meta: GroupMeta,
    /// The buffered batch (`ev:*` fields). NOT cleared by the take: the flusher passes
    /// [`Self::event_fields`] to [`GroupStore::commit_drain`] once the batch is durably
    /// handled, so a crash mid-flush leaves the events buffered for the reflush.
    pub events: Vec<Event>,
    /// Raw `(field, value)` pairs backing `events`, handed back to
    /// [`GroupStore::commit_drain`] so exactly this take's snapshot is cleared (an
    /// event overwritten by a newer one during delivery is left in place).
    pub event_fields: Vec<(String, String)>,
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
    ///
    /// Writes are ordered by the event's `eval_ts`, not arrival order: an event older
    /// than one already applied for the same instance is dropped, so a Firing and a
    /// later Resolved buffered concurrently (see `process_event_batch`) can never leave
    /// the instance stuck firing regardless of which write lands last.
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

    /// Atomically claim up to `max` group ids whose flush is due (score <= now_ms),
    /// moving each from the flush timer into the in-flight lease set. Each id is then
    /// owned by this caller until it calls [`Self::release_claim`] (on success) or the
    /// lease expires and [`Self::reclaim_expired`] hands it to another flusher. This is
    /// the seam that makes the claim -> take -> deliver path crash-safe: the timer entry
    /// is never simply deleted, so a flusher dying mid-flush cannot strand the group.
    async fn claim_due(&self, now_ms: i64, max: usize) -> Result<Vec<String>, QueueError>;

    /// Requeue up to `max` in-flight groups whose lease expired (<= now_ms) back onto the
    /// flush timer, returning the requeued ids. Called by the flusher before each claim so
    /// a group claimed by a since-dead replica is picked up again instead of orphaned.
    async fn reclaim_expired(&self, now_ms: i64, max: usize) -> Result<Vec<String>, QueueError>;

    /// Release a group's in-flight lease once its flush has been handled. Idempotent; a
    /// no-op if the lease is already gone (e.g. a slow flush reclaimed in the meantime).
    ///
    /// Safety net: if buffered `ev:*` events remain and no flush timer is armed, the
    /// release re-arms the timer at `now_ms`. This covers the crossed-replica release:
    /// a flush outliving its lease releases the lease a reclaiming replica re-acquired;
    /// if that replica then dies mid-flush, its undrained batch would otherwise be left
    /// with neither a timer nor a lease until the next event re-arms the group.
    async fn release_claim(&self, group_id: &str, now_ms: i64) -> Result<(), QueueError>;

    /// Phase one of the two-phase take: snapshot a claimed group and stamp
    /// `__last_flush__ = now_ms` (so re-arrivals form a new batch), WITHOUT clearing
    /// the buffered `ev:*` fields. The batch is only removed by [`Self::commit_drain`]
    /// once delivery is durably begun (notifications-ledger rows written) or the batch
    /// is dead-lettered, so a flusher crashing between take and delivery leaves the
    /// events buffered: the lease-expiry reflush re-delivers them (deduped by the
    /// ledger) instead of silently losing the batch.
    /// Returns None if the group has no metadata (already expired).
    async fn take_group(
        &self,
        group_id: &str,
        now_ms: i64,
    ) -> Result<Option<GroupBatch>, QueueError>;

    /// Phase two of the two-phase take: clear exactly the given `(field, value)` pairs
    /// (a taken batch's [`GroupBatch::event_fields`]) from the group hash. A field
    /// whose value changed since the take (a newer event buffered during delivery) is
    /// left in place for the next flush. Idempotent.
    async fn commit_drain(
        &self,
        group_id: &str,
        fields: &[(String, String)],
    ) -> Result<(), QueueError>;

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
-- Instance identity is ARGV[2] (fingerprint); ARGV[11] is this event's eval_ts in ms.
-- Two events for the same instance can be buffered out of order (process_event_batch
-- runs them concurrently), so a stale FIRING must never overwrite a newer RESOLVED and
-- re-add firing membership. Track the newest eval_ts applied per instance (et:) and drop
-- anything older; et: survives takes (like fi:) so a stale event that arrives after the
-- newer one already flushed still cannot resurrect the alert.
local etk = 'et:'..ARGV[2]
local prev = redis.call('HGET', KEYS[1], etk)
if prev and tonumber(ARGV[11]) < tonumber(prev) then
  redis.call('PEXPIRE', KEYS[1], ARGV[8])
  return 0
end
redis.call('HSET', KEYS[1], etk, ARGV[11])
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

// Move due groups from the flush timer (KEYS[1]) into the in-flight lease set (KEYS[2])
// at score = now + lease (ARGV[3]), rather than just deleting them. A claimed group is
// thus never without a scheduled home: the flusher releases it on success, and a crash
// leaves it to be reclaimed once the lease expires.
const CLAIM_LUA: &str = r#"
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
local lease = tonumber(ARGV[1]) + tonumber(ARGV[3])
for i=1,#due do
  redis.call('ZREM', KEYS[1], due[i])
  redis.call('ZADD', KEYS[2], lease, due[i])
end
return due
"#;

// Return in-flight groups whose lease has expired (score <= now) and requeue each onto
// the flush timer at `now` so the next claim reflushes it. This is the crash-recovery
// path for a flusher that claimed a group but died before releasing it.
const RECLAIM_LUA: &str = r#"
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for i=1,#expired do
  redis.call('ZREM', KEYS[1], expired[i])
  redis.call('ZADD', KEYS[2], ARGV[1], expired[i])
end
return expired
"#;

// Drop a group's in-flight lease once its flush has been handled (delivered, or its retry
// re-armed on the flush timer). A no-op if the lease is already gone. Safety net: a group
// left with buffered ev:* events but no armed timer (a crossed-replica release dropping a
// lease someone else re-acquired) is re-armed at now (ARGV[2]) so it can never sit
// unscheduled. A normal flush drains before releasing, so the net does not trigger.
const RELEASE_LUA: &str = r#"
redis.call('ZREM', KEYS[1], ARGV[1])
if not redis.call('ZSCORE', KEYS[3], ARGV[1]) then
  local fields = redis.call('HKEYS', KEYS[2])
  for i=1,#fields do
    if string.sub(fields[i],1,3) == 'ev:' then
      redis.call('ZADD', KEYS[3], ARGV[2], ARGV[1])
      break
    end
  end
end
return 1
"#;

// Phase one of the two-phase take: snapshot the hash and stamp __last_flush__, but do
// NOT delete the ev:* fields. They are cleared by COMMIT_DRAIN_LUA only after the
// flusher has durably handled the batch, so a crash between take and delivery cannot
// lose it (the lease-expiry reflush takes the same batch again).
const TAKE_LUA: &str = r#"
local all = redis.call('HGETALL', KEYS[1])
redis.call('HSET', KEYS[1], '__last_flush__', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return all
"#;

// Phase two: delete each ARGV (field, value) pair only while the stored value still
// matches the taken snapshot, so a newer event buffered for the same instance during
// delivery survives the drain.
const COMMIT_DRAIN_LUA: &str = r#"
local n = 0
for i=1,#ARGV,2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i+1] then
    redis.call('HDEL', KEYS[1], ARGV[i])
    n = n + 1
  end
end
return n
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

// Scripts are built once (the SHA1 each `Script` carries is computed in `new`),
// not per invocation on the per-event hot paths below.
static ADD_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(ADD_LUA));
static CLAIM_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(CLAIM_LUA));
static RECLAIM_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(RECLAIM_LUA));
static RELEASE_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(RELEASE_LUA));
static TAKE_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(TAKE_LUA));
static COMMIT_DRAIN_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(COMMIT_DRAIN_LUA));
static MARK_NOTIFIED_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(MARK_NOTIFIED_LUA));
static ARM_REPEAT_SCRIPT: LazyLock<Script> = LazyLock::new(|| Script::new(ARM_REPEAT_LUA));

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
        // Milliseconds fit a Lua number exactly (unlike nanoseconds); one eval interval
        // of resolution is ample to order two events for the same instance.
        let eval_ms = (ev.eval_ts.unix_timestamp_nanos() / 1_000_000) as i64;
        let mut conn = self.conn.clone();
        let _: i64 = ADD_SCRIPT
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
            .arg(eval_ms)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    async fn claim_due(&self, now_ms: i64, max: usize) -> Result<Vec<String>, QueueError> {
        let mut conn = self.conn.clone();
        let ids: Vec<String> = CLAIM_SCRIPT
            .key(FLUSH_ZSET)
            .key(INFLIGHT_ZSET)
            .arg(now_ms)
            .arg(max as i64)
            .arg(CLAIM_LEASE_MS)
            .invoke_async(&mut conn)
            .await?;
        Ok(ids)
    }

    async fn reclaim_expired(&self, now_ms: i64, max: usize) -> Result<Vec<String>, QueueError> {
        let mut conn = self.conn.clone();
        let ids: Vec<String> = RECLAIM_SCRIPT
            .key(INFLIGHT_ZSET)
            .key(FLUSH_ZSET)
            .arg(now_ms)
            .arg(max as i64)
            .invoke_async(&mut conn)
            .await?;
        Ok(ids)
    }

    async fn release_claim(&self, group_id: &str, now_ms: i64) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = RELEASE_SCRIPT
            .key(INFLIGHT_ZSET)
            .key(group_key(group_id))
            .key(FLUSH_ZSET)
            .arg(group_id)
            .arg(now_ms)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    async fn take_group(
        &self,
        group_id: &str,
        now_ms: i64,
    ) -> Result<Option<GroupBatch>, QueueError> {
        let mut conn = self.conn.clone();
        let flat: Vec<String> = TAKE_SCRIPT
            .key(group_key(group_id))
            .arg(now_ms)
            .arg(GROUP_TTL_MS)
            .invoke_async(&mut conn)
            .await?;
        let mut meta: Option<GroupMeta> = None;
        let mut events: Vec<Event> = Vec::new();
        let mut event_fields: Vec<(String, String)> = Vec::new();
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
                event_fields.push((k.clone(), v.clone()));
            } else if k.strip_prefix("fi:").is_some() {
                firing.push(serde_json::from_str(v)?);
            }
            i += 2;
        }
        Ok(meta.map(|m| GroupBatch {
            meta: m,
            events,
            event_fields,
            firing,
            repeat_interval_ms,
            last_notified_ms,
        }))
    }

    async fn commit_drain(
        &self,
        group_id: &str,
        fields: &[(String, String)],
    ) -> Result<(), QueueError> {
        if fields.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.clone();
        let mut invocation = COMMIT_DRAIN_SCRIPT.prepare_invoke();
        invocation.key(group_key(group_id));
        for (field, value) in fields {
            invocation.arg(field).arg(value);
        }
        let _: i64 = invocation.invoke_async(&mut conn).await?;
        Ok(())
    }

    async fn mark_notified(&self, group_id: &str, now_ms: i64) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = MARK_NOTIFIED_SCRIPT
            .key(group_key(group_id))
            .arg(now_ms)
            .invoke_async(&mut conn)
            .await?;
        Ok(())
    }

    async fn arm_repeat(&self, group_id: &str, due_ms: i64) -> Result<(), QueueError> {
        let mut conn = self.conn.clone();
        let _: i64 = ARM_REPEAT_SCRIPT
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
