use cc::scheduler::membership::MembershipRegistry;

async fn registry() -> (String, crate::common::RedisInfra) {
    let redis = crate::common::start_redis().await;
    (redis.url.clone(), redis)
}

#[tokio::test]
async fn heartbeat_registers_and_lists_live_members() {
    let (url, _node) = registry().await;
    let reg = MembershipRegistry::connect(&url).await.unwrap();

    let m = reg.heartbeat("n1", 10_000).await.unwrap();
    assert_eq!(m, vec!["n1".to_string()]);

    let reg2 = MembershipRegistry::connect(&url).await.unwrap();
    reg2.heartbeat("n2", 10_000).await.unwrap();

    let mut m = reg.heartbeat("n1", 10_000).await.unwrap();
    m.sort();
    assert_eq!(m, vec!["n1".to_string(), "n2".to_string()]);
}

#[tokio::test]
async fn stale_members_are_evicted_after_ttl() {
    let (url, _node) = registry().await;
    let reg = MembershipRegistry::connect(&url).await.unwrap();

    // n2 heartbeats once with a 1ms TTL, then never again.
    reg.heartbeat("n2", 1).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // n1 heartbeats (also 1ms TTL): n2's score is now > 1ms old → evicted; n1 just added.
    let m = reg.heartbeat("n1", 1).await.unwrap();
    assert_eq!(m, vec!["n1".to_string()], "stale n2 must be evicted");
}
