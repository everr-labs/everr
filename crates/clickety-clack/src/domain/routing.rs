use crate::domain::ids::TenantId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Label match operator. `regex`/`notregex` are anchored (full-string) at match time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchOp {
    Eq,
    Ne,
    Regex,
    NotRegex,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Matcher {
    pub label: String,
    pub op: MatchOp,
    pub value: String,
}

/// One node in the (flat, ordered) routing list. Routes are evaluated by ascending
/// `priority` then creation order; `continue == true` keeps matching subsequent routes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Route {
    pub id: Uuid,
    pub tenant: TenantId,
    pub matchers: Vec<Matcher>,
    pub receiver: String,
    #[serde(rename = "continue", default)]
    pub continue_matching: bool,
    #[serde(default)]
    pub priority: i32,
    /// Label names to group active alerts by. `None` → dispatcher default `["rule","severity"]`.
    #[serde(default)]
    pub group_by: Option<Vec<String>>,
    /// Seconds to hold a new group before its first flush. `None` → default 10.
    #[serde(default)]
    pub group_wait_secs: Option<u32>,
    /// Minimum seconds between successive flushes of an existing group. `None` → default 300.
    #[serde(default)]
    pub group_interval_secs: Option<u32>,
    /// Seconds after which a group with still-firing alerts is re-notified.
    /// `None` → never re-notify (the historical behavior). The API enforces a
    /// minimum of 60 when set.
    #[serde(default)]
    pub repeat_interval_secs: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matchop_serializes_lowercase() {
        assert_eq!(serde_json::to_value(MatchOp::NotRegex).unwrap(), "notregex");
        assert_eq!(serde_json::to_value(MatchOp::Eq).unwrap(), "eq");
    }

    // Older payloads default to never repeating notifications.
    #[test]
    fn route_without_repeat_interval_deserializes_to_none() {
        let json = serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000000",
            "tenant": "00000000-0000-0000-0000-000000000000",
            "matchers": [],
            "receiver": "ops",
            "continue": true,
            "priority": 5,
            "group_by": ["rule"],
            "group_wait_secs": 1,
            "group_interval_secs": 2
        });
        let r: Route = serde_json::from_value(json).unwrap();
        assert_eq!(r.repeat_interval_secs, None);
        assert_eq!(r.group_interval_secs, Some(2));
    }

    #[test]
    fn route_uses_continue_json_key() {
        let r = Route {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            matchers: vec![Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            receiver: "pd".into(),
            continue_matching: true,
            priority: 0,
            group_by: None,
            group_wait_secs: None,
            group_interval_secs: None,
            repeat_interval_secs: Some(120),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["continue"], true);
        let back: Route = serde_json::from_value(v).unwrap();
        assert_eq!(back, r);
    }
}
