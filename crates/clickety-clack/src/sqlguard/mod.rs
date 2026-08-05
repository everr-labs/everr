use sqlparser::ast::Statement;
use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum GuardError {
    #[error("rule SQL must parse: {0}")]
    Parse(String),
    #[error("rule SQL must be a single statement")]
    NotSingle,
    #[error("rule SQL must be a read-only SELECT")]
    NotSelect,
    #[error("rule SQL must not carry a SETTINGS clause")]
    HasSettings,
}

/// Validate that `sql` is exactly one read-only SELECT statement carrying no settings.
pub fn validate(sql: &str) -> Result<(), GuardError> {
    let dialect = ClickHouseDialect {};
    let stmts = Parser::parse_sql(&dialect, sql).map_err(|e| GuardError::Parse(e.to_string()))?;
    if stmts.len() != 1 {
        return Err(GuardError::NotSingle);
    }
    match &stmts[0] {
        // A query-level `SETTINGS` clause outranks the settings we put on the URL, so a
        // rule could raise its own ceilings (`SETTINGS max_rows_to_read=0`) back off. In
        // `server_enforced_limits` mode we deliberately don't send `readonly=1`, so
        // ClickHouse would accept the override; reject the clause instead of relying on
        // which of the two layers happens to win.
        Statement::Query(q) if q.settings.is_some() => Err(GuardError::HasSettings),
        Statement::Query(_) => Ok(()),
        _ => Err(GuardError::NotSelect),
    }
}

/// Cost caps applied to every rule and SLO query.
///
/// The result caps bound what the evaluator buffers in memory (`ChClient` reads the whole
/// response body before parsing): a sane rule/SLO query returns bounded aggregates, so
/// 100k rows / 20MB is far past legitimate use. `result_overflow_mode=throw` (also the
/// server default) fails the query loudly instead of silently truncating groups, which
/// would suppress alerts.
const COST_LIMITS: [(&str, &str); 6] = [
    ("max_execution_time", "10"),
    ("max_rows_to_read", "50000000"),
    ("max_memory_usage", "2000000000"),
    ("max_result_rows", "100000"),
    ("max_result_bytes", "20000000"),
    ("result_overflow_mode", "throw"),
];

/// [`COST_LIMITS`] plus `readonly=1`, as `(name, value)` pairs for the query string.
///
/// These have to travel in the URL. ClickHouse has no settings header: an
/// `X-ClickHouse-Settings` header is accepted by the HTTP layer and ignored, which leaves
/// every cap here (and `readonly`) unenforced while looking enforced from the client side.
pub fn resource_limit_settings() -> &'static [(&'static str, &'static str)] {
    &[
        ("max_execution_time", "10"),
        ("max_rows_to_read", "50000000"),
        ("max_memory_usage", "2000000000"),
        ("max_result_rows", "100000"),
        ("max_result_bytes", "20000000"),
        ("result_overflow_mode", "throw"),
        ("readonly", "1"),
    ]
}

/// Same cost caps as [`resource_limit_settings`] but without `readonly=1`, for CH users
/// whose profile already pins readonly (sending it again errors "Cannot modify setting in
/// readonly mode").
pub fn resource_limit_settings_no_readonly() -> &'static [(&'static str, &'static str)] {
    &COST_LIMITS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_select() {
        assert!(validate("SELECT service, count() AS n FROM spans GROUP BY service").is_ok());
    }

    #[test]
    fn rejects_insert() {
        assert_eq!(
            validate("INSERT INTO spans VALUES (1)"),
            Err(GuardError::NotSelect)
        );
    }

    #[test]
    fn rejects_drop() {
        assert_eq!(validate("DROP TABLE spans"), Err(GuardError::NotSelect));
    }

    #[test]
    fn rejects_multiple_statements() {
        assert_eq!(validate("SELECT 1; SELECT 2"), Err(GuardError::NotSingle));
    }

    #[test]
    fn rejects_a_query_level_settings_clause() {
        assert_eq!(
            validate("SELECT count() FROM t SETTINGS max_rows_to_read=0"),
            Err(GuardError::HasSettings)
        );
    }

    #[test]
    fn no_readonly_settings_drop_readonly_only() {
        let full = resource_limit_settings();
        let no_ro = resource_limit_settings_no_readonly();
        assert!(!no_ro.iter().any(|(k, _)| *k == "readonly"));
        assert_eq!(full.iter().filter(|(k, _)| *k == "readonly").count(), 1);
        // The two sets must not drift apart: readonly is the only difference.
        let full_without_ro: Vec<_> = full.iter().filter(|(k, _)| *k != "readonly").collect();
        assert_eq!(full_without_ro, no_ro.iter().collect::<Vec<_>>());
    }

    #[test]
    fn both_settings_cap_result_size_and_throw_on_overflow() {
        for s in [
            resource_limit_settings(),
            resource_limit_settings_no_readonly(),
        ] {
            let get = |k: &str| s.iter().find(|(n, _)| *n == k).map(|(_, v)| *v);
            assert_eq!(get("max_result_rows"), Some("100000"));
            assert_eq!(get("max_result_bytes"), Some("20000000"));
            assert_eq!(get("result_overflow_mode"), Some("throw"));
        }
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(
            validate("not sql at all !!"),
            Err(GuardError::Parse(_))
        ));
    }
}
