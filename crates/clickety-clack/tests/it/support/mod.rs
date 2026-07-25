//! Shared Postgres for integration tests.
//!
//! Booting one Postgres testcontainer per test (and re-running the migration
//! stack in each) dominates suite wall-clock time. Instead, each test process
//! starts a single throwaway container, migrates one template database, and
//! hands every test its own `CREATE DATABASE ... TEMPLATE ...` copy: full
//! per-test isolation at a fraction of the cost.

use std::sync::atomic::{AtomicU64, Ordering};

use cc::domain::ids::TenantId;
use cc::domain::rule::{Rule, RuleSpec};
use cc::domain::slo::{Slo, SloSpec};
use cc::stores::{PgStore, RuleCreate, SloCreate};
use sqlx::{Connection, Executor, PgConnection};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};
use tokio::sync::{Mutex, OnceCell};

const TEMPLATE_DB: &str = "cc_template";

struct SharedPg {
    /// Keeps the container alive for the whole test process; the
    /// testcontainers reaper removes it once the process exits.
    _container: ContainerAsync<Postgres>,
    /// `postgres://postgres:postgres@127.0.0.1:{port}`, without a database
    /// path segment.
    base_url: String,
    /// `CREATE DATABASE ... TEMPLATE ...` fails if the template is being
    /// copied by a concurrent statement, so copies are serialized.
    create_db: Mutex<()>,
}

static SHARED: OnceCell<SharedPg> = OnceCell::const_new();
static DB_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The shared container's id, for [`remove_shared_container`].
static CONTAINER_ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Remove the shared container as the test process exits.
///
/// `SHARED` is a `static`, and Rust never drops statics, so the `Drop` impl that
/// `ContainerAsync` relies on to reap itself never runs: without this every
/// `cargo test` invocation orphans a Postgres container, and they accumulate until
/// Docker runs out of memory. This crate's testcontainers has no Ryuk reaper, and its
/// `watchdog` feature does not substitute: measured against a killed run it still
/// orphaned the container, while stretching shutdown from 2s to 28s. So `atexit` is
/// the process-exit hook the test harness otherwise doesn't offer.
///
/// Removal shells out because an `atexit` handler is synchronous while the Docker
/// client is async, and the runtime it needs is already gone by then. Only this
/// process's own container is touched, so concurrent test binaries can't reap each
/// other. A hard kill (SIGKILL) still orphans one; nothing short of a reaper sidecar
/// can cover that.
extern "C" fn remove_shared_container() {
    if let Some(id) = CONTAINER_ID.get() {
        let _ = std::process::Command::new("docker")
            .args(["rm", "-f", id])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// Returns the connection URL of a brand-new database cloned from the fully
/// migrated template.
///
/// The first call in a process boots the shared container and runs the
/// migration stack once; every call (including the first) then gets its own
/// isolated database, so callers must not run `migrate()` again.
pub async fn fresh_db() -> String {
    let shared = SHARED.get_or_init(init_shared).await;
    let name = format!("test_{}", DB_COUNTER.fetch_add(1, Ordering::Relaxed));
    {
        let _guard = shared.create_db.lock().await;
        let mut admin = PgConnection::connect(&format!("{}/postgres", shared.base_url))
            .await
            .expect("connect to shared postgres");
        admin
            .execute(format!("CREATE DATABASE {name} TEMPLATE {TEMPLATE_DB}").as_str())
            .await
            .expect("create test database from template");
        admin.close().await.expect("close admin connection");
    }
    format!("{}/{name}", shared.base_url)
}

async fn init_shared() -> SharedPg {
    // The data is throwaway, so trade all crash-safety for speed: no fsync, async
    // commits, no full-page writes. That is where the speed comes from, so the data
    // dir deliberately stays on the container filesystem rather than a tmpfs: every
    // test gets its own `CREATE DATABASE ... TEMPLATE` copy and none are ever dropped,
    // so the whole suite's databases must fit at once. A RAM disk caps that at a
    // fraction of the host's memory and the run dies partway through with
    // "No space left on device"; disk has room to spare for a few seconds of writes
    // that are never fsynced anyway.
    // The connection cap is raised because every test in the binary shares this
    // one server (each PgStore pool may open up to 16 connections).
    // Pin to the major version the dev/prod stack runs (docker-compose uses
    // postgres:18.x); the module default is postgres 11, which predates the
    // built-in gen_random_uuid() that migration 0014 relies on.
    let container = Postgres::default()
        .with_tag("18-alpine")
        .with_cmd([
            "postgres",
            "-c",
            "fsync=off",
            "-c",
            "synchronous_commit=off",
            "-c",
            "full_page_writes=off",
            "-c",
            "max_connections=500",
        ])
        .start()
        .await
        .expect("start shared postgres container");
    // Registered before the first `await` below so the handler is in place no matter
    // how the rest of setup ends.
    CONTAINER_ID
        .set(container.id().to_string())
        .expect("shared container is initialised once");
    // SAFETY: `remove_shared_container` only reads a `OnceLock` that is already set and
    // spawns a subprocess; `atexit` handlers run in normal process context, not a
    // signal handler, so that is permitted.
    unsafe { libc::atexit(remove_shared_container) };
    let port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("resolve shared postgres port");
    let base_url = format!("postgres://postgres:postgres@127.0.0.1:{port}");

    // Create the template database and run the full migration stack into it,
    // exactly once per process.
    let mut admin = PgConnection::connect(&format!("{base_url}/postgres"))
        .await
        .expect("connect to shared postgres");
    admin
        .execute(format!("CREATE DATABASE {TEMPLATE_DB}").as_str())
        .await
        .expect("create template database");
    admin.close().await.expect("close admin connection");

    let store = cc::stores::PgStore::connect(&format!("{base_url}/{TEMPLATE_DB}"))
        .await
        .expect("connect to template database");
    store.migrate().await.expect("migrate template database");
    // Template copies require the template to have no active connections, so
    // tear the migration pool down before any test can request a copy.
    store.pool_for_test().close().await;
    drop(store);

    SharedPg {
        _container: container,
        base_url,
        create_db: Mutex::new(()),
    }
}

/// Create a live rule with a unique test name in the root namespace, unwrapping the
/// `Created` outcome. Panics on `NameConflict` (a per-test-unique name should never
/// collide within a fresh tenant).
pub async fn create_test_rule(
    store: &PgStore,
    tenant: TenantId,
    name: &str,
    spec: &RuleSpec,
) -> Rule {
    match store.create_rule(tenant, "", name, spec).await.unwrap() {
        RuleCreate::Created(r) => r,
        other => panic!("expected Created, got {other:?}"),
    }
}

/// Create a live SLO with a unique test name in the root namespace, unwrapping the
/// `Created` outcome. Panics on `NameConflict` (a per-test-unique name should never
/// collide within a fresh tenant).
pub async fn create_test_slo(store: &PgStore, tenant: TenantId, name: &str, spec: &SloSpec) -> Slo {
    match store.create_slo(tenant, "", name, spec).await.unwrap() {
        SloCreate::Created(s) => s,
        other => panic!("expected Created, got {other:?}"),
    }
}
