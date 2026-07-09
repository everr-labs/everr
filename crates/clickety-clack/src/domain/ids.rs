use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidTenantId;

impl std::fmt::Display for InvalidTenantId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("invalid tenant id: must match ^[A-Za-z0-9_.-]{1,64}$")
    }
}
impl std::error::Error for InvalidTenantId {}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TenantId(String);

impl TenantId {
    /// Parse + validate untrusted input (e.g. the X-CC-Tenant header). Accepts
    /// `^[A-Za-z0-9_.-]{1,64}$` — safe interpolated into a ClickHouse username, a
    /// Redis key, or hashed for grouping.
    pub fn parse(s: &str) -> Result<Self, InvalidTenantId> {
        let ok = (1..=64).contains(&s.len())
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
        if ok {
            Ok(TenantId(s.to_string()))
        } else {
            Err(InvalidTenantId)
        }
    }

    /// Wrap a value already validated on write / read from trusted storage.
    pub fn from_trusted(s: impl Into<String>) -> Self {
        TenantId(s.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for TenantId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RuleId(pub Uuid);

/// Stable identity for an alert instance: hash of rule id + sorted label set.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct InstanceKey(pub String);

impl InstanceKey {
    /// Deterministic across processes: sort labels, hash rule_id + k=v pairs.
    pub fn new(rule_id: RuleId, labels: &BTreeMap<String, String>) -> Self {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(rule_id.0.as_bytes());
        for (k, v) in labels {
            hasher.update(b"\x00");
            hasher.update(k.as_bytes());
            hasher.update(b"\x01");
            hasher.update(v.as_bytes());
        }
        InstanceKey(hex::encode(hasher.finalize()))
    }

    /// Reserved, deterministic per-rule key for rule-health events. Uses a `__cc_`-prefixed
    /// label name the SQL label path cannot produce, so it never collides with a data instance.
    pub fn health(rule_id: RuleId) -> Self {
        let mut m = std::collections::BTreeMap::new();
        m.insert("__cc_health".to_string(), "1".to_string());
        InstanceKey::new(rule_id, &m)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rid() -> RuleId {
        RuleId(Uuid::nil())
    }

    #[test]
    fn instance_key_is_order_independent() {
        let mut a = BTreeMap::new();
        a.insert("service".to_string(), "api".to_string());
        a.insert("host".to_string(), "h1".to_string());
        let mut b = BTreeMap::new();
        b.insert("host".to_string(), "h1".to_string());
        b.insert("service".to_string(), "api".to_string());
        assert_eq!(InstanceKey::new(rid(), &a), InstanceKey::new(rid(), &b));
    }

    #[test]
    fn instance_key_differs_on_values() {
        let mut a = BTreeMap::new();
        a.insert("service".to_string(), "api".to_string());
        let mut b = BTreeMap::new();
        b.insert("service".to_string(), "web".to_string());
        assert_ne!(InstanceKey::new(rid(), &a), InstanceKey::new(rid(), &b));
    }

    #[test]
    fn health_key_is_deterministic_and_distinct() {
        use uuid::Uuid;
        let rule = RuleId(Uuid::nil());
        assert_eq!(InstanceKey::health(rule), InstanceKey::health(rule));
        assert_ne!(
            InstanceKey::health(rule),
            InstanceKey::new(rule, &std::collections::BTreeMap::new())
        );
    }

    #[test]
    fn tenant_parse_accepts_valid() {
        assert!(TenantId::parse("org42").is_ok());
        assert!(TenantId::parse("00000000-0000-0000-0000-000000000000").is_ok());
        assert!(TenantId::parse("a_b.c-D9").is_ok());
        assert!(TenantId::parse(&"x".repeat(64)).is_ok());
    }

    #[test]
    fn tenant_parse_rejects_invalid() {
        assert_eq!(TenantId::parse(""), Err(InvalidTenantId));
        assert_eq!(TenantId::parse(&"x".repeat(65)), Err(InvalidTenantId));
        for bad in [
            "has space",
            "quote'",
            "semi;colon",
            "slash/x",
            "café",
            "a\nb",
        ] {
            assert_eq!(TenantId::parse(bad), Err(InvalidTenantId), "{bad:?}");
        }
    }
}
