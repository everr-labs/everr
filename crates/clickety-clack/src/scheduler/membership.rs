use redis::aio::ConnectionManager;
use redis::Script;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Deterministic weight of `(node_id, shard)` for rendezvous (HRW) hashing. Uses
/// `DefaultHasher` over both inputs: it has a fixed seed (unlike `RandomState`), so it is
/// stable within a given Rust toolchain — every replica running the same binary computes
/// identical ownership. Note `DefaultHasher`'s algorithm is not guaranteed stable across
/// Rust releases, so a mixed-toolchain deployment could compute divergent maps; that only
/// causes brief double-ownership of a shard, which is harmless here (the sharded claim uses
/// `FOR UPDATE SKIP LOCKED` and evaluation is idempotent via `try_claim_eval`), matching
/// the same transient already accepted during membership rebalances.
fn hash64(node_id: &str, shard: u32) -> u64 {
    let mut h = DefaultHasher::new();
    node_id.hash(&mut h);
    shard.hash(&mut h);
    h.finish()
}

/// Shards owned by `node_id` under rendezvous (HRW) hashing over the live `members`.
/// For each shard in `[0, shard_count)` the owner is the member with the highest
/// `hash64(member, shard)`, ties broken by lexicographically-smallest node id for
/// determinism. Returns the owned shard indices ascending. If `node_id` is not among
/// `members` (e.g. its heartbeat just expired), returns empty.
pub fn owned_shards(node_id: &str, members: &[String], shard_count: u32) -> Vec<i32> {
    if !members.iter().any(|m| m == node_id) {
        return Vec::new();
    }
    let mut owned = Vec::new();
    for shard in 0..shard_count {
        let mut best_node: &str = "";
        let mut best_w: u64 = 0;
        let mut first = true;
        for m in members {
            let w = hash64(m, shard);
            if first || w > best_w || (w == best_w && m.as_str() < best_node) {
                best_node = m.as_str();
                best_w = w;
                first = false;
            }
        }
        if best_node == node_id {
            owned.push(shard as i32);
        }
    }
    owned
}

const MEMBERS_KEY: &str = "cc:scheduler:members";

// Refresh this node's heartbeat (score = Redis server time in ms, so all replicas agree
// on "now"), evict members older than ttl_ms, and return the live member set.
const HEARTBEAT_LUA: &str = r#"
local t = redis.call('TIME')
local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZADD', KEYS[1], now_ms, ARGV[1])
-- evict members with score <= now_ms - ttl_ms (live window is the last ttl_ms; a member
-- exactly ttl_ms old is treated as stale).
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now_ms - tonumber(ARGV[2]))
return redis.call('ZRANGE', KEYS[1], 0, -1)
"#;

/// Redis-backed scheduler membership. A sorted set `cc:scheduler:members` maps node id →
/// last-heartbeat (Redis server clock). Leaderless: every replica heartbeats and reads the
/// same live set, then computes its shards via [`owned_shards`].
/// `Clone` shares the underlying connection manager, so the supervisor can
/// respawn the scheduler role without reconnecting.
#[derive(Clone)]
pub struct MembershipRegistry {
    conn: ConnectionManager,
}

impl MembershipRegistry {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }

    /// Refresh `node_id`'s heartbeat and return the live members (heartbeat within
    /// `ttl_ms`), evicting stale ones. Atomic via a single Lua script.
    pub async fn heartbeat(&self, node_id: &str, ttl_ms: u64) -> anyhow::Result<Vec<String>> {
        let mut conn = self.conn.clone();
        let members: Vec<String> = Script::new(HEARTBEAT_LUA)
            .key(MEMBERS_KEY)
            .arg(node_id)
            .arg(ttl_ms as i64)
            .invoke_async(&mut conn)
            .await?;
        Ok(members)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn members(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn single_member_owns_all_shards() {
        assert_eq!(
            owned_shards("n1", &members(&["n1"]), 8),
            (0..8).collect::<Vec<i32>>()
        );
    }

    #[test]
    fn non_member_owns_nothing() {
        assert!(owned_shards("nx", &members(&["n1", "n2"]), 8).is_empty());
    }

    #[test]
    fn partition_is_total_and_disjoint() {
        let ms = members(&["n1", "n2", "n3"]);
        let mut union = HashSet::new();
        for n in ["n1", "n2", "n3"] {
            for s in owned_shards(n, &ms, 256) {
                assert!(union.insert(s), "shard {s} owned by more than one node");
            }
        }
        assert_eq!(union.len(), 256, "every shard owned by exactly one node");
    }

    #[test]
    fn deterministic_across_calls() {
        let ms = members(&["a", "b", "c"]);
        assert_eq!(owned_shards("b", &ms, 256), owned_shards("b", &ms, 256));
    }

    #[test]
    fn adding_member_only_moves_shards_to_new_node() {
        let two = members(&["n1", "n2"]);
        let three = members(&["n1", "n2", "n3"]);
        let n1_two: HashSet<i32> = owned_shards("n1", &two, 256).into_iter().collect();
        let n1_three: HashSet<i32> = owned_shards("n1", &three, 256).into_iter().collect();
        // HRW invariant: adding n3 can only TAKE shards from n1, never give it new ones.
        assert!(n1_three.is_subset(&n1_two));
    }

    #[test]
    fn balance_is_roughly_even() {
        let ms = members(&["n1", "n2", "n3", "n4"]);
        for n in ["n1", "n2", "n3", "n4"] {
            let c = owned_shards(n, &ms, 256).len();
            // expected 64; deterministic, with a loose bound that tolerates HRW spread.
            assert!(
                (32..=96).contains(&c),
                "node {n} owns {c} shards, expected ~64"
            );
        }
    }
}
