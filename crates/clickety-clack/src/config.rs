use std::env;

#[derive(Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub tls: String,
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
    /// gate is off; the `api` role then refuses to start unless
    /// [`Self::dev_insecure_no_auth`] is set. Only the `api` role reads it.
    pub api_keys: Option<String>,
    /// Explicit opt-in to run the `api` role with the API-key gate OFF (every `/v1`
    /// route open, tenant chosen by the caller's `X-CC-Tenant`). Required to boot
    /// without `CC_API_KEYS` so a deployment that simply forgot the keys fails closed
    /// instead of exposing every tenant. `CC_DEV_INSECURE_NO_AUTH=1`; dev/compose only.
    pub dev_insecure_no_auth: bool,
    /// Dev/compose escape hatch: allow webhook targets on private/loopback IPs
    /// and `localhost` (`CC_ALLOW_PRIVATE_WEBHOOKS=1`). Off by default; see
    /// `crate::api::webhook_url`. The `api` and `dispatcher` roles read it.
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
    /// Explicit opt-in to run tenant-authored rule SQL as ClickHouse's `default` user
    /// in `shared` auth mode (`CC_DEV_INSECURE_CH_DEFAULT_USER=1`; dev/compose only).
    /// Required to boot in that combination so a deployment that never got round to
    /// provisioning a restricted user fails closed instead of handing every rule author
    /// full privileges. See [`Config::unhardened_ch_user`].
    pub dev_insecure_ch_default_user: bool,
    pub node_id: String,
    pub rule_degrade_after: u32,
    pub slo_base_cadence_secs: u32,
    /// Seconds the SLI query window ends before the evaluation instant, so it
    /// reads only rows that have settled in ClickHouse (measured insert delay
    /// is 2-9s). Values over 60 fall back to the default so the shift can
    /// never eat a meaningful part of the floored 60s short window.
    pub slo_ingest_delay_secs: u32,
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
        let flag = |k: &str| matches!(var(k, "0").trim(), "1" | "true");
        let smtp = env::var("CC_SMTP_HOST").ok().map(|host| {
            let tls = var("CC_SMTP_TLS", "starttls");
            let default_port = match tls.trim().to_ascii_lowercase().as_str() {
                "tls" => 465,
                "starttls" => 587,
                _ => 25,
            };
            SmtpConfig {
                host,
                port: var("CC_SMTP_PORT", &default_port.to_string())
                    .parse()
                    .unwrap_or(default_port),
                tls,
                from: var("CC_SMTP_FROM", "alerts@localhost"),
                username: env::var("CC_SMTP_USER").ok(),
                password: env::var("CC_SMTP_PASSWORD").ok(),
            }
        });
        Config {
            role: var("CC_ROLE", "all"),
            http_addr: var("CC_HTTP_ADDR", "0.0.0.0:8080"),
            api_keys: env::var("CC_API_KEYS").ok(),
            dev_insecure_no_auth: flag("CC_DEV_INSECURE_NO_AUTH"),
            allow_private_webhooks: flag("CC_ALLOW_PRIVATE_WEBHOOKS"),
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
            dev_insecure_ch_default_user: flag("CC_DEV_INSECURE_CH_DEFAULT_USER"),
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
            slo_ingest_delay_secs: var("CC_SLO_INGEST_DELAY_SECS", "10")
                .parse()
                .ok()
                .filter(|&n| n <= 60)
                .unwrap_or(10),
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

    /// Whether this config would run tenant-authored rule SQL as ClickHouse's `default`
    /// user, the case the hardening guide calls the worst one.
    ///
    /// `sqlguard` only checks statement *shape*; a valid `SELECT` can still reach
    /// `url(...)`/`remote(...)` or read `system.*`, so the ClickHouse user's privileges are
    /// the actual boundary (see `docs/how-to/harden-clickhouse-access.md`). Only the
    /// `shared` + `default` pair is detectable here: `derived`/`map` resolve a user per
    /// tenant, and a `shared` user that is not `default` is the configuration the guide
    /// asks for, whatever its grants turn out to be.
    pub fn unhardened_ch_user(&self) -> bool {
        self.ch_auth_mode.trim() == "shared" && self.ch_user.trim() == "default"
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
    fn slo_ingest_delay_defaults_and_clamps() {
        // Env-based; this is the only test touching CC_SLO_INGEST_DELAY_SECS.
        env::remove_var("CC_SLO_INGEST_DELAY_SECS");
        assert_eq!(Config::from_env().slo_ingest_delay_secs, 10);
        env::set_var("CC_SLO_INGEST_DELAY_SECS", "0");
        assert_eq!(Config::from_env().slo_ingest_delay_secs, 0, "0 is valid");
        env::set_var("CC_SLO_INGEST_DELAY_SECS", "61");
        assert_eq!(
            Config::from_env().slo_ingest_delay_secs,
            10,
            "over the 60s cap falls back to the default"
        );
        env::set_var("CC_SLO_INGEST_DELAY_SECS", "30");
        assert_eq!(Config::from_env().slo_ingest_delay_secs, 30);
        env::remove_var("CC_SLO_INGEST_DELAY_SECS");
    }

    #[test]
    fn unhardened_ch_user_flags_only_shared_default() {
        let mut c = Config::from_env();
        c.ch_auth_mode = "shared".into();
        c.ch_user = "default".into();
        assert!(c.unhardened_ch_user());

        c.ch_user = "cc_rules".into();
        assert!(!c.unhardened_ch_user());

        // Per-tenant modes resolve their user elsewhere, so `ch_user` says nothing.
        c.ch_auth_mode = "derived".into();
        c.ch_user = "default".into();
        assert!(!c.unhardened_ch_user());
        c.ch_auth_mode = "map".into();
        assert!(!c.unhardened_ch_user());
    }

    #[test]
    fn ch_default_user_opt_in_is_off_unless_set() {
        env::remove_var("CC_DEV_INSECURE_CH_DEFAULT_USER");
        assert!(!Config::from_env().dev_insecure_ch_default_user);
        env::set_var("CC_DEV_INSECURE_CH_DEFAULT_USER", "1");
        assert!(Config::from_env().dev_insecure_ch_default_user);
        env::remove_var("CC_DEV_INSECURE_CH_DEFAULT_USER");
    }
}
