//! Store seams the evaluator hot path is generic over.
//!
//! The batch orchestrators ([`super::process_batch_inner`] and
//! [`super::slo::process_slo_batch_inner`]) take `&S` where `S` implements these traits
//! rather than a concrete `&PgStore`. This is what lets the durability-based ack logic be
//! tested by wrapping a real `PgStore` in a fault injector that forces a chosen operation to
//! fail, then asserting which jobs the orchestrator acks versus leaves for reclaim.
//!
//! The traits are used only through generic bounds (never `dyn`), so every call
//! monomorphizes to a direct call: the seam adds no dispatch cost to the production path.
//! `PgStore` is the sole production implementor and simply forwards to its inherent
//! methods.

use crate::domain::ids::{RuleId, SloId, TenantId};
use crate::domain::instance::InstanceState;
use crate::domain::rule::Rule;
use crate::domain::slo::Slo;
use crate::domain::Event;
use crate::stores::{EvalCadence, PersistOutcome, PgStore, SloStatusRow, StoreError};
use time::OffsetDateTime;
use uuid::Uuid;

/// Outbox writes shared by every commit path (rule and SLO). A failed delete only warns:
/// the events already published, so the maintenance relay re-publishing those rows is a
/// duplicate the dispatcher dedups.
#[allow(async_fn_in_trait)]
pub trait OutboxStore {
    async fn delete_outbox(&self, id: Uuid) -> Result<(), StoreError>;
    async fn delete_outbox_batch(&self, ids: &[Uuid]) -> Result<(), StoreError>;
}

/// The store operations the rule-evaluation batch path performs.
#[allow(async_fn_in_trait)]
pub trait RuleEvalStore: OutboxStore {
    async fn get_rules_by_ids(&self, ids: &[RuleId]) -> Result<Vec<Rule>, StoreError>;
    async fn record_rule_failure(
        &self,
        rule: RuleId,
        tenant: &TenantId,
        err: &str,
        threshold: i32,
        now: OffsetDateTime,
        claim: Option<OffsetDateTime>,
    ) -> Result<Option<(Event, Uuid)>, StoreError>;
    async fn record_rule_success(
        &self,
        rule: RuleId,
        tenant: &TenantId,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError>;
    async fn load_instances(
        &self,
        tenant: &TenantId,
        rule: RuleId,
    ) -> Result<Vec<InstanceState>, StoreError>;
    #[allow(clippy::too_many_arguments)]
    async fn persist_eval_batch(
        &self,
        instances: &[InstanceState],
        events: &[Event],
        rollup: Option<(RuleId, crate::domain::rollup::RuleRollup)>,
        cadence: Option<(RuleId, EvalCadence)>,
        rule_tenant: Option<&TenantId>,
        claim: Option<(RuleId, OffsetDateTime)>,
    ) -> Result<PersistOutcome, StoreError>;
}

/// The store operations the SLO-evaluation batch path performs.
#[allow(async_fn_in_trait)]
pub trait SloEvalStore: OutboxStore {
    async fn get_slos_by_ids(&self, ids: &[SloId]) -> Result<Vec<Slo>, StoreError>;
    async fn get_slo_status(
        &self,
        tenant: &TenantId,
        slo: SloId,
    ) -> Result<Option<SloStatusRow>, StoreError>;
    async fn record_slo_failure(
        &self,
        slo: SloId,
        tenant: &TenantId,
        err: &str,
        degrade_after: u32,
        now: OffsetDateTime,
        claim: Option<OffsetDateTime>,
    ) -> Result<Option<(Event, Uuid)>, StoreError>;
    async fn record_slo_success(
        &self,
        slo: SloId,
        tenant: &TenantId,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError>;
    async fn load_slo_instances(
        &self,
        tenant: &TenantId,
        slo: SloId,
    ) -> Result<Vec<InstanceState>, StoreError>;
    #[allow(clippy::too_many_arguments)]
    async fn persist_slo_eval(
        &self,
        slo: SloId,
        tenant: &TenantId,
        payload: &serde_json::Value,
        computed_at: OffsetDateTime,
        instances: &[InstanceState],
        events: &[Event],
        claim: Option<OffsetDateTime>,
    ) -> Result<PersistOutcome, StoreError>;
}

// ---- The production implementor: forward to PgStore's inherent methods. ----

impl OutboxStore for PgStore {
    async fn delete_outbox(&self, id: Uuid) -> Result<(), StoreError> {
        PgStore::delete_outbox(self, id).await
    }
    async fn delete_outbox_batch(&self, ids: &[Uuid]) -> Result<(), StoreError> {
        PgStore::delete_outbox_batch(self, ids).await
    }
}

impl RuleEvalStore for PgStore {
    async fn get_rules_by_ids(&self, ids: &[RuleId]) -> Result<Vec<Rule>, StoreError> {
        PgStore::get_rules_by_ids(self, ids).await
    }
    async fn record_rule_failure(
        &self,
        rule: RuleId,
        tenant: &TenantId,
        err: &str,
        threshold: i32,
        now: OffsetDateTime,
        claim: Option<OffsetDateTime>,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        PgStore::record_rule_failure(self, rule, tenant, err, threshold, now, claim).await
    }
    async fn record_rule_success(
        &self,
        rule: RuleId,
        tenant: &TenantId,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        PgStore::record_rule_success(self, rule, tenant, now).await
    }
    async fn load_instances(
        &self,
        tenant: &TenantId,
        rule: RuleId,
    ) -> Result<Vec<InstanceState>, StoreError> {
        PgStore::load_instances(self, tenant, rule).await
    }
    async fn persist_eval_batch(
        &self,
        instances: &[InstanceState],
        events: &[Event],
        rollup: Option<(RuleId, crate::domain::rollup::RuleRollup)>,
        cadence: Option<(RuleId, EvalCadence)>,
        rule_tenant: Option<&TenantId>,
        claim: Option<(RuleId, OffsetDateTime)>,
    ) -> Result<PersistOutcome, StoreError> {
        PgStore::persist_eval_batch(self, instances, events, rollup, cadence, rule_tenant, claim)
            .await
    }
}

impl SloEvalStore for PgStore {
    async fn get_slos_by_ids(&self, ids: &[SloId]) -> Result<Vec<Slo>, StoreError> {
        PgStore::get_slos_by_ids(self, ids).await
    }
    async fn get_slo_status(
        &self,
        tenant: &TenantId,
        slo: SloId,
    ) -> Result<Option<SloStatusRow>, StoreError> {
        PgStore::get_slo_status(self, tenant, slo).await
    }
    async fn record_slo_failure(
        &self,
        slo: SloId,
        tenant: &TenantId,
        err: &str,
        degrade_after: u32,
        now: OffsetDateTime,
        claim: Option<OffsetDateTime>,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        PgStore::record_slo_failure(self, slo, tenant, err, degrade_after, now, claim).await
    }
    async fn record_slo_success(
        &self,
        slo: SloId,
        tenant: &TenantId,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        PgStore::record_slo_success(self, slo, tenant, now).await
    }
    async fn load_slo_instances(
        &self,
        tenant: &TenantId,
        slo: SloId,
    ) -> Result<Vec<InstanceState>, StoreError> {
        PgStore::load_slo_instances(self, tenant, slo).await
    }
    async fn persist_slo_eval(
        &self,
        slo: SloId,
        tenant: &TenantId,
        payload: &serde_json::Value,
        computed_at: OffsetDateTime,
        instances: &[InstanceState],
        events: &[Event],
        claim: Option<OffsetDateTime>,
    ) -> Result<PersistOutcome, StoreError> {
        PgStore::persist_slo_eval(
            self,
            slo,
            tenant,
            payload,
            computed_at,
            instances,
            events,
            claim,
        )
        .await
    }
}
