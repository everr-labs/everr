//! The `events` role: a competing consumer on the `cc:logexport` group that converts
//! every instance transition / rule-health event into an OTLP alert log and ships it to
//! the trusted collector path, off the eval and dispatch hot paths.

use crate::domain::event::{EventKind, EventStatus};
use crate::domain::Event;
use crate::otel::alert_log::{build_log_record, AlertEventType, LogExtras};
use crate::otel::exporter::{AlertLogExporter, BufferedLog};
use std::sync::Arc;
use std::time::Duration;

/// Map a transition event to its alert-log event type. Transition role only emits the
/// transition vocabulary: firing/resolved instance transitions and rule-health; delivery
/// and silenced records are the dispatcher's concern (Group 5).
fn event_type_for(ev: &Event) -> AlertEventType {
    match (ev.kind, ev.status) {
        (EventKind::RuleHealth, _) => AlertEventType::RuleHealth,
        (EventKind::Alert, EventStatus::Firing) => AlertEventType::InstanceFired,
        (EventKind::Alert, EventStatus::Resolved) => AlertEventType::InstanceResolved,
    }
}

/// Build a per-tenant-attributed OTLP log record from an event. The customer tenant is the
/// event's tenant; the exporter groups records into one `ResourceLogs` per tenant.
fn to_buffered(ev: &Event) -> BufferedLog {
    let nanos = (ev.eval_ts.unix_timestamp_nanos()).max(0) as u64;
    BufferedLog {
        tenant: ev.tenant.as_str().to_string(),
        record: build_log_record(ev, event_type_for(ev), &LogExtras::default(), nanos),
    }
}

/// Consume transitions, batch per flush, export grouped-by-tenant, then ack only the
/// entries whose batch exported successfully (at-least-once; a failed export leaves the
/// entries unacked for redelivery).
pub async fn run_events_consumer(
    consumer: String,
    bus: Arc<dyn crate::queue::EventBus>,
    exporter: Arc<AlertLogExporter>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let entries = match bus.consume_logexport(&consumer, 64, 1000).await {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(error = %e, "logexport consume failed");
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                    _ = shutdown.changed() => {}
                }
                continue;
            }
        };
        if entries.is_empty() {
            // No work: yield to the runtime and watch for shutdown. `consume_logexport`
            // normally blocks up to `block_ms`, but a fast-returning backend (or fake)
            // must not spin a hot loop that starves a single-threaded executor.
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(50)) => {}
                _ = shutdown.changed() => {}
            }
            continue;
        }
        let buffered: Vec<BufferedLog> = entries.iter().map(|e| to_buffered(&e.event)).collect();
        match exporter.export(&buffered).await {
            Ok(()) => {
                for e in &entries {
                    if let Err(err) = bus.ack_logexport(&e.id).await {
                        tracing::error!(error = %err, "logexport ack failed");
                    }
                }
            }
            Err(err) => {
                // Leave unacked: the group redelivers on the next read (pending entries).
                tracing::error!(error = %err, n = entries.len(), "alert-log export failed; will retry");
            }
        }
    }
    tracing::info!("events consumer stopped");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;
    use uuid::Uuid;

    fn ev(kind: EventKind, status: EventStatus) -> Event {
        Event {
            tenant: TenantId::from_trusted("t"),
            rule: RuleId(Uuid::nil()),
            slo: None,
            name: String::new(),
            instance_key: InstanceKey("k".into()),
            status,
            kind,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: time::OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        }
    }

    #[test]
    fn maps_event_kind_status_to_event_type() {
        assert_eq!(
            event_type_for(&ev(EventKind::Alert, EventStatus::Firing)),
            AlertEventType::InstanceFired
        );
        assert_eq!(
            event_type_for(&ev(EventKind::Alert, EventStatus::Resolved)),
            AlertEventType::InstanceResolved
        );
        assert_eq!(
            event_type_for(&ev(EventKind::RuleHealth, EventStatus::Firing)),
            AlertEventType::RuleHealth
        );
        assert_eq!(
            event_type_for(&ev(EventKind::RuleHealth, EventStatus::Resolved)),
            AlertEventType::RuleHealth
        );
    }

    /// Suppressed events are NOT filtered from the alert-log export: they ship like any
    /// other transition, carrying `alert.suppressed = "true"` so history stays complete.
    #[test]
    fn suppressed_event_still_exports_with_attribute() {
        let mut e = ev(EventKind::Alert, EventStatus::Firing);
        e.suppressed = true;
        let b = to_buffered(&e);
        let attr = b
            .record
            .attributes
            .iter()
            .find(|a| a.key == "alert.suppressed")
            .expect("alert.suppressed attribute present");
        match attr.value.as_ref().unwrap().value.as_ref().unwrap() {
            opentelemetry_proto::tonic::common::v1::any_value::Value::StringValue(s) => {
                assert_eq!(s, "true")
            }
            other => panic!("expected string attr, got {other:?}"),
        }
    }

    #[test]
    fn buffered_log_carries_event_tenant() {
        let mut e = ev(EventKind::Alert, EventStatus::Firing);
        e.tenant = TenantId::from_trusted("cust-42");
        let b = to_buffered(&e);
        assert_eq!(b.tenant, "cust-42");
    }
}
