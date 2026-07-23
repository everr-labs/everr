use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use cc::queue::groups::{GroupMeta, GroupStore, RedisGroups};
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

fn ev(inst: &str, status: EventStatus) -> Event {
    Event {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        slo: None,
        name: String::new(),
        instance_key: InstanceKey(inst.into()),
        status,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

fn meta() -> GroupMeta {
    GroupMeta {
        tenant: Uuid::nil().to_string(),
        channels: vec!["ops-hook".into()],
        group_key: "ops|rule=,severity=warning".into(),
        receiver: "ops".into(),
    }
}

async fn redis_groups() -> (String, RedisGroups) {
    let redis = crate::common::start_redis().await;
    let url = redis.url.clone();
    // Keep the container alive for the duration of the process.
    std::mem::forget(redis);
    let groups = RedisGroups::connect(&url).await.unwrap();
    (url, groups)
}

#[tokio::test]
async fn buffers_batches_and_claims_when_due() {
    let (_url, groups) = redis_groups().await;

    let now = 1_000_000i64;
    // New group, group_wait = 50ms → due at now+50.
    groups
        .add_to_group(
            "g1",
            &meta(),
            "a",
            &ev("a", EventStatus::Firing),
            now,
            50,
            5000,
            true,
            None,
        )
        .await
        .unwrap();
    // Second event joins the same already-armed group (does not push the timer out).
    groups
        .add_to_group(
            "g1",
            &meta(),
            "b",
            &ev("b", EventStatus::Firing),
            now + 10,
            50,
            5000,
            true,
            None,
        )
        .await
        .unwrap();

    // Not due yet.
    assert!(groups.claim_due(now + 10, 16).await.unwrap().is_empty());

    // Due now.
    let claimed = groups.claim_due(now + 100, 16).await.unwrap();
    assert_eq!(claimed, vec!["g1".to_string()]);

    // A second claim finds nothing (timer was removed atomically).
    assert!(groups.claim_due(now + 100, 16).await.unwrap().is_empty());

    // take_group returns meta + both active events, then clears them.
    let batch = groups.take_group("g1", now + 100).await.unwrap().unwrap();
    assert_eq!(batch.meta.channels, vec!["ops-hook".to_string()]);
    let mut events = batch.events;
    events.sort_by(|x, y| x.instance_key.0.cmp(&y.instance_key.0));
    let insts: Vec<String> = events.iter().map(|e| e.instance_key.0.clone()).collect();
    assert_eq!(insts, vec!["a".to_string(), "b".to_string()]);

    // After take, the group has no events; a re-take yields meta with empty events.
    let after = groups.take_group("g1", now + 200).await.unwrap().unwrap();
    assert!(after.events.is_empty());
    // No repeat interval was ever set and nothing was marked notified.
    assert_eq!(after.repeat_interval_ms, None);
    assert_eq!(after.last_notified_ms, None);
}

#[tokio::test]
async fn previously_flushed_group_rearms_after_interval() {
    let (_url, groups) = redis_groups().await;

    let now = 2_000_000i64;
    groups
        .add_to_group(
            "g2",
            &meta(),
            "a",
            &ev("a", EventStatus::Firing),
            now,
            0,
            1000,
            true,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        groups.claim_due(now, 16).await.unwrap(),
        vec!["g2".to_string()]
    );
    // Flush stamps __last_flush__ = now.
    groups.take_group("g2", now).await.unwrap();

    // A new event arrives at now+10; group re-arms at last_flush + interval = now+1000.
    groups
        .add_to_group(
            "g2",
            &meta(),
            "b",
            &ev("b", EventStatus::Firing),
            now + 10,
            0,
            1000,
            true,
            None,
        )
        .await
        .unwrap();
    assert!(
        groups.claim_due(now + 500, 16).await.unwrap().is_empty(),
        "interval not elapsed"
    );
    assert_eq!(
        groups.claim_due(now + 1000, 16).await.unwrap(),
        vec!["g2".to_string()],
        "due after interval"
    );
}

// Firing membership (`fi:*`) survives takes and shrinks when resolves are buffered,
// and the repeat interval rides along, latest write wins.
#[tokio::test]
async fn firing_membership_tracks_resolves_and_survives_takes() {
    let (_url, groups) = redis_groups().await;

    let now = 3_000_000i64;
    let repeat = Some(60_000i64);
    for fp in ["a", "b"] {
        groups
            .add_to_group(
                "g3",
                &meta(),
                fp,
                &ev(fp, EventStatus::Firing),
                now,
                0,
                1000,
                true,
                repeat,
            )
            .await
            .unwrap();
    }

    let batch = groups.take_group("g3", now + 10).await.unwrap().unwrap();
    assert_eq!(batch.events.len(), 2);
    assert_eq!(batch.firing.len(), 2, "both instances are still firing");
    assert_eq!(batch.repeat_interval_ms, Some(60_000));

    // The batch was cleared, but firing membership survives the take.
    let again = groups.take_group("g3", now + 20).await.unwrap().unwrap();
    assert!(again.events.is_empty());
    assert_eq!(again.firing.len(), 2, "firing set survives takes");

    // A resolve for `a` removes it from the firing set (and joins the next batch).
    groups
        .add_to_group(
            "g3",
            &meta(),
            "a",
            &ev("a", EventStatus::Resolved),
            now + 30,
            0,
            1000,
            false,
            repeat,
        )
        .await
        .unwrap();
    let after = groups.take_group("g3", now + 40).await.unwrap().unwrap();
    assert_eq!(after.events.len(), 1, "the resolve is the new batch");
    assert_eq!(
        after.firing.len(),
        1,
        "resolved instance left the firing set"
    );
    assert_eq!(after.firing[0].instance_key.0, "b");

    // A route update dropping the repeat interval clears it (latest write wins).
    groups
        .add_to_group(
            "g3",
            &meta(),
            "b",
            &ev("b", EventStatus::Firing),
            now + 50,
            0,
            1000,
            true,
            None,
        )
        .await
        .unwrap();
    let last = groups.take_group("g3", now + 60).await.unwrap().unwrap();
    assert_eq!(
        last.repeat_interval_ms, None,
        "repeat cleared by latest add"
    );
}

#[tokio::test]
async fn mark_notified_and_arm_repeat_drive_the_reminder_timer() {
    let (_url, groups) = redis_groups().await;

    let now = 4_000_000i64;
    groups
        .add_to_group(
            "g4",
            &meta(),
            "a",
            &ev("a", EventStatus::Firing),
            now,
            0,
            1000,
            true,
            Some(5_000),
        )
        .await
        .unwrap();
    groups.claim_due(now, 16).await.unwrap();
    groups.take_group("g4", now).await.unwrap();

    // Simulate a send + the reminder arm the flusher performs.
    groups.mark_notified("g4", now).await.unwrap();
    groups.arm_repeat("g4", now + 5_000).await.unwrap();

    assert!(
        groups.claim_due(now + 4_999, 16).await.unwrap().is_empty(),
        "reminder not due yet"
    );
    assert_eq!(
        groups.claim_due(now + 5_000, 16).await.unwrap(),
        vec!["g4".to_string()],
        "reminder due at last send + repeat interval"
    );
    let batch = groups.take_group("g4", now + 5_000).await.unwrap().unwrap();
    assert!(batch.events.is_empty(), "no new events, only the reminder");
    assert_eq!(batch.firing.len(), 1);
    assert_eq!(batch.last_notified_ms, Some(now));
    assert_eq!(batch.repeat_interval_ms, Some(5_000));

    // arm_repeat never pushes an armed timer OUT; it only pulls it in.
    groups.arm_repeat("g4", now + 9_000).await.unwrap();
    groups.arm_repeat("g4", now + 20_000).await.unwrap();
    assert_eq!(
        groups.claim_due(now + 9_000, 16).await.unwrap(),
        vec!["g4".to_string()],
        "the earlier arm wins"
    );
}

// A pending far-out reminder must not delay a fresh batch: a new event pulls the
// armed timer in to the group_interval schedule.
#[tokio::test]
async fn new_event_pulls_in_a_far_repeat_timer() {
    let (_url, groups) = redis_groups().await;

    let now = 5_000_000i64;
    groups
        .add_to_group(
            "g5",
            &meta(),
            "a",
            &ev("a", EventStatus::Firing),
            now,
            0,
            1000,
            true,
            Some(3_600_000),
        )
        .await
        .unwrap();
    groups.claim_due(now, 16).await.unwrap();
    groups.take_group("g5", now).await.unwrap();
    // Reminder armed one hour out.
    groups.arm_repeat("g5", now + 3_600_000).await.unwrap();

    // A new event at now+10 must be deliverable at last_flush + group_interval,
    // not in an hour.
    groups
        .add_to_group(
            "g5",
            &meta(),
            "b",
            &ev("b", EventStatus::Firing),
            now + 10,
            0,
            1000,
            true,
            Some(3_600_000),
        )
        .await
        .unwrap();
    assert_eq!(
        groups.claim_due(now + 1_000, 16).await.unwrap(),
        vec!["g5".to_string()],
        "fresh batch pulled the timer in to the group_interval schedule"
    );
}

// Rolling-upgrade safety: a group hash written by a binary predating the repeat
// feature (no fi:*, __repeat_ms__, or __last_notified__ fields) must still take
// cleanly: empty firing set, no repeat, never notified.
#[tokio::test]
async fn old_format_group_hash_takes_cleanly() {
    let (url, groups) = redis_groups().await;

    let legacy_meta = r#"{"tenant":"t","channels":["oncall-slack"],"group_key":"oncall|env=prod","receiver":"oncall"}"#;
    let legacy_ev = serde_json::to_string(&ev("a", EventStatus::Firing)).unwrap();
    let client = redis::Client::open(url.as_str()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let _: () = redis::cmd("HSET")
        .arg("cc:group:old1")
        .arg("__meta__")
        .arg(legacy_meta)
        .arg("ev:a")
        .arg(&legacy_ev)
        .arg("__last_flush__")
        .arg(123i64)
        .query_async(&mut conn)
        .await
        .unwrap();

    let batch = groups.take_group("old1", 1_000).await.unwrap().unwrap();
    assert_eq!(batch.meta.receiver, "oncall");
    assert_eq!(batch.events.len(), 1);
    assert!(
        batch.firing.is_empty(),
        "old groups have no firing membership"
    );
    assert_eq!(batch.repeat_interval_ms, None, "old groups never repeat");
    assert_eq!(batch.last_notified_ms, None);

    // The new bookkeeping calls are harmless on such a group.
    groups.mark_notified("old1", 2_000).await.unwrap();
    groups.arm_repeat("old1", 3_000).await.unwrap();
    assert_eq!(
        groups.claim_due(3_000, 16).await.unwrap(),
        vec!["old1".to_string()]
    );
}

/// A claim that is never released (its flusher died before taking the group) does not
/// strand the buffered group: the flush timer no longer holds it, but the in-flight lease
/// does, and `reclaim_expired` returns it to the timer once the lease elapses.
#[tokio::test]
async fn claimed_group_is_reclaimed_after_its_lease_expires() {
    let (_url, groups) = redis_groups().await;
    let now = 5_000_000i64;
    groups
        .add_to_group(
            "g",
            &meta(),
            "a",
            &ev("a", EventStatus::Firing),
            now,
            0,
            1000,
            true,
            None,
        )
        .await
        .unwrap();

    // Claim leases the group (score = now + CLAIM_LEASE_MS = now + 60_000).
    assert_eq!(
        groups.claim_due(now, 16).await.unwrap(),
        vec!["g".to_string()]
    );
    // The timer no longer holds it, so a plain claim finds nothing while the lease is live.
    assert!(
        groups.claim_due(now + 500, 16).await.unwrap().is_empty(),
        "held by the in-flight lease, not the timer"
    );
    // Not yet reclaimable: the lease has not elapsed.
    assert!(
        groups
            .reclaim_expired(now + 30_000, 16)
            .await
            .unwrap()
            .is_empty(),
        "lease not expired yet"
    );
    // Once the lease elapses, reclaim requeues it onto the timer for another flusher.
    assert_eq!(
        groups.reclaim_expired(now + 60_001, 16).await.unwrap(),
        vec!["g".to_string()],
        "expired lease requeued"
    );
    assert_eq!(
        groups.claim_due(now + 60_001, 16).await.unwrap(),
        vec!["g".to_string()],
        "reclaimable again after recovery"
    );
}

/// Releasing a claim drops its lease, so a group whose flush completed cleanly is never
/// reclaimed (no duplicate reflush).
#[tokio::test]
async fn released_claim_is_not_reclaimed() {
    let (_url, groups) = redis_groups().await;
    let now = 6_000_000i64;
    groups
        .add_to_group(
            "g",
            &meta(),
            "a",
            &ev("a", EventStatus::Firing),
            now,
            0,
            1000,
            true,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        groups.claim_due(now, 16).await.unwrap(),
        vec!["g".to_string()]
    );
    groups.release_claim("g").await.unwrap();
    assert!(
        groups
            .reclaim_expired(now + 120_000, 16)
            .await
            .unwrap()
            .is_empty(),
        "a released claim leaves nothing to reclaim"
    );
}
