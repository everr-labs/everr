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
}

/// Validate that `sql` is exactly one read-only SELECT statement.
pub fn validate(sql: &str) -> Result<(), GuardError> {
    let dialect = ClickHouseDialect {};
    let stmts = Parser::parse_sql(&dialect, sql).map_err(|e| GuardError::Parse(e.to_string()))?;
    if stmts.len() != 1 {
        return Err(GuardError::NotSingle);
    }
    match &stmts[0] {
        Statement::Query(_) => Ok(()),
        _ => Err(GuardError::NotSelect),
    }
}

/// ClickHouse settings string appended at execution to bound cost.
pub fn resource_limit_settings() -> &'static str {
    "max_execution_time=10, max_rows_to_read=50000000, max_memory_usage=2000000000, readonly=1"
}

/// Same cost caps as [`resource_limit_settings`] but without `readonly=1`, for CH users
/// whose profile already pins readonly (sending it again errors "Cannot modify setting in
/// readonly mode").
pub fn resource_limit_settings_no_readonly() -> &'static str {
    "max_execution_time=10, max_rows_to_read=50000000, max_memory_usage=2000000000"
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
    fn no_readonly_settings_drop_readonly_only() {
        let s = resource_limit_settings_no_readonly();
        assert!(s.contains("max_execution_time=10"));
        assert!(s.contains("max_memory_usage=2000000000"));
        assert!(!s.contains("readonly"));
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(
            validate("not sql at all !!"),
            Err(GuardError::Parse(_))
        ));
    }
}
