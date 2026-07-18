//! Per-replica TTL cache of the per-tenant silence/inhibition/firing data the dispatch
//! filters need. The per-event read path is identical to the eventual pub/sub design;
//! invalidation (a later Phase 3 item) only changes WHEN snapshots refresh.

use crate::dispatcher::routing::synthetic_labels;
use crate::dispatcher::slo_inhibit::synthesize_slo_inhibitions;
use crate::domain::ids::{InstanceKey, SloId, TenantId};
use crate::domain::inhibition::InhibitionRule;
use crate::domain::receiver::Receiver;
use crate::domain::routing::Route;
use crate::domain::silence::Silence;
use crate::domain::EventStatus;
use crate::stores::{PgStore, StoreError};
use async_trait::async_trait;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Default per-tenant snapshot lifetime.
pub const DEFAULT_TTL: Duration = Duration::from_secs(2);

/// Immutable per-tenant filter + routing inputs, shared with callers behind an `Arc`.
pub struct Snapshot {
    pub silences: Vec<Silence>,
    pub inhibitions: Vec<InhibitionRule>,
    /// Firing source-set as `(instance_key, synthetic_labels)`.
    pub firing: Vec<(InstanceKey, BTreeMap<String, String>)>,
    /// Routes in evaluation order (priority asc, then creation order).
    pub routes: Vec<Route>,
    /// Receivers as stored: named sets of channel references. No secrets here;
    /// the flusher resolves channel names to configs at delivery time.
    pub receivers: Vec<Receiver>,
}

struct Entry {
    loaded_at: Instant,
    snap: Arc<Snapshot>,
}

/// The snapshot-load seam the flush path depends on. Implemented by [`FilterCache`] in
/// production and by a failing double in tests, so the dead-letter-on-snapshot-failure
/// branch can be exercised without a live Postgres.
#[async_trait]
pub trait SnapshotProvider: Send + Sync {
    async fn snapshot(&self, tenant: TenantId) -> Result<Arc<Snapshot>, StoreError>;
}

pub struct FilterCache {
    store: PgStore,
    ttl: Duration,
    entries: RwLock<HashMap<String, Entry>>,
}

impl FilterCache {
    pub fn new(store: PgStore) -> Self {
        Self::with_ttl(store, DEFAULT_TTL)
    }

    pub fn with_ttl(store: PgStore, ttl: Duration) -> Self {
        Self {
            store,
            ttl,
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// Return a fresh-enough snapshot for `tenant`, reloading from Postgres if the
    /// cached entry is missing or older than the TTL. A concurrent double-reload is
    /// harmless (idempotent reads; last write wins).
    pub async fn snapshot(&self, tenant: TenantId) -> Result<Arc<Snapshot>, StoreError> {
        {
            let guard = self.entries.read().await;
            if let Some(e) = guard.get(tenant.as_str()) {
                if e.loaded_at.elapsed() <= self.ttl {
                    return Ok(e.snap.clone());
                }
            }
        }
        let key = tenant.as_str().to_string();
        let snap = Arc::new(self.load(tenant).await?);
        let mut guard = self.entries.write().await;
        guard.insert(
            key,
            Entry {
                loaded_at: Instant::now(),
                snap: snap.clone(),
            },
        );
        Ok(snap)
    }

    async fn load(&self, tenant: TenantId) -> Result<Snapshot, StoreError> {
        let now = time::OffsetDateTime::now_utc();
        let silences = self.store.list_active_silences(tenant.clone(), now).await?;
        let mut inhibitions = self.store.list_inhibitions(tenant.clone()).await?;
        let routes = self.store.routes_for(tenant.clone()).await?;
        let receivers = self.store.list_receivers(tenant.clone()).await?;

        // Spec §5: every SLO auto-provisions tier inhibitions, synthesized in-memory on
        // every load (never stored — see `dispatcher::slo_inhibit`). Uses the lean
        // dispatch projection (id/tenant/label_columns/tiers) instead of `list_slos`, so
        // a refresh never decodes the full spec (SQL text, target, window...) of every
        // SLO just to synthesize inhibitions.
        let slos = self.store.list_slos_for_dispatch(&tenant).await?;
        inhibitions.extend(synthesize_slo_inhibitions(&slos));

        let mut firing: Vec<(InstanceKey, BTreeMap<String, String>)> = self
            .store
            .list_firing(tenant.clone())
            .await?
            .into_iter()
            .map(|f| {
                let labels = synthetic_labels(
                    &f.labels,
                    f.severity,
                    EventStatus::Firing,
                    f.rule,
                    crate::domain::EventKind::Alert,
                    None, // rule-originated firing instances carry no SLO identity
                );
                (f.key, labels)
            })
            .collect();
        // SLO-originated firing instances (`FiringInstance.rule` type-puns the SLO uuid)
        // join the same source-set, labeled with their SLO identity so the synthesized
        // inhibitions' `equal: ["slo", ...]` comparison sees the label on both sides.
        firing.extend(
            self.store
                .list_firing_slos(&tenant)
                .await?
                .into_iter()
                .map(|f| {
                    let labels = synthetic_labels(
                        &f.labels,
                        f.severity,
                        EventStatus::Firing,
                        f.rule,
                        crate::domain::EventKind::Alert,
                        Some(SloId(f.rule.0)),
                    );
                    (f.key, labels)
                }),
        );
        Ok(Snapshot {
            silences,
            inhibitions,
            firing,
            routes,
            receivers,
        })
    }
}

#[async_trait]
impl SnapshotProvider for FilterCache {
    /// Delegates to the inherent TTL-cached `snapshot`. The inherent method shadows this
    /// one at concrete call sites; the trait exists only to give the flush path a seam.
    async fn snapshot(&self, tenant: TenantId) -> Result<Arc<Snapshot>, StoreError> {
        FilterCache::snapshot(self, tenant).await
    }
}
