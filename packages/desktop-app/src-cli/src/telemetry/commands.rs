use std::io::{self, IsTerminal};

use anyhow::{Context, Result};
use serde_json::Value;

use crate::cli::{LocalArgs, LocalSubcommand, TelemetryFormat, TelemetryQueryArgs};
use crate::command_telemetry;
use crate::telemetry::client::{QueryClient, Rows};
use crate::telemetry::collector;

const COLLECTOR_UNAVAILABLE_MESSAGE: &str =
    "telemetry collector isn't running — run `everr local start` or open Everr Desktop";
const LOCALHOST_NETWORK_BLOCKED_MESSAGE: &str = "can't reach the telemetry collector because local network access is blocked for this process — allow access to 127.0.0.1 or run the query outside the sandbox";

pub async fn run(args: LocalArgs) -> Result<()> {
    match args.command {
        LocalSubcommand::Start(start) => collector::run_start(start).await,
        LocalSubcommand::Query(q) => tokio::task::spawn_blocking(move || run_query(q))
            .await
            .context("telemetry query task failed")?,
        LocalSubcommand::Status => run_status().await,
    }
}

async fn run_status() -> Result<()> {
    let health_endpoint = format!(
        "{}/",
        everr_core::build::healthcheck_origin().trim_end_matches('/')
    );
    let status = everr_core::collector::wait_healthcheck_result(
        &health_endpoint,
        std::time::Duration::from_secs(1),
    )
    .await;

    match status {
        everr_core::collector::HealthcheckResult::Running => {
            println!("collector: running");
            println!("otlp: {}", everr_core::build::otlp_http_origin());
            println!("sql: {}", everr_core::build::sql_http_origin());
            Ok(())
        }
        everr_core::collector::HealthcheckResult::NetworkBlocked => {
            println!("collector: unreachable");
            eprintln!("{LOCALHOST_NETWORK_BLOCKED_MESSAGE}");
            command_telemetry::exit(2);
        }
        everr_core::collector::HealthcheckResult::Unavailable => {
            println!("collector: stopped");
            eprintln!(
                "telemetry collector isn't running - run `everr local start` or open Everr Desktop"
            );
            command_telemetry::exit(2);
        }
    }
}

fn run_query(args: TelemetryQueryArgs) -> Result<()> {
    let client = QueryClient::new(everr_core::build::sql_http_origin());
    let rows = match client.query(&args.sql) {
        Ok(rows) => rows,
        Err(err) => {
            if is_connect_error(&err) {
                eprintln!("{}", connection_failure_message(&err));
                command_telemetry::exit(2);
            }
            return Err(err).context("query failed");
        }
    };

    let format = default_format(args.format, io::stdout().is_terminal());
    render(&rows, format);
    Ok(())
}

/// Machine readers (agents, pipes) get compact rows; humans get a table.
pub(crate) fn default_format(
    requested: Option<TelemetryFormat>,
    stdout_is_terminal: bool,
) -> TelemetryFormat {
    requested.unwrap_or(if stdout_is_terminal {
        TelemetryFormat::Table
    } else {
        TelemetryFormat::Compact
    })
}

fn is_connect_error(err: &anyhow::Error) -> bool {
    err.chain().any(|cause| {
        cause
            .downcast_ref::<reqwest::Error>()
            .map(|source| source.is_connect())
            .unwrap_or(false)
    })
}

fn connection_failure_message(err: &anyhow::Error) -> &'static str {
    if is_permission_denied(err) {
        return LOCALHOST_NETWORK_BLOCKED_MESSAGE;
    }

    COLLECTOR_UNAVAILABLE_MESSAGE
}

fn is_permission_denied(err: &anyhow::Error) -> bool {
    err.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .map(|source| source.kind() == std::io::ErrorKind::PermissionDenied)
            .unwrap_or(false)
    })
}

pub(crate) fn render(rows: &Rows, format: TelemetryFormat) {
    print!("{}", render_to_string(rows, format));
}

fn render_to_string(rows: &Rows, format: TelemetryFormat) -> String {
    let mut out = String::new();
    match format {
        TelemetryFormat::Compact => render_compact(rows, &mut out),
        TelemetryFormat::Ndjson => {
            for row in &rows.values {
                out.push_str(&serde_json::to_string(row).unwrap());
                out.push('\n');
            }
        }
        TelemetryFormat::Json => {
            out.push_str(&serde_json::to_string_pretty(&rows.values).unwrap());
            out.push('\n');
        }
        TelemetryFormat::Table => render_table(rows, &mut out),
    }
    out
}

/// JSONCompactEachRowWithNames: a column-name array, then one value array per
/// row. Columns come from the first row, which keeps the SELECT order thanks to
/// serde_json's preserve_order feature.
fn render_compact(rows: &Rows, out: &mut String) {
    let Some(cols) = column_names(rows) else {
        return;
    };
    out.push_str(&serde_json::to_string(&cols).unwrap());
    out.push('\n');
    for row in &rows.values {
        let cells: Vec<&Value> = cols
            .iter()
            .map(|key| row.get(*key).unwrap_or(&Value::Null))
            .collect();
        out.push_str(&serde_json::to_string(&cells).unwrap());
        out.push('\n');
    }
}

fn column_names(rows: &Rows) -> Option<Vec<&str>> {
    let object = rows.values.first()?.as_object()?;
    Some(object.keys().map(String::as_str).collect())
}

fn render_table(rows: &Rows, out: &mut String) {
    if rows.values.is_empty() {
        out.push_str("(no rows)\n");
        return;
    }
    let Some(cols) = column_names(rows) else {
        out.push_str("(rows are not objects)\n");
        return;
    };

    out.push_str(&cols.join(" | "));
    out.push('\n');
    for row in &rows.values {
        let cells: Vec<String> = cols
            .iter()
            .map(|key| row.get(*key).map(value_to_cell).unwrap_or_default())
            .collect();
        out.push_str(&cells.join(" | "));
        out.push('\n');
    }
}

fn value_to_cell(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        _ => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use anyhow::anyhow;
    use serde_json::json;

    use super::{connection_failure_message, default_format, render_to_string};
    use crate::cli::TelemetryFormat;
    use crate::telemetry::client::Rows;

    #[test]
    fn compact_prints_header_then_one_array_per_row_keeping_types() {
        let rows = Rows {
            values: vec![
                json!({"n": 1657, "svc": "app", "avg_ms": 1.2, "attrs": {"k": "v"}, "gone": null}),
                json!({"n": 3, "svc": "db", "avg_ms": 0.0, "attrs": {}, "gone": "x"}),
            ],
        };

        let out = render_to_string(&rows, TelemetryFormat::Compact);

        assert_eq!(
            out,
            "[\"n\",\"svc\",\"avg_ms\",\"attrs\",\"gone\"]\n[1657,\"app\",1.2,{\"k\":\"v\"},null]\n[3,\"db\",0.0,{},\"x\"]\n"
        );
    }

    #[test]
    fn compact_prints_nothing_for_an_empty_result() {
        let rows = Rows { values: vec![] };

        assert_eq!(render_to_string(&rows, TelemetryFormat::Compact), "");
    }

    #[test]
    fn compact_keeps_column_order_from_the_wire() {
        let rows = crate::telemetry::client::parse_ndjson("{\"z\":1,\"a\":2}\n").unwrap();

        let out = render_to_string(&rows, TelemetryFormat::Compact);

        assert_eq!(out, "[\"z\",\"a\"]\n[1,2]\n");
    }

    #[test]
    fn default_format_is_table_on_a_terminal_and_compact_otherwise() {
        assert!(matches!(default_format(None, true), TelemetryFormat::Table));
        assert!(matches!(
            default_format(None, false),
            TelemetryFormat::Compact
        ));
        assert!(matches!(
            default_format(Some(TelemetryFormat::Ndjson), true),
            TelemetryFormat::Ndjson
        ));
    }

    #[test]
    fn permission_denied_connection_mentions_sandbox_network_access() {
        let err = anyhow!(std::io::Error::from(std::io::ErrorKind::PermissionDenied));

        assert!(connection_failure_message(&err).contains("network access is blocked"));
    }
}
