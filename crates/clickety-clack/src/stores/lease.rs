use redis::aio::ConnectionManager;
use std::sync::OnceLock;

/// Compare-and-expire: refresh the TTL only while the stored token is still
/// ours, in one atomic step. Returns 1 on refresh, 0 otherwise.
fn refresh_if_held() -> &'static redis::Script {
    static SCRIPT: OnceLock<redis::Script> = OnceLock::new();
    SCRIPT.get_or_init(|| {
        redis::Script::new(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then \
                 return redis.call('PEXPIRE', KEYS[1], ARGV[2]) \
             else \
                 return 0 \
             end",
        )
    })
}

/// Single-holder lease via Redis SET NX PX, refreshed by the holder.
/// `Clone` shares the connection manager and keeps the same key/token, so a
/// supervised restart of the holder resumes (or re-acquires) the same lease.
#[derive(Clone)]
pub struct RedisLease {
    conn: ConnectionManager,
    key: String,
    token: String,
    ttl_ms: usize,
}

impl RedisLease {
    pub async fn connect(
        url: &str,
        key: &str,
        token: &str,
        ttl_ms: usize,
    ) -> redis::RedisResult<Self> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self {
            conn,
            key: key.into(),
            token: token.into(),
            ttl_ms,
        })
    }

    /// Try to acquire or refresh the lease. Returns true if we hold it.
    pub async fn acquire_or_refresh(&self) -> redis::RedisResult<bool> {
        let mut conn = self.conn.clone();
        // Acquire if free.
        let set: Option<String> = redis::cmd("SET")
            .arg(&self.key)
            .arg(&self.token)
            .arg("NX")
            .arg("PX")
            .arg(self.ttl_ms)
            .query_async(&mut conn)
            .await?;
        if set.is_some() {
            return Ok(true);
        }
        // Already held — refresh only if it's ours. Atomic on purpose: a plain
        // GET + PEXPIRE pair races the key expiring and another holder acquiring
        // in between, which would extend the new holder's lease while telling us
        // we still hold it (two live holders).
        let refreshed: i64 = refresh_if_held()
            .key(&self.key)
            .arg(&self.token)
            .arg(self.ttl_ms)
            .invoke_async(&mut conn)
            .await?;
        Ok(refreshed == 1)
    }
}
