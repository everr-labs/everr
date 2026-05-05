use std::io::{self, IsTerminal};

use anyhow::{Context, Result};
use serde_json::Value;

use crate::cli::{TelemetryArgs, TelemetryFormat, TelemetryQueryArgs, TelemetrySubcommand};
use crate::telemetry::client::{QueryClient, Rows};
use crate::telemetry::collector;
use crate::telemetry::sibling;

pub async fn run(args: TelemetryArgs) -> Result<()> {
    match args.command {
        TelemetrySubcommand::Start(start) => collector::run_start(start).await,
        TelemetrySubcommand::Query(q) => tokio::task::spawn_blocking(move || run_query(q))
            .await
            .context("telemetry query task failed")?,
        TelemetrySubcommand::Status => run_status().await,
        TelemetrySubcommand::Endpoint => run_endpoint(),
    }
}

async fn run_status() -> Result<()> {
    let health_endpoint = format!(
        "{}/",
        everr_core::build::healthcheck_origin().trim_end_matches('/')
    );
    let running = everr_core::collector::wait_healthcheck(
        &health_endpoint,
        std::time::Duration::from_secs(1),
    )
    .await;

    if running {
        println!("collector: running");
        println!("otlp: {}", everr_core::build::otlp_http_origin());
        println!("sql: {}", everr_core::build::sql_http_origin());
        return Ok(());
    }

    println!("collector: stopped");
    eprintln!(
        "telemetry collector isn't running - run `everr telemetry start` or open Everr Desktop"
    );
    std::process::exit(2);
}

fn run_endpoint() -> Result<()> {
    println!("{}", everr_core::build::otlp_http_origin());
    Ok(())
}

fn run_query(args: TelemetryQueryArgs) -> Result<()> {
    sibling::maybe_emit_banner();

    let client = QueryClient::new(everr_core::build::sql_http_origin());
    let rows = match client.query(&args.sql) {
        Ok(rows) => rows,
        Err(err) => {
            if is_connect_error(&err) {
                eprintln!(
                    "telemetry collector isn't running — run `everr telemetry start` or open Everr Desktop"
                );
                std::process::exit(2);
            }
            return Err(err).context("query failed");
        }
    };

    let format = args.format.unwrap_or_else(|| {
        if io::stdout().is_terminal() {
            TelemetryFormat::Table
        } else {
            TelemetryFormat::Ndjson
        }
    });
    render(&rows, format);
    Ok(())
}

fn is_connect_error(err: &anyhow::Error) -> bool {
    err.chain().any(|cause| {
        cause
            .downcast_ref::<reqwest::Error>()
            .map(|source| source.is_connect())
            .unwrap_or(false)
    })
}

fn render(rows: &Rows, format: TelemetryFormat) {
    match format {
        TelemetryFormat::Ndjson => {
            for row in &rows.values {
                println!("{}", serde_json::to_string(row).unwrap());
            }
        }
        TelemetryFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&rows.values).unwrap());
        }
        TelemetryFormat::Table => render_table(rows),
    }
}

fn render_table(rows: &Rows) {
    let Some(first) = rows.values.first() else {
        println!("(no rows)");
        return;
    };
    let Some(object) = first.as_object() else {
        println!("(rows are not objects)");
        return;
    };

    let cols: Vec<&str> = object.keys().map(String::as_str).collect();
    println!("{}", cols.join(" | "));
    for row in &rows.values {
        let cells: Vec<String> = cols
            .iter()
            .map(|key| row.get(*key).map(value_to_cell).unwrap_or_default())
            .collect();
        println!("{}", cells.join(" | "));
    }
}

fn value_to_cell(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        _ => value.to_string(),
    }
}
