use std::env;

#[derive(Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub from: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Clone)]
pub struct Config {
    pub role: String,
    pub http_addr: String,
    /// Comma-separated static bearer keys gating every `/v1` HTTP route
    /// (multiple entries allow zero-downtime rotation). Unset => the API-key
    /// gate is off and `/v1` is open (dev default). Only the `api` role reads it.
    pub api_keys: Option<String>,
    /// Dev/compose escape hatch: allow webhook targets on private/loopback IPs
    /// and `localhost` (`CC_ALLOW_PRIVATE_WEBHOOKS=1`). Off by default; see
    /// `crate::api::webhook_url`. Only the `api` role reads it.
    pub allow_private_webhooks: bool,
    pub pg_url: String,
    pub redis_url: String,
    pub ch_url: String,
    pub ch_user: String,
    pub ch_password: String,
    pub ch_auth_mode: String,
    pub ch_user_template: Option<String>,
    pub ch_master_key: Option<String>,
    pub ch_password_suffix: String,
    pub ch_tenant_map: Option<String>,
    pub node_id: String,
    pub rule_degrade_after: u32,
    pub slo_base_cadence_secs: u32,
    /// Reserved tunable: the per-window freshness cadence (Task 2's `is_window_due`)
    /// is currently derived from each SLO's own window durations, not from this
    /// value. Threaded through config now so a future budget-refresh cadence knob
    /// doesn't need a config-shape change; not yet read anywhere.
    #[allow(dead_code)]
    pub slo_budget_refresh_secs: u32,
    pub scheduler_shards: u32,
    pub scheduler_member_ttl_ms: u64,
    pub smtp: Option<SmtpConfig>,
    pub secret_provider: String,
    pub secret_keys: Option<String>,
    pub secret_active_key: Option<String>,
    pub kms_fake_root_key: Option<String>,
    /// Trusted OTLP/HTTP logs endpoint for alert-log export (e.g. the collector's
    /// `http://collector:4418/v1/logs`). The `events` role needs this + the bearer secret.
    pub trusted_otlp_endpoint: Option<String>,
    /// Bearer token for the collector's trusted ingest receiver.
    pub trusted_ingest_secret: Option<String>,
    /// Standard PUBLIC OTLP endpoint for CC's own engine telemetry (eval latency, dispatch
    /// outcomes, errors). Authenticated by `engine_ingest_api_key` -> everr's internal
    /// tenant. Distinct from the customer-event trusted path above. Unset => no-op.
    pub engine_otlp_endpoint: Option<String>,
    /// everr-internal ingest API key for engine telemetry on the public path
    /// (`Authorization: Bearer <key>`). Unset => engine telemetry runs as a no-op.
    pub engine_ingest_api_key: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let var = |k: &str, d: &str| env::var(k).unwrap_or_else(|_| d.to_string());
        let smtp = env::var("CC_SMTP_HOST").ok().map(|host| SmtpConfig {
            host,
            port: var("CC_SMTP_PORT", "25").parse().unwrap_or(25),
            from: var("CC_SMTP_FROM", "alerts@localhost"),
            username: env::var("CC_SMTP_USER").ok(),
            password: env::var("CC_SMTP_PASSWORD").ok(),
        });
        Config {
            role: var("CC_ROLE", "all"),
            http_addr: var("CC_HTTP_ADDR", "0.0.0.0:8080"),
            api_keys: env::var("CC_API_KEYS").ok(),
            allow_private_webhooks: matches!(
                var("CC_ALLOW_PRIVATE_WEBHOOKS", "0").trim(),
                "1" | "true"
            ),
            pg_url: var(
                "CC_PG_URL",
                "postgres://postgres:postgres@127.0.0.1:5432/postgres",
            ),
            redis_url: var("CC_REDIS_URL", "redis://127.0.0.1:6379"),
            ch_url: var("CC_CH_URL", "http://127.0.0.1:8123"),
            ch_user: var("CC_CH_USER", "default"),
            ch_password: var("CC_CH_PASSWORD", ""),
            ch_auth_mode: var("CC_CH_AUTH_MODE", "shared"),
            ch_user_template: env::var("CC_CH_USER_TEMPLATE").ok(),
            ch_master_key: env::var("CC_CH_MASTER_KEY").ok(),
            ch_password_suffix: var("CC_CH_PASSWORD_SUFFIX", ""),
            ch_tenant_map: env::var("CC_CH_TENANT_MAP").ok(),
            node_id: var("CC_NODE_ID", "node-1"),
            // Clamp to >= 1: a 0 shard count would silently disable all scheduling.
            scheduler_shards: var("CC_SCHEDULER_SHARDS", "1")
                .parse()
                .ok()
                .filter(|&n| n > 0)
                .unwrap_or(1),
            scheduler_member_ttl_ms: var("CC_SCHEDULER_MEMBER_TTL_MS", "10000")
                .parse()
                .unwrap_or(10_000),
            rule_degrade_after: var("CC_RULE_DEGRADE_AFTER", "3")
                .parse()
                .ok()
                .filter(|&n| n >= 1)
                .unwrap_or(3),
            slo_base_cadence_secs: var("CC_SLO_BASE_CADENCE_SECS", "30")
                .parse()
                .ok()
                .filter(|&n| n >= 1)
                .unwrap_or(30),
            slo_budget_refresh_secs: var("CC_SLO_BUDGET_REFRESH_SECS", "300")
                .parse()
                .ok()
                .filter(|&n| n >= 1)
                .unwrap_or(300),
            smtp,
            secret_provider: var("CC_SECRET_PROVIDER", "env"),
            secret_keys: env::var("CC_SECRET_KEYS").ok(),
            secret_active_key: env::var("CC_SECRET_ACTIVE_KEY").ok(),
            kms_fake_root_key: env::var("CC_KMS_FAKE_ROOT_KEY").ok(),
            trusted_otlp_endpoint: env::var("CC_TRUSTED_OTLP_ENDPOINT").ok(),
            trusted_ingest_secret: env::var("CC_TRUSTED_INGEST_SECRET").ok(),
            engine_otlp_endpoint: env::var("CC_ENGINE_OTLP_ENDPOINT").ok(),
            engine_ingest_api_key: env::var("CC_ENGINE_INGEST_API_KEY").ok(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degrade_after_defaults_to_three_and_clamps() {
        // Env-based; this is the only test touching CC_RULE_DEGRADE_AFTER.
        env::remove_var("CC_RULE_DEGRADE_AFTER");
        assert_eq!(Config::from_env().rule_degrade_after, 3);
        env::set_var("CC_RULE_DEGRADE_AFTER", "0");
        assert_eq!(Config::from_env().rule_degrade_after, 3, "0 clamps to 3");
        env::set_var("CC_RULE_DEGRADE_AFTER", "5");
        assert_eq!(Config::from_env().rule_degrade_after, 5);
        env::remove_var("CC_RULE_DEGRADE_AFTER");
    }

    #[test]
    fn slo_cadence_defaults_and_clamps() {
        // Env-based; this is the only test touching CC_SLO_BASE_CADENCE_SECS.
        env::remove_var("CC_SLO_BASE_CADENCE_SECS");
        assert_eq!(Config::from_env().slo_base_cadence_secs, 30);
        env::set_var("CC_SLO_BASE_CADENCE_SECS", "0");
        assert_eq!(
            Config::from_env().slo_base_cadence_secs,
            30,
            "0 clamps to 30"
        );
        env::set_var("CC_SLO_BASE_CADENCE_SECS", "45");
        assert_eq!(Config::from_env().slo_base_cadence_secs, 45);
        env::remove_var("CC_SLO_BASE_CADENCE_SECS");
    }

    #[test]
    fn trusted_otlp_fields_default_none() {
        env::remove_var("CC_TRUSTED_OTLP_ENDPOINT");
        env::remove_var("CC_TRUSTED_INGEST_SECRET");
        let c = Config::from_env();
        assert!(c.trusted_otlp_endpoint.is_none());
        assert!(c.trusted_ingest_secret.is_none());
    }

    #[test]
    fn engine_otlp_fields_default_none() {
        env::remove_var("CC_ENGINE_OTLP_ENDPOINT");
        env::remove_var("CC_ENGINE_INGEST_API_KEY");
        let c = Config::from_env();
        assert!(c.engine_otlp_endpoint.is_none());
        assert!(c.engine_ingest_api_key.is_none());
    }
}
