use std::io::{self, IsTerminal};

use anyhow::{Context, Result};
use serde_json::Value;

use crate::cli::{LocalArgs, LocalSubcommand, TelemetryFormat, TelemetryQueryArgs};
use crate::command_telemetry;
use crate::telemetry::client::{QueryClient, Rows};
use crate::telemetry::collector;
use crate::telemetry::local_instance::LocalStatus;

const COLLECTOR_UNAVAILABLE_MESSAGE: &str =
    "telemetry collector isn't running — run `everr local start`";
const LOCALHOST_NETWORK_BLOCKED_MESSAGE: &str = "can't reach the telemetry collector because local network access is blocked for this process — allow access to 127.0.0.1 or run the query outside the sandbox";

pub async fn run(args: LocalArgs, lifetime: &mut super::SupervisorLifetime) -> Result<()> {
    match args.command {
        LocalSubcommand::Start(start) => collector::run_start(start, lifetime).await,
        LocalSubcommand::Stop => super::local_lifecycle::stop().await,
        LocalSubcommand::Query(q) => run_query(q).await,
        LocalSubcommand::Status => run_status().await,
        LocalSubcommand::Ui => run_ui().await,
    }
}

async fn run_status() -> Result<()> {
    let status = LocalStatus::inspect().await;
    if status.running_instance().is_some() {
        status.print();
        Ok(())
    } else {
        report_unavailable(&status);
    }
}

async fn run_ui() -> Result<()> {
    let status = LocalStatus::inspect().await;
    let origin = crate::build::local_ui_origin();
    if open_ui(&status, &origin, webbrowser::open)? {
        println!("ui: {origin}");
        Ok(())
    } else {
        report_unavailable(&status);
    }
}

fn open_ui(
    status: &LocalStatus,
    origin: &str,
    open_browser: impl FnOnce(&str) -> io::Result<()>,
) -> Result<bool> {
    if status.running_instance().is_none() {
        return Ok(false);
    }
    open_browser(origin).with_context(|| {
        format!("Could not open the local UI. Open this URL manually: {origin}")
    })?;
    Ok(true)
}

fn report_unavailable(status: &LocalStatus) -> ! {
    status.print();
    if status.stopped() {
        eprintln!("Everr isn't running - run `everr local start`");
    }
    command_telemetry::exit(2);
}

async fn run_query(args: TelemetryQueryArgs) -> Result<()> {
    let client = QueryClient::new(crate::build::sql_http_origin());
    let rows = match client.query(&args.sql, &Default::default()).await {
        Ok(rows) => rows,
        Err(err) => {
            if is_connect_error(&err) {
                eprintln!("{}", connection_failure_message(&err));
                command_telemetry::exit(2);
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

fn connection_failure_message(err: &anyhow::Error) -> &'static str {
    if crate::collector::error_chain_contains_permission_denied(err.as_ref()) {
        return LOCALHOST_NETWORK_BLOCKED_MESSAGE;
    }

    COLLECTOR_UNAVAILABLE_MESSAGE
}

pub(crate) fn render(rows: &Rows, format: TelemetryFormat) {
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

#[cfg(test)]
mod tests {
    use anyhow::anyhow;

    use super::{connection_failure_message, open_ui};
    use crate::telemetry::local_instance::{Identity, LocalStatus, ServiceState};

    fn running(service: &str, instance: &str) -> ServiceState {
        ServiceState::Running(Identity {
            service: service.into(),
            version: "0.10.0".into(),
            instance_id: instance.into(),
            protocol_version: 1,
            status: "ok".into(),
        })
    }

    fn ready() -> LocalStatus {
        LocalStatus {
            collector: running("everr-local-collector", "one"),
            ui: running("everr-local-ui", "one"),
        }
    }

    #[test]
    fn opens_ready_ui_once_at_the_configured_origin() {
        let origin = "http://127.0.0.1:12345";
        let mut calls = Vec::new();
        assert!(
            open_ui(&ready(), origin, |url| {
                calls.push(url.to_owned());
                Ok(())
            })
            .unwrap()
        );
        assert_eq!(calls, [origin]);
    }

    #[test]
    fn unavailable_instances_do_not_open_the_browser() {
        let mut statuses = vec![
            LocalStatus {
                collector: ServiceState::Stopped,
                ui: ServiceState::Stopped,
            },
            LocalStatus {
                collector: running("everr-local-collector", "one"),
                ui: running("everr-local-ui", "two"),
            },
        ];
        for state in [
            ServiceState::Starting,
            ServiceState::Stopped,
            ServiceState::Occupied,
            ServiceState::Unreachable,
            ServiceState::NetworkBlocked,
        ] {
            statuses.push(LocalStatus {
                collector: state,
                ui: running("everr-local-ui", "one"),
            });
        }
        for state in [
            ServiceState::Starting,
            ServiceState::Stopped,
            ServiceState::Occupied,
            ServiceState::Unreachable,
            ServiceState::NetworkBlocked,
        ] {
            statuses.push(LocalStatus {
                collector: running("everr-local-collector", "one"),
                ui: state,
            });
        }
        let mut wrong_version = ready();
        if let ServiceState::Running(ui) = &mut wrong_version.ui {
            ui.version = "0.9.0".into();
        }
        statuses.push(wrong_version);
        for status in statuses {
            assert!(
                !open_ui(&status, "http://127.0.0.1:12345", |_| {
                    panic!("browser opened for unavailable instance");
                })
                .unwrap()
            );
        }
    }

    #[test]
    fn browser_failure_includes_the_manual_url_and_cause() {
        let error = open_ui(&ready(), "http://127.0.0.1:12345", |_| {
            Err(std::io::Error::other("no browser available"))
        })
        .unwrap_err();
        let message = format!("{error:#}");
        assert!(message.contains("Open this URL manually: http://127.0.0.1:12345"));
        assert!(message.contains("no browser available"));
    }

    #[test]
    fn permission_denied_connection_mentions_sandbox_network_access() {
        let err = anyhow!(std::io::Error::from(std::io::ErrorKind::PermissionDenied));

        assert!(connection_failure_message(&err).contains("network access is blocked"));
    }
}
