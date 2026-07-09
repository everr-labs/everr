use crate::common::*;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --test load_smoke -- --ignored --nocapture"]
async fn smoke_infra_up() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    assert!(pg.url.starts_with("postgres://"));
    assert!(redis.url.starts_with("redis://"));

    let ch = ch_backend(&cfg, cfg.instances_per_rule).await;
    let tenant = cc::domain::ids::TenantId::from_trusted("smoke".to_string());
    let rows = ch
        .querier
        .query_rows(
            &tenant,
            &rule_sql(0, cfg.coalesce),
            &["svc".to_string()],
            Some("val"),
        )
        .await
        .unwrap();
    assert_eq!(rows.len(), cfg.instances_per_rule, "backend returns N rows");

    report(
        "smoke",
        &[
            ("CH backend", format!("{:?}", cfg.ch)),
            ("rows returned", rows.len().to_string()),
        ],
    );
}
