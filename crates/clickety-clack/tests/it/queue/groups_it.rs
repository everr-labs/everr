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
        traceparent: None,
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

/// A fresh Redis container + groups store. The caller holds the returned
/// `RedisInfra` guard for the test's lifetime; dropping it frees the
/// container (leaking via `mem::forget` piles containers up across the many
/// tests in this file and can exhaust Docker resources in CI).
async fn redis_groups() -> (crate::common::RedisInfra, RedisGroups) {
    let redis = crate::common::start_redis().await;
    let groups = RedisGroups::connect(&redis.url).await.unwrap();
    (redis, groups)
}

#[tokio::test]
async fn buffers_batches_and_claims_when_due() {
    let (_redis, groups) = redis_groups().await;

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

    // take_group returns meta + both active events. The take is a peek (phase one of
    // the two-phase take): the buffered fields stay in Redis until the flusher has
    // durably handled the batch and commits the drain.
    let batch = groups.take_group("g1", now + 100).await.unwrap().unwrap();
    assert_eq!(batch.meta.channels, vec!["ops-hook".to_string()]);
    let mut insts: Vec<String> = batch
        .events
        .iter()
        .map(|e| e.instance_key.0.clone())
        .collect();
    insts.sort();
    assert_eq!(insts, vec!["a".to_string(), "b".to_string()]);

    // A crashed flusher's reflush sees the same still-buffered batch.
    let again = groups.take_group("g1", now + 150).await.unwrap().unwrap();
    assert_eq!(
        again.events.len(),
        2,
        "take must not drain; only commit_drain clears the batch"
    );

    // Phase two: committing the drain with the taken fields clears the batch.
    groups
        .commit_drain("g1", &batch.event_fields)
        .await
        .unwrap();
    let after = groups.take_group("g1", now + 200).await.unwrap().unwrap();
    assert!(after.events.is_empty());
    // No repeat interval was ever set and nothing was marked notified.
    assert_eq!(after.repeat_interval_ms, None);
    assert_eq!(after.last_notified_ms, None);
}

#[tokio::test]
async fn previously_flushed_group_rearms_after_interval() {
    let (_redis, groups) = redis_groups().await;

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
    let (_redis, groups) = redis_groups().await;

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

    // Committing the drain clears the batch, but firing membership survives.
    groups
        .commit_drain("g3", &batch.event_fields)
        .await
        .unwrap();
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

// The commit-drain clears exactly what the take snapshotted: an event buffered during
// delivery (new instance) and a newer overwrite of a taken instance both survive.
#[tokio::test]
async fn commit_drain_keeps_events_buffered_during_delivery() {
    let (_redis, groups) = redis_groups().await;

    let now = 7_000_000i64;
    groups
        .add_to_group(
            "g6",
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

    // Phase one: the flusher snapshots the batch; delivery happens after this.
    let batch = groups.take_group("g6", now + 10).await.unwrap().unwrap();
    assert_eq!(batch.events.len(), 1);

    // Mid-delivery, the taken instance is overwritten by a newer event and a new
    // instance joins the group.
    let mut newer_a = ev("a", EventStatus::Resolved);
    newer_a.eval_ts = OffsetDateTime::UNIX_EPOCH + time::Duration::seconds(30);
    groups
        .add_to_group("g6", &meta(), "a", &newer_a, now + 20, 0, 1000, false, None)
        .await
        .unwrap();
    groups
        .add_to_group(
            "g6",
            &meta(),
            "b",
            &ev("b", EventStatus::Firing),
            now + 20,
            0,
            1000,
            true,
            None,
        )
        .await
        .unwrap();

    // Phase two: commit the drain for the taken fields only.
    groups
        .commit_drain("g6", &batch.event_fields)
        .await
        .unwrap();

    let next = groups.take_group("g6", now + 40).await.unwrap().unwrap();
    let mut insts: Vec<(String, EventStatus)> = next
        .events
        .iter()
        .map(|e| (e.instance_key.0.clone(), e.status))
        .collect();
    insts.sort_by(|x, y| x.0.cmp(&y.0));
    assert_eq!(
        insts,
        vec![
            ("a".to_string(), EventStatus::Resolved),
            ("b".to_string(), EventStatus::Firing),
        ],
        "the newer overwrite and the newcomer must survive the commit-drain"
    );
}

#[tokio::test]
async fn mark_notified_and_arm_repeat_drive_the_reminder_timer() {
    let (_redis, groups) = redis_groups().await;

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
    let batch = groups.take_group("g4", now).await.unwrap().unwrap();
    groups
        .commit_drain("g4", &batch.event_fields)
        .await
        .unwrap();

    // Simulate a send + the reminder arm the flusher performs.
    groups.mark_notified("g4", now).await.unwrap();
    groups.arm_repeat("g4", now + 5_000, now).await.unwrap();

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
    groups.arm_repeat("g4", now + 9_000, now).await.unwrap();
    groups.arm_repeat("g4", now + 20_000, now).await.unwrap();
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
    let (_redis, groups) = redis_groups().await;

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
    groups.arm_repeat("g5", now + 3_600_000, now).await.unwrap();

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

/// Route timings can exceed the default group-hash TTL (7d). Arming a flush timer
/// past the TTL must extend the hash's lifetime to cover the deadline, or the
/// flusher would later claim a group whose hash already expired and silently drop
/// the buffered batch or reminder.
#[tokio::test]
async fn long_timers_extend_the_group_hash_ttl() {
    let (redis, groups) = redis_groups().await;
    const DAY_MS: i64 = 24 * 60 * 60 * 1000;
    let now = 1_000_000i64;

    // group_wait of 14d: the buffered batch's flush timer outlives the default TTL.
    groups
        .add_to_group(
            "gttl",
            &meta(),
            "a",
            &ev("a", EventStatus::Firing),
            now,
            14 * DAY_MS,
            1_000,
            true,
            None,
        )
        .await
        .unwrap();
    let client = redis::Client::open(redis.url.as_str()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let pttl: i64 = redis::cmd("PTTL")
        .arg("cc:group:gttl")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(
        pttl > 14 * DAY_MS,
        "add_to_group must keep the hash alive past its armed deadline, got PTTL {pttl}"
    );

    // A reminder armed 20d out (claim first so the 14d timer is off the flush ZSET
    // and arm_repeat actually arms the later deadline) extends the TTL further.
    groups.claim_due(now + 14 * DAY_MS, 16).await.unwrap();
    groups.arm_repeat("gttl", now + 20 * DAY_MS, now).await.unwrap();
    let pttl: i64 = redis::cmd("PTTL")
        .arg("cc:group:gttl")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(
        pttl > 20 * DAY_MS,
        "arm_repeat must keep the hash alive past the reminder deadline, got PTTL {pttl}"
    );
}

// Rolling-upgrade safety: a group hash written by a binary predating the repeat
// feature (no fi:*, __repeat_ms__, or __last_notified__ fields) must still take
// cleanly: empty firing set, no repeat, never notified.
#[tokio::test]
async fn old_format_group_hash_takes_cleanly() {
    let (redis, groups) = redis_groups().await;
    let url = redis.url.clone();

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
    groups.arm_repeat("old1", 3_000, 0).await.unwrap();
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
    let (_redis, groups) = redis_groups().await;
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

/// The release safety net: dropping a lease while buffered events remain and no flush
/// timer is armed (a slow replica's release crossing another replica's re-acquired
/// lease) must re-arm the timer instead of stranding the batch with no schedule.
#[tokio::test]
async fn releasing_with_undrained_events_and_no_timer_rearms() {
    let (_redis, groups) = redis_groups().await;
    let now = 8_000_000i64;
    groups
        .add_to_group(
            "g7",
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
    // Claim consumes the timer; the take snapshots but does not drain.
    assert_eq!(
        groups.claim_due(now, 16).await.unwrap(),
        vec!["g7".to_string()]
    );
    let batch = groups.take_group("g7", now).await.unwrap().unwrap();
    assert_eq!(batch.events.len(), 1);

    // The crossed release: the lease is dropped with the batch still buffered and
    // nothing armed. Without the safety net the group would sit until a new event.
    groups.release_claim("g7", now + 10).await.unwrap();

    assert_eq!(
        groups.claim_due(now + 10, 16).await.unwrap(),
        vec!["g7".to_string()],
        "release must re-arm the timer for an undrained, unscheduled batch"
    );
}

/// Releasing a claim drops its lease, so a group whose flush completed cleanly is never
/// reclaimed (no duplicate reflush).
#[tokio::test]
async fn released_claim_is_not_reclaimed() {
    let (_redis, groups) = redis_groups().await;
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
    groups.release_claim("g", now).await.unwrap();
    assert!(
        groups
            .reclaim_expired(now + 120_000, 16)
            .await
            .unwrap()
            .is_empty(),
        "a released claim leaves nothing to reclaim"
    );
}
