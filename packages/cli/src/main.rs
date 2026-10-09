use anyhow::Result;
use clap::Parser;
use everr_cli::{cli::Cli, command_telemetry, run_command, telemetry, update_notice};
use tracing::Instrument;

#[tokio::main]
async fn main() -> Result<()> {
    let mut supervisor = telemetry::SupervisorLifetime::default();
    let log_capture = telemetry::LocalLogCapture::start()?;
    let argv: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let cli = Cli::parse_from(argv.clone());
    let telemetry = command_telemetry::init();
    let (command, subcommand) = command_telemetry::command_names(&cli);

    // Run the whole command inside the root span so every API client HTTP call
    // is a child of it and the injected trace context stitches the trace across
    // the CLI → server → ClickHouse boundary.
    let span = command_telemetry::command_span(command, subcommand);
    let lifetime = &mut supervisor;
    let result = async move {
        command_telemetry::record_invocation(&cli, argv);
        update_notice::maybe_print(&cli).await;
        let result = run_command(cli.command, lifetime).await;
        command_telemetry::record_result(command, subcommand, &result);
        result
    }
    .instrument(span)
    .await;

    telemetry.shutdown();

    if log_capture.is_some() {
        if let Err(error) = &result {
            eprintln!("Error: {error:#}");
        }
    }
    drop(log_capture);
    drop(supervisor);

    result
}
