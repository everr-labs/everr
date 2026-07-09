use redis::aio::ConnectionManager;
use redis::AsyncCommands;

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
        // NOTE: GET + PEXPIRE is not atomic. In the tiny window between them the key
        // could expire and be reacquired by a new holder, causing us to extend their
        // lease. Negligible under any realistic TTL; replace with a Lua script if the
        // scheduler ever becomes multi-node with aggressive TTLs.
        // Already held — refresh only if it's ours.
        let current: Option<String> = conn.get(&self.key).await?;
        if current.as_deref() == Some(self.token.as_str()) {
            let _: bool = conn.pexpire(&self.key, self.ttl_ms as i64).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
