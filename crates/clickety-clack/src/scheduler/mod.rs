use crate::queue::{EvalJob, Queue};
use crate::stores::PgStore;
use std::sync::Arc;
use std::time::Duration;
use time::OffsetDateTime;
use tokio::sync::watch;

pub mod membership;

use membership::{owned_shards, MembershipRegistry};

/// Run the sharded scheduler until `shutdown` resolves. Each tick: refresh this node's
/// heartbeat, compute its owned shards via rendezvous hashing over the live membership,
/// and enqueue due rules for those shards. With `shard_count == 1` exactly one replica
/// owns the single shard (leaderless auto-failover singleton); raising it parallelizes.
#[allow(clippy::too_many_arguments)]
pub async fn run_scheduler(
    store: PgStore,
    queue: Arc<dyn Queue>,
    registry: MembershipRegistry,
    node_id: String,
    shard_count: u32,
    member_ttl_ms: u64,
    tick: Duration,
    batch: i64,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }

        match registry.heartbeat(&node_id, member_ttl_ms).await {
            Ok(members) => {
                let owned = owned_shards(&node_id, &members, shard_count);
                if owned.is_empty() {
                    tracing::debug!("scheduler owns no shards this tick");
                } else if let Err(e) =
                    // shard_count is config-bounded (default 1) far below i32::MAX; the
                    // store layer takes i32 to match Postgres INTEGER.
                    tick_once(
                        &store,
                        queue.as_ref(),
                        batch,
                        &owned,
                        shard_count as i32,
                    )
                    .await
                {
                    tracing::error!(error = %e, "scheduler tick failed");
                }
            }
            Err(e) => tracing::error!(error = %e, "membership heartbeat failed"),
        }

        tokio::select! {
            _ = tokio::time::sleep(tick) => {}
            _ = shutdown.changed() => {}
        }
    }
    tracing::info!("scheduler stopped");
}

async fn tick_once(
    store: &PgStore,
    queue: &dyn Queue,
    batch: i64,
    owned_shards: &[i32],
    shard_count: i32,
) -> anyhow::Result<()> {
    let now = OffsetDateTime::now_utc();
    let due = store
        .claim_due_rules_sharded(now, batch, owned_shards, shard_count)
        .await?;
    for rule in due {
        let job = EvalJob {
            tenant: rule.tenant,
            rule: rule.id,
            eval_ts: now,
        };
        queue.enqueue(&job).await?;
    }
    Ok(())
}
