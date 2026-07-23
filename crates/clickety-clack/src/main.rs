mod config;

use cc::api::auth::{ApiKeySet, HeaderAuth};
use cc::api::{build_supervised_router, AppState};
use cc::clickhouse::ChClient;
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::email::EmailNotifier;
use cc::dispatcher::notify::WebhookNotifier;
use cc::dispatcher::pagerduty::PagerDutyNotifier;
use cc::dispatcher::slack::SlackNotifier;
use cc::dispatcher::telegram::TelegramNotifier;
use cc::dispatcher::{run_dispatcher, run_group_flusher, Notifiers};
use cc::domain::sink::{AlertLogSink, NullSink};
use cc::evaluator::{maintenance::run_maintenance, run_evaluator};
use cc::events::run_events_consumer;
use cc::otel::exporter::{AlertLogExporter, ExporterSink};
use cc::queue::event_bus::RedisEventBus;
use cc::queue::groups::{GroupStore, RedisGroups};
use cc::queue::redis_streams::RedisQueue;
use cc::queue::{EventBus, Queue};
use cc::scheduler::membership::MembershipRegistry;
use cc::scheduler::run_scheduler;
use cc::stores::{PgStore, RedisLease};
use cc::supervisor::{
    supervise, wait_shutdown, RestartPolicy, RoleSpec, RolesHealth, SupervisorOutcome,
};
use config::Config;
use std::sync::Arc;
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = Config::from_env();
    // Engine self-telemetry (traces + metrics) on the PUBLIC OTLP path (everr-internal
    // key -> internal tenant). When unset we fall back to the bare fmt subscriber and run
    // without engine telemetry; the metrics handle degrades to a no-op the same way.
    // The guard lives in `main`'s scope so its Drop flushes buffered spans and metrics
    // on shutdown.
    let (_engine_guard, engine_metrics) = match (
        cfg.engine_otlp_endpoint.clone(),
        cfg.engine_ingest_api_key.clone(),
    ) {
        (Some(endpoint), Some(api_key)) => {
            let (guard, metrics) = cc::otel::engine::init_engine_telemetry(
                &endpoint,
                &api_key,
                &format!("clickety-clack-{}", cfg.role),
            )?;
            tracing::info!("engine telemetry enabled (public OTLP path, internal key)");
            (Some(guard), metrics)
        }
        _ => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "info".into()),
                )
                .init();
            tracing::warn!(
                "engine telemetry disabled (set CC_ENGINE_OTLP_ENDPOINT / CC_ENGINE_INGEST_API_KEY to enable)"
            );
            (None, cc::otel::EngineMetrics::disabled())
        }
    };
    let cipher: std::sync::Arc<dyn cc::crypto::SecretCipher> = cc::crypto::build_cipher(
        cc::crypto::ProviderKind::parse(&cfg.secret_provider)?,
        cfg.secret_keys.as_deref(),
        cfg.secret_active_key.as_deref(),
        cfg.kms_fake_root_key.as_deref(),
    )?;
    let store = PgStore::connect(&cfg.pg_url)
        .await?
        .with_engine_metrics(engine_metrics.clone());
    store.migrate().await?;
    let ch_auth = cc::clickhouse::build_ch_auth(
        &cfg.ch_auth_mode,
        &cfg.ch_user,
        &cfg.ch_password,
        cfg.ch_user_template.as_deref(),
        cfg.ch_master_key.as_deref(),
        &cfg.ch_password_suffix,
        cfg.ch_tenant_map.as_deref(),
    )?;
    let queue: Arc<dyn Queue> = Arc::new(
        RedisQueue::connect(&cfg.redis_url)
            .await?
            .with_engine_metrics(engine_metrics.clone()),
    );
    let event_bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&cfg.redis_url).await?);
    let ch = ChClient::new(&cfg.ch_url, ch_auth);

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let sd_tx = Arc::new(sd_tx);
    // Every enabled role becomes a supervised RoleSpec: the factory is called at
    // startup and again on each restart, so it only captures re-usable clones
    // (pools, connection managers, config strings). See cc::supervisor.
    let mut roles: Vec<RoleSpec> = Vec::new();
    let health = RolesHealth::default();

    let run = |r: &str| cfg.role == "all" || cfg.role == r;

    if run("api") {
        let state = AppState {
            store: store.clone(),
            ch: ch.clone(),
            auth: Arc::new(HeaderAuth),
            cipher: cipher.clone(),
            allow_private_webhooks: cfg.allow_private_webhooks,
        };
        if cfg.allow_private_webhooks {
            tracing::warn!(
                "CC_ALLOW_PRIVATE_WEBHOOKS is set: private/loopback webhook targets are allowed (dev only)"
            );
        }
        let api_keys = ApiKeySet::from_env_value(cfg.api_keys.as_deref());
        if api_keys.is_enabled() {
            tracing::info!("api auth enabled (bearer key required on /v1)");
        } else if cfg.dev_insecure_no_auth {
            tracing::warn!(
                "CC_DEV_INSECURE_NO_AUTH is set: /v1 is OPEN with no bearer auth and the caller \
                 picks its tenant via X-CC-Tenant (dev only)"
            );
        } else {
            // Fail closed: no keys and no explicit dev opt-in almost always means a
            // deployment forgot CC_API_KEYS, and the default 0.0.0.0 listener would
            // otherwise expose every /v1 route and let callers choose any tenant.
            anyhow::bail!(
                "refusing to start the api role with no CC_API_KEYS configured: set CC_API_KEYS \
                 to require a bearer key on /v1, or set CC_DEV_INSECURE_NO_AUTH=1 to run without \
                 auth (dev only)"
            );
        }
        // The listener is bound inside the role future so a restart re-binds it.
        // A brief EADDRINUSE right after a crash surfaces as Err and rides the
        // supervisor's backoff until the old socket is released.
        let addr = cfg.http_addr.clone();
        let api_health = health.clone();
        let rx = sd_rx.clone();
        roles.push(RoleSpec::restartable("api", move || {
            let state = state.clone();
            let api_keys = api_keys.clone();
            let addr = addr.clone();
            let health = api_health.clone();
            let rx = rx.clone();
            async move {
                let app = build_supervised_router(state, api_keys, health);
                let listener = tokio::net::TcpListener::bind(&addr).await?;
                tracing::info!(addr = %addr, "api listening");
                axum::serve(listener, app)
                    .with_graceful_shutdown(wait_shutdown(rx))
                    .await?;
                Ok(())
            }
        }));
    }

    if run("scheduler") {
        let registry = MembershipRegistry::connect(&cfg.redis_url).await?;
        let store = store.clone();
        let queue = queue.clone();
        let rx = sd_rx.clone();
        let node_id = cfg.node_id.clone();
        let shards = cfg.scheduler_shards;
        let ttl = cfg.scheduler_member_ttl_ms;
        roles.push(RoleSpec::restartable("scheduler", move || {
            let store = store.clone();
            let queue = queue.clone();
            let registry = registry.clone();
            let node_id = node_id.clone();
            let rx = rx.clone();
            async move {
                run_scheduler(
                    store,
                    queue,
                    registry,
                    node_id,
                    shards,
                    ttl,
                    Duration::from_secs(1),
                    500,
                    cfg.slo_base_cadence_secs as i32,
                    rx,
                )
                .await;
                Ok(())
            }
        }));
    }

    if run("evaluator") {
        {
            let store = store.clone();
            let queue = queue.clone();
            // Metrics attach to the evaluator's ClickHouse clone only, so API-driven
            // queries never count as evaluation queries.
            let ch: std::sync::Arc<dyn cc::clickhouse::RowQuerier> =
                std::sync::Arc::new(ch.clone().with_engine_metrics(engine_metrics.clone()));
            let events = event_bus.clone();
            let rx = sd_rx.clone();
            let consumer = cfg.node_id.clone();
            let degrade_after = cfg.rule_degrade_after;
            let metrics = engine_metrics.clone();
            roles.push(RoleSpec::restartable("evaluator", move || {
                let consumer = consumer.clone();
                let store = store.clone();
                let queue = queue.clone();
                let ch = ch.clone();
                let events = events.clone();
                let metrics = metrics.clone();
                let rx = rx.clone();
                async move {
                    run_evaluator(
                        consumer,
                        store,
                        queue,
                        ch,
                        events,
                        degrade_after,
                        metrics,
                        rx,
                    )
                    .await;
                    Ok(())
                }
            }));
        }
        {
            let lease =
                RedisLease::connect(&cfg.redis_url, "cc:maintenance:lease", &cfg.node_id, 10_000)
                    .await?;
            let store = store.clone();
            let bus = event_bus.clone();
            let rx = sd_rx.clone();
            let metrics = engine_metrics.clone();
            roles.push(RoleSpec::restartable("maintenance", move || {
                let store = store.clone();
                let bus = bus.clone();
                let lease = lease.clone();
                let metrics = metrics.clone();
                let rx = rx.clone();
                let slo_cadence_secs = cfg.slo_base_cadence_secs as i64;
                async move {
                    run_maintenance(
                        store,
                        bus,
                        lease,
                        Duration::from_secs(5),
                        slo_cadence_secs,
                        metrics,
                        rx,
                    )
                    .await;
                    Ok(())
                }
            }));
        }
        {
            let store = store.clone();
            let queue = queue.clone();
            let ch: std::sync::Arc<dyn cc::clickhouse::RowQuerier> =
                std::sync::Arc::new(ch.clone().with_engine_metrics(engine_metrics.clone()));
            let events = event_bus.clone();
            let rx = sd_rx.clone();
            let consumer = cfg.node_id.clone();
            let degrade_after = cfg.rule_degrade_after;
            let base_cadence = cfg.slo_base_cadence_secs as u64;
            // Sink for SLO evaluation samples (raw good/valid counts as OTLP gauges).
            // Uses the same trusted OTLP endpoint + ingest secret as the alert-log
            // export, deriving the /v1/metrics path; a no-op when unset.
            let samples: Arc<dyn cc::domain::SloSampleSink> = match (
                cfg.trusted_otlp_endpoint.clone(),
                cfg.trusted_ingest_secret.clone(),
            ) {
                (Some(endpoint), Some(secret)) => {
                    let metrics_endpoint = cc::otel::metrics_endpoint_from_logs(&endpoint);
                    tracing::info!(endpoint = %metrics_endpoint, "slo sample export enabled");
                    Arc::new(cc::otel::SloSampleExporterSink::new(
                        cc::otel::SloSampleExporter::new(&metrics_endpoint, &secret),
                    ))
                }
                _ => {
                    tracing::warn!(
                        "slo sample export disabled (set CC_TRUSTED_OTLP_ENDPOINT / CC_TRUSTED_INGEST_SECRET to enable)"
                    );
                    Arc::new(cc::domain::NullSink)
                }
            };
            roles.push(RoleSpec::restartable("slo-evaluator", move || {
                let consumer = consumer.clone();
                let store = store.clone();
                let queue = queue.clone();
                let ch = ch.clone();
                let events = events.clone();
                let samples = samples.clone();
                let rx = rx.clone();
                async move {
                    cc::evaluator::slo::run_slo_evaluator(
                        consumer,
                        store,
                        queue,
                        ch,
                        events,
                        samples,
                        base_cadence,
                        degrade_after,
                        rx,
                    )
                    .await;
                    Ok(())
                }
            }));
        }
    }

    if run("dispatcher") {
        let mut reg = Notifiers::new().with_engine_metrics(engine_metrics.clone());
        reg.register(Arc::new(WebhookNotifier::new()));
        reg.register(Arc::new(SlackNotifier::new()));
        reg.register(Arc::new(PagerDutyNotifier::new()));
        reg.register(Arc::new(TelegramNotifier::new()));
        if let Some(smtp) = cfg.smtp.clone() {
            reg.register(Arc::new(EmailNotifier::new(
                &smtp.host,
                smtp.port,
                &smtp.from,
                smtp.username.as_deref(),
                smtp.password.as_deref(),
            )));
            tracing::info!(host = %smtp.host, "email channel enabled");
        } else {
            tracing::info!("email channel disabled (set CC_SMTP_HOST to enable)");
        }
        let notifiers = Arc::new(reg);
        let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&cfg.redis_url).await?);
        let cache = Arc::new(FilterCache::new(store.clone()));
        // Sink for dispatcher-side delivery/silenced OTLP logs. Uses the same trusted
        // OTLP endpoint + ingest secret as the `events` role; falls back to a no-op when
        // unset so local/dev dispatching needs no exporter configured.
        let sink: Arc<dyn AlertLogSink> = match (
            cfg.trusted_otlp_endpoint.clone(),
            cfg.trusted_ingest_secret.clone(),
        ) {
            (Some(endpoint), Some(secret)) => {
                tracing::info!("dispatcher alert-log export enabled (delivery/silenced)");
                Arc::new(ExporterSink::new(AlertLogExporter::new(&endpoint, &secret)))
            }
            _ => {
                tracing::warn!(
                    "dispatcher alert-log export disabled (set CC_TRUSTED_OTLP_ENDPOINT / CC_TRUSTED_INGEST_SECRET to enable)"
                );
                Arc::new(NullSink)
            }
        };
        let ctx = cc::dispatcher::DispatchCtx {
            store: store.clone(),
            bus: event_bus.clone(),
            notifiers,
            groups,
            cache,
            cipher: cipher.clone(),
            sink,
        };
        {
            let ctx = ctx.clone();
            let rx = sd_rx.clone();
            let consumer = cfg.node_id.clone();
            roles.push(RoleSpec::restartable("dispatcher", move || {
                let consumer = consumer.clone();
                let ctx = ctx.clone();
                let rx = rx.clone();
                async move {
                    run_dispatcher(consumer, ctx, rx).await;
                    Ok(())
                }
            }));
        }
        {
            let rx = sd_rx.clone();
            roles.push(RoleSpec::restartable("group-flusher", move || {
                let ctx = ctx.clone();
                let rx = rx.clone();
                async move {
                    run_group_flusher(ctx, rx).await;
                    Ok(())
                }
            }));
        }
    }

    if run("events") {
        match (
            cfg.trusted_otlp_endpoint.clone(),
            cfg.trusted_ingest_secret.clone(),
        ) {
            (Some(endpoint), Some(secret)) => {
                let exporter = Arc::new(AlertLogExporter::new(&endpoint, &secret));
                let bus = event_bus.clone();
                let rx = sd_rx.clone();
                let consumer = cfg.node_id.clone();
                roles.push(RoleSpec::restartable("events", move || {
                    let consumer = consumer.clone();
                    let bus = bus.clone();
                    let exporter = exporter.clone();
                    let rx = rx.clone();
                    async move {
                        run_events_consumer(consumer, bus, exporter, rx).await;
                        Ok(())
                    }
                }));
                tracing::info!("events (alert-log export) role enabled");
            }
            _ => tracing::warn!(
                "events role selected but CC_TRUSTED_OTLP_ENDPOINT / CC_TRUSTED_INGEST_SECRET unset; not exporting"
            ),
        }
    }

    // Signal handling stays what it was (ctrl_c / SIGINT flips the shutdown
    // watch); it just runs beside the supervisor instead of being the only
    // thing main waits on.
    {
        let tx = sd_tx.clone();
        tokio::spawn(async move {
            if tokio::signal::ctrl_c().await.is_ok() {
                tracing::info!("shutdown signal received");
                let _ = tx.send(true);
            }
        });
    }

    match supervise(
        roles,
        RestartPolicy::default(),
        health,
        sd_tx,
        sd_rx.clone(),
    )
    .await
    {
        SupervisorOutcome::ShutdownComplete => Ok(()),
        SupervisorOutcome::Escalated { role } => Err(anyhow::anyhow!(
            "role '{role}' failed repeatedly; exiting nonzero so the orchestrator restarts the process"
        )),
    }
}
