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
use testcontainers_modules::testcontainers::core::Mount;
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
    // The data is throwaway, so trade all crash-safety for speed: no fsync,
    // async commits, no full-page writes, and the data dir on tmpfs. The
    // connection cap is raised because every test in the binary shares this
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
        // Postgres 18 images moved PGDATA under /var/lib/postgresql/18/, so
        // mount the parent to keep the whole data tree (including WAL) on tmpfs.
        .with_mount(Mount::tmpfs_mount("/var/lib/postgresql"))
        .start()
        .await
        .expect("start shared postgres container");
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
