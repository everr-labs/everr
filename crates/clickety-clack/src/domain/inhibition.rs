use crate::domain::ids::TenantId;
use crate::domain::routing::Matcher;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Suppress a target alert while a matching higher-priority source alert is firing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InhibitionRule {
    pub id: Uuid,
    pub tenant: TenantId,
    pub source_matchers: Vec<Matcher>,
    pub target_matchers: Vec<Matcher>,
    /// Label names that must hold equal values between source and target.
    #[serde(default)]
    pub equal: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}
