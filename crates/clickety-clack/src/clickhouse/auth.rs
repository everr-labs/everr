use crate::domain::ids::TenantId;

/// Per-request ClickHouse auth context.
pub struct ChAuth {
    pub user: String,
    pub key: String,
    /// Reserved for future RLS-via-setting providers; empty for shared/derived/map.
    pub extra_settings: Vec<(String, String)>,
    pub quota: Option<String>,
    /// True ⇒ the CH user/profile already pins readonly + caps, so the client omits
    /// its own `readonly=1` (avoids "Cannot modify setting in readonly mode").
    pub server_enforced_limits: bool,
}

/// What distinguishes two queries' result sets for coalescing: the auth user plus any
/// sorted extra settings. Equal identity ⇒ safe to share one ClickHouse round-trip.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct AuthIdentity {
    pub user: String,
    pub settings: Vec<(String, String)>,
}

/// Resolves the ClickHouse auth context for one tenant's query.
pub trait ChAuthProvider: Send + Sync {
    fn resolve(&self, tenant: &TenantId) -> ChAuth;

    /// Coalescing key derived from `resolve`. Default impl is correct for all providers.
    fn auth_identity_of(&self, tenant: &TenantId) -> AuthIdentity {
        let a = self.resolve(tenant);
        let mut settings = a.extra_settings;
        settings.sort();
        AuthIdentity {
            user: a.user,
            settings,
        }
    }
}

/// Single shared user — reproduces the pre-feature behavior exactly.
pub struct SharedAuth {
    pub user: String,
    pub password: String,
}

impl ChAuthProvider for SharedAuth {
    fn resolve(&self, _tenant: &TenantId) -> ChAuth {
        ChAuth {
            user: self.user.clone(),
            key: self.password.clone(),
            extra_settings: Vec::new(),
            quota: None,
            server_enforced_limits: false,
        }
    }
}

use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ChAuthError {
    #[error("clickhouse auth config: {0}")]
    Config(String),
}

/// HMAC-SHA256(master_key, tenant) as lowercase hex, with `suffix` appended.
pub(crate) fn derive_password(master_key: &[u8], tenant: &str, suffix: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = <Hmac<Sha256>>::new_from_slice(master_key).expect("HMAC accepts any key length");
    mac.update(tenant.as_bytes());
    let digest = mac.finalize().into_bytes();
    format!("{}{}", hex::encode(digest), suffix)
}

/// Test-only accessor for the password derivation (keeps `derive_password` crate-private).
#[doc(hidden)]
pub fn derived_password_for_test(master_key: &[u8], tenant: &str, suffix: &str) -> String {
    derive_password(master_key, tenant, suffix)
}

/// Per-tenant credentials derived from a shared master key (everr-compatible).
pub struct DerivedAuth {
    pub user_template: String,
    pub master_key: Vec<u8>,
    pub suffix: String,
}

impl ChAuthProvider for DerivedAuth {
    fn resolve(&self, tenant: &TenantId) -> ChAuth {
        let user = self.user_template.replace("{tenant}", tenant.as_str());
        let key = derive_password(&self.master_key, tenant.as_str(), &self.suffix);
        ChAuth {
            user: user.clone(),
            key,
            extra_settings: Vec::new(),
            quota: Some(user),
            server_enforced_limits: true,
        }
    }
}

#[derive(serde::Deserialize)]
pub(crate) struct MapEntry {
    user: String,
    password: String,
}

/// Explicit tenant → credential map.
pub struct MapAuth {
    entries: HashMap<String, MapEntry>,
}

impl ChAuthProvider for MapAuth {
    fn resolve(&self, tenant: &TenantId) -> ChAuth {
        match self.entries.get(tenant.as_str()) {
            Some(e) => ChAuth {
                user: e.user.clone(),
                key: e.password.clone(),
                extra_settings: Vec::new(),
                quota: Some(e.user.clone()),
                server_enforced_limits: true,
            },
            // Unknown tenant ⇒ deliberately invalid creds; the query fails with an auth
            // error (surfaced as an eval error). A rule-create preflight (future) catches
            // it earlier.
            None => ChAuth {
                user: String::new(),
                key: String::new(),
                extra_settings: Vec::new(),
                quota: None,
                server_enforced_limits: true,
            },
        }
    }
}

/// Build the auth provider from config, failing closed on misconfiguration. Built before
/// any role logic so a broken config is a loud startup error, mirroring `build_cipher`.
pub fn build_ch_auth(
    mode: &str,
    ch_user: &str,
    ch_password: &str,
    user_template: Option<&str>,
    master_key: Option<&str>,
    password_suffix: &str,
    tenant_map: Option<&str>,
) -> Result<Arc<dyn ChAuthProvider>, ChAuthError> {
    match mode {
        "shared" => Ok(Arc::new(SharedAuth {
            user: ch_user.to_string(),
            password: ch_password.to_string(),
        })),
        "derived" => {
            let template = user_template.filter(|s| !s.is_empty()).ok_or_else(|| {
                ChAuthError::Config("CC_CH_USER_TEMPLATE required for derived mode".into())
            })?;
            let key = master_key.filter(|s| !s.is_empty()).ok_or_else(|| {
                ChAuthError::Config("CC_CH_MASTER_KEY required for derived mode".into())
            })?;
            Ok(Arc::new(DerivedAuth {
                user_template: template.to_string(),
                master_key: key.as_bytes().to_vec(),
                suffix: password_suffix.to_string(),
            }))
        }
        "map" => {
            let raw = tenant_map.ok_or_else(|| {
                ChAuthError::Config("CC_CH_TENANT_MAP required for map mode".into())
            })?;
            let json = if raw.trim_start().starts_with('{') {
                raw.to_string()
            } else {
                std::fs::read_to_string(raw).map_err(|e| {
                    ChAuthError::Config(format!("reading CC_CH_TENANT_MAP file: {e}"))
                })?
            };
            let entries: HashMap<String, MapEntry> = serde_json::from_str(&json)
                .map_err(|e| ChAuthError::Config(format!("parsing CC_CH_TENANT_MAP: {e}")))?;
            if entries.is_empty() {
                return Err(ChAuthError::Config("CC_CH_TENANT_MAP is empty".into()));
            }
            Ok(Arc::new(MapAuth { entries }))
        }
        other => Err(ChAuthError::Config(format!(
            "unknown CC_CH_AUTH_MODE '{other}'"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::TenantId;

    fn t(s: &str) -> TenantId {
        TenantId::from_trusted(s)
    }

    #[test]
    fn shared_ignores_tenant_and_keeps_app_limits() {
        let p = SharedAuth {
            user: "default".into(),
            password: "pw".into(),
        };
        let a = p.resolve(&t("anything"));
        assert_eq!(a.user, "default");
        assert_eq!(a.key, "pw");
        assert!(a.quota.is_none());
        assert!(!a.server_enforced_limits);
        assert!(a.extra_settings.is_empty());
        // Same identity for any tenant ⇒ coalescing preserved.
        assert_eq!(p.auth_identity_of(&t("x")), p.auth_identity_of(&t("y")));
    }

    // RFC 4231 HMAC-SHA-256 Test Case 1: key = 0x0b*20, data = "Hi There".
    #[test]
    fn derive_password_matches_rfc4231_vector() {
        let key = [0x0bu8; 20];
        let got = derive_password(&key, "Hi There", "");
        assert_eq!(
            got,
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn derived_templates_user_and_suffixes_password() {
        let p = DerivedAuth {
            user_template: "sql_api_org_{tenant}".into(),
            master_key: b"masterkey".to_vec(),
            suffix: "A!".into(),
        };
        let a = p.resolve(&t("org42"));
        assert_eq!(a.user, "sql_api_org_org42");
        assert!(a.key.ends_with("A!"));
        assert_eq!(a.quota.as_deref(), Some("sql_api_org_org42"));
        assert!(a.server_enforced_limits);
        assert_eq!(p.resolve(&t("org42")).key, p.resolve(&t("org42")).key);
        assert_ne!(p.auth_identity_of(&t("a")), p.auth_identity_of(&t("b")));
    }

    #[test]
    fn map_resolves_known_tenant() {
        let p = build_ch_auth(
            "map",
            "",
            "",
            None,
            None,
            "",
            Some(r#"{"t1":{"user":"u1","password":"p1"}}"#),
        )
        .unwrap();
        let a = p.resolve(&t("t1"));
        assert_eq!((a.user.as_str(), a.key.as_str()), ("u1", "p1"));
        assert!(a.server_enforced_limits);
    }

    #[test]
    fn factory_fails_closed() {
        assert!(build_ch_auth(
            "derived",
            "",
            "",
            Some("sql_api_org_{tenant}"),
            None,
            "",
            None
        )
        .is_err());
        assert!(build_ch_auth("derived", "", "", None, Some("k"), "", None).is_err());
        assert!(build_ch_auth("map", "", "", None, None, "", Some("{}")).is_err());
        assert!(build_ch_auth("map", "", "", None, None, "", None).is_err());
        assert!(build_ch_auth("bogus", "", "", None, None, "", None).is_err());
        assert!(build_ch_auth("shared", "default", "", None, None, "", None).is_ok());
    }
}
