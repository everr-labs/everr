//! Process supervision for role tasks.
//!
//! `main` registers every enabled role as a [`RoleSpec`] and hands the set to
//! [`supervise`], which watches task completions as they happen. Any exit before
//! shutdown is a failure: it is logged at error level with the role name and
//! cause (panic payload, returned error, or an unexpected clean return), and the
//! role is restarted with exponential backoff (see [`RestartPolicy`]). After
//! `max_rapid_failures` consecutive rapid failures of the same role the
//! supervisor escalates: it requests a graceful shutdown of every other role and
//! returns [`SupervisorOutcome::Escalated`], which `main` turns into a nonzero
//! exit so the orchestrator restarts the whole pod. That is honest degradation
//! instead of a process that keeps reporting healthy with a dead worker inside.
//!
//! Shutdown discrimination: the supervisor shares the process-wide shutdown
//! watch channel with the roles. Once the flag is true, task exits are expected
//! (the roles observe the same flag and return), so they are drained silently
//! instead of being treated as failures.
//!
//! The decision logic ([`RoleFailureState::on_exit`], [`RestartPolicy::delay_for`])
//! and the readiness handle ([`RolesHealth`]) are pure and unit-tested here; the
//! `tokio::select!` loop in [`supervise`] is the thin glue that applies them.

use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::JoinSet;
use tokio::time::Instant;

/// Restart-policy knobs. Defaults: 1s doubling capped at 60s, the rapid-failure
/// counter resets after 10 minutes of stable running, and the 5th consecutive
/// rapid failure escalates.
#[derive(Debug, Clone, Copy)]
pub struct RestartPolicy {
    /// Delay before the first restart; doubles per consecutive rapid failure.
    pub base_delay: Duration,
    /// Backoff ceiling.
    pub max_delay: Duration,
    /// A run at least this long counts as stable and resets the failure counter.
    pub stable_after: Duration,
    /// Escalate on the Nth consecutive rapid failure.
    pub max_rapid_failures: u32,
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(60),
            stable_after: Duration::from_secs(600),
            max_rapid_failures: 5,
        }
    }
}

impl RestartPolicy {
    /// Backoff before the `n`th (1-based) consecutive rapid failure's restart:
    /// `base * 2^(n-1)`, capped at `max_delay`.
    pub fn delay_for(&self, consecutive_rapid_failures: u32) -> Duration {
        let n = consecutive_rapid_failures.max(1);
        let mult = 1u32.checked_shl(n - 1).unwrap_or(u32::MAX);
        self.base_delay.saturating_mul(mult).min(self.max_delay)
    }
}

/// What the supervisor does after a role exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Respawn the role after `delay`.
    Restart { delay: Duration },
    /// Give up on in-process recovery: gracefully stop the process (nonzero exit).
    Escalate,
}

/// Per-role failure accounting: counts consecutive rapid failures, resetting when
/// a run lasted at least [`RestartPolicy::stable_after`].
#[derive(Debug, Default)]
pub struct RoleFailureState {
    consecutive_rapid: u32,
}

impl RoleFailureState {
    /// Decide what to do after a role exit that ran for `ran_for`.
    /// `escalate_only` roles (not safely restartable) escalate on any exit.
    pub fn on_exit(
        &mut self,
        escalate_only: bool,
        ran_for: Duration,
        policy: &RestartPolicy,
    ) -> Decision {
        if escalate_only {
            return Decision::Escalate;
        }
        if ran_for >= policy.stable_after {
            self.consecutive_rapid = 0;
        }
        self.consecutive_rapid += 1;
        if self.consecutive_rapid >= policy.max_rapid_failures {
            Decision::Escalate
        } else {
            Decision::Restart {
                delay: policy.delay_for(self.consecutive_rapid),
            }
        }
    }
}

/// Why a supervised task exited (before shutdown was requested).
#[derive(Debug)]
pub enum ExitCause {
    /// The task panicked; carries the stringified panic payload.
    Panicked(String),
    /// The task returned `Err`; carries the formatted error chain.
    Errored(String),
    /// The task returned `Ok(())` without a shutdown request. Role loops only
    /// return on shutdown, so this is a bug and is treated as a failure.
    CleanReturn,
}

impl std::fmt::Display for ExitCause {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExitCause::Panicked(msg) => write!(f, "panicked: {msg}"),
            ExitCause::Errored(msg) => write!(f, "errored: {msg}"),
            ExitCause::CleanReturn => write!(f, "returned cleanly without shutdown"),
        }
    }
}

/// Render a panic payload (from `catch_unwind` or `JoinError::into_panic`) as a
/// string for logging. Panics carry `&str` or `String` payloads in practice.
pub fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "non-string panic payload".to_string()
    }
}

/// Readiness handle shared between the supervisor and `/readyz`: the set of role
/// names currently down or waiting out a restart backoff. Cloning shares state.
/// The default (empty) handle reports ready, so callers that never supervise
/// (tests, `build_router`) keep the prior always-ok behavior.
#[derive(Clone, Default)]
pub struct RolesHealth(Arc<Mutex<BTreeSet<String>>>);

impl RolesHealth {
    /// Mark a role as down (it exited and has not been respawned yet).
    pub fn set_down(&self, role: &str) {
        self.0.lock().expect("health lock").insert(role.to_string());
    }

    /// Mark a role as running again.
    pub fn set_up(&self, role: &str) {
        self.0.lock().expect("health lock").remove(role);
    }

    /// The sorted names of roles currently down.
    pub fn degraded(&self) -> Vec<String> {
        self.0
            .lock()
            .expect("health lock")
            .iter()
            .cloned()
            .collect()
    }

    /// True when no role is down.
    pub fn is_ready(&self) -> bool {
        self.0.lock().expect("health lock").is_empty()
    }
}

/// A boxed role future: runs until shutdown (returning `Ok(())`) or fails.
pub type RoleFuture = Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>>;

/// One supervised role: a name plus a factory that builds a fresh run future.
/// The factory is called once at startup and once per restart, so everything it
/// captures must be reusable (clones of connection managers, config strings).
pub struct RoleSpec {
    pub name: &'static str,
    /// Roles that cannot be safely restarted in-process escalate on any exit
    /// instead of restarting. No current role needs this; it exists so a future
    /// role holding non-recreatable state has an honest failure mode.
    pub escalate_only: bool,
    factory: Box<dyn Fn() -> RoleFuture + Send + Sync>,
}

impl RoleSpec {
    /// A role that is safe to restart in-process (all current roles).
    pub fn restartable<F, Fut>(name: &'static str, factory: F) -> Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = anyhow::Result<()>> + Send + 'static,
    {
        Self {
            name,
            escalate_only: false,
            factory: Box::new(move || Box::pin(factory())),
        }
    }
}

/// How a [`supervise`] run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupervisorOutcome {
    /// Shutdown was requested externally and every role drained; exit 0.
    ShutdownComplete,
    /// A role exhausted its restart budget; the supervisor already requested a
    /// graceful shutdown of the others. `main` exits nonzero.
    Escalated { role: &'static str },
}

/// Resolve once the shutdown flag is true (or every sender is gone).
pub async fn wait_shutdown(mut rx: watch::Receiver<bool>) {
    while !*rx.borrow_and_update() {
        if rx.changed().await.is_err() {
            return;
        }
    }
}

struct TaskMeta {
    role: usize,
    /// When the role body started (for delayed restarts: spawn time + backoff),
    /// used to measure run stability for the rapid-failure counter.
    started: Instant,
}

/// Grace period for roles to observe the shutdown flag before being aborted.
/// Role loops poll their queues with <= 2s timeouts, so this is generous.
const DRAIN_GRACE: Duration = Duration::from_secs(20);

async fn drain(set: &mut JoinSet<anyhow::Result<()>>) {
    let all_done = async { while set.join_next().await.is_some() {} };
    if tokio::time::timeout(DRAIN_GRACE, all_done).await.is_err() {
        tracing::warn!("some role tasks did not stop within the drain grace period; aborting them");
    }
    set.shutdown().await;
}

/// Run every role under supervision until shutdown or escalation.
///
/// `shutdown_tx`/`shutdown` are the process-wide shutdown watch channel: roles
/// hold receivers, `main`'s signal handler holds a sender clone, and the
/// supervisor sends on it when escalating so the surviving roles stop
/// gracefully before the process exits.
pub async fn supervise(
    roles: Vec<RoleSpec>,
    policy: RestartPolicy,
    health: RolesHealth,
    shutdown_tx: Arc<watch::Sender<bool>>,
    mut shutdown: watch::Receiver<bool>,
) -> SupervisorOutcome {
    let mut set: JoinSet<anyhow::Result<()>> = JoinSet::new();
    let mut meta: HashMap<tokio::task::Id, TaskMeta> = HashMap::new();
    let mut states: Vec<RoleFailureState> = Vec::new();
    for (idx, spec) in roles.iter().enumerate() {
        states.push(RoleFailureState::default());
        let id = set.spawn((spec.factory)()).id();
        meta.insert(
            id,
            TaskMeta {
                role: idx,
                started: Instant::now(),
            },
        );
    }

    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    drain(&mut set).await;
                    return SupervisorOutcome::ShutdownComplete;
                }
            }
            next = set.join_next_with_id(), if !set.is_empty() => {
                let Some(next) = next else { continue };
                let (task_id, cause) = match next {
                    Ok((id, Ok(()))) => (id, ExitCause::CleanReturn),
                    Ok((id, Err(e))) => (id, ExitCause::Errored(format!("{e:#}"))),
                    Err(join_err) => {
                        let id = join_err.id();
                        let cause = if join_err.is_panic() {
                            ExitCause::Panicked(panic_message(join_err.into_panic()))
                        } else {
                            // We never abort supervised tasks outside `drain`.
                            ExitCause::Errored("task was cancelled".to_string())
                        };
                        (id, cause)
                    }
                };
                let Some(tm) = meta.remove(&task_id) else { continue };
                if *shutdown.borrow() {
                    // Shutdown-initiated exit: expected, not a failure.
                    if set.is_empty() {
                        return SupervisorOutcome::ShutdownComplete;
                    }
                    continue;
                }
                let spec = &roles[tm.role];
                let ran_for = tm.started.elapsed();
                tracing::error!(
                    role = spec.name,
                    cause = %cause,
                    ran_for_secs = ran_for.as_secs(),
                    "role task exited unexpectedly"
                );
                health.set_down(spec.name);
                match states[tm.role].on_exit(spec.escalate_only, ran_for, &policy) {
                    Decision::Restart { delay } => {
                        tracing::warn!(
                            role = spec.name,
                            delay_ms = delay.as_millis() as u64,
                            "restarting role after backoff"
                        );
                        let fut = (spec.factory)();
                        let rx = shutdown.clone();
                        let role_health = health.clone();
                        let name = spec.name;
                        let id = set.spawn(async move {
                            tokio::select! {
                                _ = tokio::time::sleep(delay) => {}
                                _ = wait_shutdown(rx) => return Ok(()),
                            }
                            role_health.set_up(name);
                            tracing::info!(role = name, "role restarted");
                            fut.await
                        }).id();
                        meta.insert(id, TaskMeta {
                            role: tm.role,
                            started: Instant::now() + delay,
                        });
                    }
                    Decision::Escalate => {
                        tracing::error!(
                            role = spec.name,
                            "role failed repeatedly; escalating to process shutdown so the orchestrator restarts the pod"
                        );
                        let _ = shutdown_tx.send(true);
                        drain(&mut set).await;
                        return SupervisorOutcome::Escalated { role: spec.name };
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[test]
    fn backoff_doubles_and_caps() {
        let p = RestartPolicy::default();
        let delays: Vec<u64> = (1..=8).map(|n| p.delay_for(n).as_secs()).collect();
        assert_eq!(delays, vec![1, 2, 4, 8, 16, 32, 60, 60]);
    }

    #[test]
    fn backoff_shift_overflow_stays_capped() {
        let p = RestartPolicy::default();
        assert_eq!(p.delay_for(40), p.max_delay);
        assert_eq!(p.delay_for(0), p.base_delay); // treated as the 1st failure
    }

    #[test]
    fn rapid_failures_escalate_on_the_nth() {
        let p = RestartPolicy::default();
        let mut st = RoleFailureState::default();
        let rapid = Duration::from_secs(1);
        for expect_secs in [1, 2, 4, 8] {
            assert_eq!(
                st.on_exit(false, rapid, &p),
                Decision::Restart {
                    delay: Duration::from_secs(expect_secs)
                }
            );
        }
        assert_eq!(st.on_exit(false, rapid, &p), Decision::Escalate);
    }

    #[test]
    fn stable_run_resets_the_counter() {
        let p = RestartPolicy::default();
        let mut st = RoleFailureState::default();
        let rapid = Duration::from_secs(1);
        for _ in 0..3 {
            st.on_exit(false, rapid, &p);
        }
        // A run at least `stable_after` long resets: back to the base delay.
        assert_eq!(
            st.on_exit(false, p.stable_after, &p),
            Decision::Restart {
                delay: p.base_delay
            }
        );
        // And the escalation budget is fully restored.
        for expect_secs in [2, 4, 8] {
            assert_eq!(
                st.on_exit(false, rapid, &p),
                Decision::Restart {
                    delay: Duration::from_secs(expect_secs)
                }
            );
        }
        assert_eq!(st.on_exit(false, rapid, &p), Decision::Escalate);
    }

    #[test]
    fn escalate_only_roles_never_restart() {
        let p = RestartPolicy::default();
        let mut st = RoleFailureState::default();
        assert_eq!(st.on_exit(true, p.stable_after * 2, &p), Decision::Escalate);
    }

    #[test]
    fn roles_health_tracks_down_roles_sorted() {
        let h = RolesHealth::default();
        assert!(h.is_ready());
        h.set_down("evaluator");
        h.set_down("api");
        assert!(!h.is_ready());
        assert_eq!(h.degraded(), vec!["api", "evaluator"]);
        h.set_up("api");
        assert_eq!(h.degraded(), vec!["evaluator"]);
        h.set_up("evaluator");
        assert!(h.is_ready());
    }

    #[test]
    fn panic_message_downcasts_common_payloads() {
        assert_eq!(panic_message(Box::new("boom")), "boom");
        assert_eq!(panic_message(Box::new("boom".to_string())), "boom");
        assert_eq!(panic_message(Box::new(42u8)), "non-string panic payload");
    }

    fn channel() -> (Arc<watch::Sender<bool>>, watch::Receiver<bool>) {
        let (tx, rx) = watch::channel(false);
        (Arc::new(tx), rx)
    }

    /// Millisecond-scale backoff so loop tests run in real time without the
    /// tokio test-util feature. Escalation still triggers on the 5th failure.
    fn fast_policy() -> RestartPolicy {
        RestartPolicy {
            base_delay: Duration::from_millis(1),
            max_delay: Duration::from_millis(8),
            stable_after: Duration::from_secs(10),
            max_rapid_failures: 5,
        }
    }

    #[tokio::test]
    async fn supervise_escalates_after_repeated_rapid_failures() {
        let (tx, rx) = channel();
        let roles = vec![RoleSpec::restartable("boom", || async {
            anyhow::bail!("kaput")
        })];
        let out = supervise(roles, fast_policy(), RolesHealth::default(), tx.clone(), rx).await;
        assert_eq!(out, SupervisorOutcome::Escalated { role: "boom" });
        // Escalation requested a graceful shutdown of the other roles.
        assert!(*tx.borrow());
    }

    #[tokio::test]
    async fn supervise_treats_unexpected_clean_return_as_failure() {
        let (tx, rx) = channel();
        let roles = vec![RoleSpec::restartable("quitter", || async { Ok(()) })];
        let out = supervise(roles, fast_policy(), RolesHealth::default(), tx.clone(), rx).await;
        assert_eq!(out, SupervisorOutcome::Escalated { role: "quitter" });
    }

    #[tokio::test]
    async fn supervise_returns_clean_on_shutdown() {
        let (tx, rx) = channel();
        let role_rx = rx.clone();
        let roles = vec![RoleSpec::restartable("steady", move || {
            let rx = role_rx.clone();
            async move {
                wait_shutdown(rx).await;
                Ok(())
            }
        })];
        let sup = tokio::spawn(supervise(
            roles,
            fast_policy(),
            RolesHealth::default(),
            tx.clone(),
            rx,
        ));
        tokio::task::yield_now().await;
        tx.send(true).unwrap();
        assert_eq!(sup.await.unwrap(), SupervisorOutcome::ShutdownComplete);
    }

    #[tokio::test]
    async fn supervise_restarts_a_panicking_role_until_it_stabilizes() {
        let (tx, rx) = channel();
        let attempts = Arc::new(AtomicU32::new(0));
        let factory_attempts = attempts.clone();
        let role_rx = rx.clone();
        let health = RolesHealth::default();
        let roles = vec![RoleSpec::restartable("flaky", move || {
            let n = factory_attempts.fetch_add(1, Ordering::SeqCst);
            let rx = role_rx.clone();
            async move {
                if n < 2 {
                    panic!("boom {n}");
                }
                wait_shutdown(rx).await;
                Ok(())
            }
        })];
        let sup = tokio::spawn(supervise(
            roles,
            fast_policy(),
            health.clone(),
            tx.clone(),
            rx,
        ));
        // Two panics, then the third attempt runs stably: readiness recovers.
        while attempts.load(Ordering::SeqCst) < 3 || !health.is_ready() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        tx.send(true).unwrap();
        assert_eq!(sup.await.unwrap(), SupervisorOutcome::ShutdownComplete);
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
        assert!(health.is_ready());
    }
}
