//! Shared identity-field validation for rules and SLOs.

use crate::api::error::ApiError;

/// Names are 1 to 128 chars of [A-Za-z0-9_./-]. The `/` admits the
/// "project/slug" convention consumers encode into names.
pub(crate) fn validate_name(name: &str) -> Result<(), ApiError> {
    let ok = (1..=128).contains(&name.len())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-' | '/'));
    if ok {
        Ok(())
    } else {
        Err(ApiError::Validation(
            "name must be 1-128 chars of [A-Za-z0-9_./-]".into(),
        ))
    }
}

/// Namespaces are '' (live) or 1 to 128 chars of [A-Za-z0-9_.-].
pub(crate) fn validate_namespace(ns: &str) -> Result<(), ApiError> {
    let ok = ns.len() <= 128
        && ns
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    if ok {
        Ok(())
    } else {
        Err(ApiError::Validation(
            "namespace must be at most 128 chars of [A-Za-z0-9_.-]".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_accepts_project_slash_slug() {
        assert!(validate_name("default/api-errors").is_ok());
        assert!(validate_name("payments/checkout.latency").is_ok());
    }

    #[test]
    fn name_rejects_empty_and_bad_chars() {
        assert!(validate_name("").is_err());
        assert!(validate_name("has space").is_err());
        assert!(validate_name(&"x".repeat(129)).is_err());
    }

    #[test]
    fn namespace_accepts_empty_and_ids() {
        assert!(validate_namespace("").is_ok());
        assert!(validate_namespace("pv-01hzy3").is_ok());
        assert!(validate_namespace("with/slash").is_err());
    }
}
