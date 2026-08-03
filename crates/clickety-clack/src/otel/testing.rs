//! Shared setup for tests that install their own tracing subscriber to capture
//! spans through an in-memory OpenTelemetry exporter.

/// Make it safe for a test to install a span-capturing subscriber on its own
/// thread while sibling tests run without one.
///
/// `tracing` caches each callsite's `Interest` process-wide, but
/// `subscriber::set_default`/`with_default` install a subscriber on the calling
/// thread only. So whichever thread reaches an instrumented callsite first
/// decides its cached interest for the whole process, and a thread with no
/// subscriber registers `Interest::never()` — after which the span is never
/// created on the capturing thread either, however correct the code under test
/// is. The test then fails with an empty exporter, intermittently, depending
/// only on how the harness happened to schedule its threads.
///
/// Installing a permissive global default first removes the hazard from both
/// ends: no thread is ever subscriber-less, so nothing can register `never`, and
/// `set_global_default` rebuilds the interest cache, discarding any entry an
/// earlier test already poisoned.
///
/// Call this before installing the per-test subscriber. It is idempotent: after
/// the first call `set_global_default` returns `Err`, which just means another
/// test got here first and the hazard is already gone.
pub(crate) fn ensure_permissive_callsite_interest() {
    let _ = tracing::subscriber::set_global_default(tracing_subscriber::registry());
}
