use crate::dispatcher::notify::{Notification, Notifier, NotifyError};
use crate::domain::channel::ChannelConfig;
use std::time::Duration;

/// Deterministic exponential backoff: base * 2^attempt, capped. No jitter (Phase 2a).
pub fn backoff_delay(attempt: u32, base_ms: u64, cap_ms: u64) -> Duration {
    let shifted = base_ms.checked_shl(attempt).unwrap_or(u64::MAX);
    Duration::from_millis(shifted.min(cap_ms))
}

/// Try delivery up to `max_attempts`. Retries only on Transient errors, sleeping
/// `backoff_delay` between attempts. Returns Ok(attempts_used) on success, or the
/// last error (Permanent stops immediately; Transient stops after max_attempts).
pub async fn deliver_with_retry(
    notifier: &dyn Notifier,
    config: &ChannelConfig,
    notif: &Notification,
    max_attempts: u32,
) -> Result<u32, (u32, NotifyError)> {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match notifier.send(config, notif).await {
            Ok(()) => return Ok(attempt),
            Err(NotifyError::Permanent(e)) => return Err((attempt, NotifyError::Permanent(e))),
            Err(NotifyError::Transient(e)) => {
                if attempt >= max_attempts {
                    return Err((attempt, NotifyError::Transient(e)));
                }
                tokio::time::sleep(backoff_delay(attempt - 1, 50, 5_000)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatcher::notify::{Notification, Notifier, NotifyError};
    use crate::domain::event::{Event, EventStatus};
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use async_trait::async_trait;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn notif() -> Notification {
        let ev = Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            EventStatus::Firing,
            BTreeMap::new(),
            None,
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        );
        Notification::single(&ev)
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff_delay(0, 50, 5_000), Duration::from_millis(50));
        assert_eq!(backoff_delay(1, 50, 5_000), Duration::from_millis(100));
        assert_eq!(backoff_delay(3, 50, 5_000), Duration::from_millis(400));
        assert_eq!(backoff_delay(20, 50, 5_000), Duration::from_millis(5_000));
    }

    fn config() -> ChannelConfig {
        ChannelConfig::Webhook { url: "t".into() }
    }

    struct Flaky {
        fail_first: u32,
        calls: AtomicU32,
    }
    #[async_trait]
    impl Notifier for Flaky {
        fn channel(&self) -> &'static str {
            "test"
        }
        async fn send(&self, _c: &ChannelConfig, _n: &Notification) -> Result<(), NotifyError> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if n <= self.fail_first {
                Err(NotifyError::Transient("flaky".into()))
            } else {
                Ok(())
            }
        }
    }

    struct AlwaysPermanent;
    #[async_trait]
    impl Notifier for AlwaysPermanent {
        fn channel(&self) -> &'static str {
            "test"
        }
        async fn send(&self, _c: &ChannelConfig, _n: &Notification) -> Result<(), NotifyError> {
            Err(NotifyError::Permanent("nope".into()))
        }
    }

    #[tokio::test]
    async fn retries_transient_then_succeeds() {
        let n = Flaky {
            fail_first: 2,
            calls: AtomicU32::new(0),
        };
        let attempts = deliver_with_retry(&n, &config(), &notif(), 5)
            .await
            .unwrap();
        assert_eq!(attempts, 3);
    }

    #[tokio::test]
    async fn permanent_stops_immediately() {
        let n = AlwaysPermanent;
        let (attempts, err) = deliver_with_retry(&n, &config(), &notif(), 5)
            .await
            .unwrap_err();
        assert_eq!(attempts, 1);
        assert!(matches!(err, NotifyError::Permanent(_)));
    }

    #[tokio::test]
    async fn transient_gives_up_after_max() {
        let n = Flaky {
            fail_first: 100,
            calls: AtomicU32::new(0),
        };
        let (attempts, err) = deliver_with_retry(&n, &config(), &notif(), 3)
            .await
            .unwrap_err();
        assert_eq!(attempts, 3);
        assert!(matches!(err, NotifyError::Transient(_)));
    }
}
