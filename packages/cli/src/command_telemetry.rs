use std::collections::BTreeSet;
use std::ffi::OsString;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::{BatchConfigBuilder, BatchLogProcessor, SdkLoggerProvider};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::internal_telemetry::{self, Config, Exporter};

use crate::cli::{
    CiSubcommand, Cli, CloudSubcommand, Commands, LocalSubcommand, ResourcesSubcommand,
    SkillsSubcommand,
};

const SERVICE_NAME: &str = "everr-cli";
const EVENT_NAME: &str = "everr.cli.command";
const RESULT_EVENT_NAME: &str = "everr.cli.command.result";
const EVENT_TARGET: &str = "everr_cli_command";
// Tracing target of the spans the CLI API client emits around its HTTP calls. Must match
// the literal used in `crate::api` so this filter captures them.
const API_TARGET: &str = "everr_api";
const SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(750);

static LOGGER_PROVIDER: OnceLock<Mutex<Option<SdkLoggerProvider>>> = OnceLock::new();
static TRACER_PROVIDER: OnceLock<Mutex<Option<SdkTracerProvider>>> = OnceLock::new();

pub struct TelemetryGuard {
    active: bool,
}

pub fn init() -> TelemetryGuard {
    init_inner().unwrap_or_else(|_| TelemetryGuard::disabled())
}

pub fn record_invocation(cli: &Cli, argv: impl IntoIterator<Item = OsString>) {
    let metadata = CommandTelemetry::from_cli_and_argv(cli, argv);
    let options = metadata.options.join(",");

    if let Some(subcommand) = metadata.subcommand {
        tracing::event!(
            target: EVENT_TARGET,
            tracing::Level::INFO,
            {
                event.name = EVENT_NAME,
                everr.cli.command = metadata.command,
                everr.cli.subcommand = subcommand,
                everr.cli.options = options.as_str(),
                os.type = operating_system(),
            },
            "everr.cli.command"
        );
    } else {
        tracing::event!(
            target: EVENT_TARGET,
            tracing::Level::INFO,
            {
                event.name = EVENT_NAME,
                everr.cli.command = metadata.command,
                everr.cli.options = options.as_str(),
                os.type = operating_system(),
            },
            "everr.cli.command"
        );
    }
}

/// The command and subcommand names as recorded in telemetry, resolvable
/// before `Cli` is consumed by the command dispatch.
pub fn command_names(cli: &Cli) -> (&'static str, Option<&'static str>) {
    let metadata = CommandTelemetry::from_cli_and_argv(cli, std::iter::empty::<OsString>());
    (metadata.command, metadata.subcommand)
}

/// Records how the command ended. Debug builds attach the full anyhow context
/// chain on failure, naming the step that broke. Release builds use a fixed
/// error message to keep customer data out of internal telemetry.
pub fn record_result(
    command: &'static str,
    subcommand: Option<&'static str>,
    result: &anyhow::Result<()>,
) {
    let subcommand = subcommand.unwrap_or_default();
    match result {
        Ok(()) => {
            tracing::event!(
                target: EVENT_TARGET,
                tracing::Level::INFO,
                {
                    event.name = RESULT_EVENT_NAME,
                    everr.cli.command = command,
                    everr.cli.subcommand = subcommand,
                    everr.cli.status = "ok",
                    os.type = operating_system(),
                },
                "everr.cli.command.result"
            );
        }
        Err(err) => {
            // Mark the active command span (see command_span) as failed so
            // failed invocations are distinguishable in traces, not just logs.
            tracing::Span::current().record("otel.status_code", "ERROR");
            let error = internal_telemetry::command_error(err);
            tracing::event!(
                target: EVENT_TARGET,
                tracing::Level::ERROR,
                {
                    event.name = RESULT_EVENT_NAME,
                    everr.cli.command = command,
                    everr.cli.subcommand = subcommand,
                    everr.cli.status = "error",
                    error.message = error.as_str(),
                    os.type = operating_system(),
                },
                "everr.cli.command.result"
            );
        }
    }
}

/// The root span for one CLI invocation. All work runs inside it (main
/// instruments `run_command` with it), so once the API client injects the trace
/// context into its HTTP calls the trace stitches CLI → server → ClickHouse.
/// Reuses the command/subcommand identity that the log events already carry.
pub fn command_span(command: &'static str, subcommand: Option<&'static str>) -> tracing::Span {
    tracing::info_span!(
        target: EVENT_TARGET,
        "everr.cli.command",
        everr.cli.command = command,
        everr.cli.subcommand = subcommand.unwrap_or_default(),
        os.type = operating_system(),
        otel.status_code = tracing::field::Empty,
    )
}

pub fn shutdown() {
    if let Some(lock) = TRACER_PROVIDER.get() {
        if let Some(provider) = lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            // The span exporter's per-request timeout (EXPORT_TIMEOUT) bounds how
            // long this can block, keeping the trace flush inside the same budget
            // as the log flush so an interactive command still exits promptly.
            let _ = provider.shutdown();
        }
    }
    if let Some(lock) = LOGGER_PROVIDER.get() {
        if let Some(provider) = lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = provider.shutdown_with_timeout(SHUTDOWN_TIMEOUT);
        }
    }
}

pub fn exit(code: i32) -> ! {
    shutdown();
    std::process::exit(code);
}

fn init_inner() -> Result<TelemetryGuard, Box<dyn std::error::Error + Send + Sync>> {
    let Some(config) = Config::from_env(internal_telemetry::Source::Cli) else {
        return Ok(TelemetryGuard::disabled());
    };
    let resource = resource();

    let span_exporter = Exporter::new(config.clone())?;
    let tracer_provider = SdkTracerProvider::builder()
        .with_resource(resource.clone())
        .with_batch_exporter(span_exporter)
        .build();
    global::set_tracer_provider(tracer_provider.clone());
    // W3C traceparent so the API client's HTTP calls carry the context to the server.
    global::set_text_map_propagator(TraceContextPropagator::new());
    let trace_layer =
        tracing_opentelemetry::layer().with_tracer(tracer_provider.tracer(SERVICE_NAME));

    let log_exporter = Exporter::new(config)?;
    let batch_processor = BatchLogProcessor::builder(log_exporter)
        .with_batch_config(
            BatchConfigBuilder::default()
                .with_max_queue_size(64)
                .with_max_export_batch_size(1)
                .build(),
        )
        .build();
    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_log_processor(batch_processor)
        .build();

    let log_layer =
        opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge::new(&logger_provider);

    tracing_subscriber::registry()
        .with(EnvFilter::new(format!(
            "{EVENT_TARGET}=info,{API_TARGET}=info"
        )))
        .with(trace_layer)
        .with(log_layer)
        .try_init()?;

    let _ = LOGGER_PROVIDER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .replace(logger_provider);
    let _ = TRACER_PROVIDER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .replace(tracer_provider);

    Ok(TelemetryGuard { active: true })
}

impl TelemetryGuard {
    fn disabled() -> Self {
        Self { active: false }
    }

    pub fn shutdown(mut self) {
        if self.active {
            shutdown();
            self.active = false;
        }
    }
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if self.active {
            shutdown();
            self.active = false;
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
struct CommandTelemetry {
    command: &'static str,
    subcommand: Option<&'static str>,
    options: Vec<String>,
}

impl CommandTelemetry {
    fn from_cli_and_argv(cli: &Cli, argv: impl IntoIterator<Item = OsString>) -> Self {
        let (command, subcommand) = match &cli.command {
            Commands::Uninstall => ("uninstall", None),
            Commands::Upgrade => ("upgrade", None),
            Commands::Cloud(args) => (
                "cloud",
                Some(match &args.command {
                    CloudSubcommand::Login(_) => "login",
                    CloudSubcommand::Logout => "logout",
                    CloudSubcommand::Status(_) => "status",
                    CloudSubcommand::Query(_) => "query",
                }),
            ),
            Commands::Ci(args) => (
                "ci",
                Some(match &args.command {
                    CiSubcommand::Status(_) => "status",
                    CiSubcommand::Watch(_) => "watch",
                    CiSubcommand::Runs(_) => "runs",
                    CiSubcommand::Show(_) => "show",
                    CiSubcommand::Logs(_) => "logs",
                }),
            ),
            Commands::Local(args) => (
                "local",
                Some(match &args.command {
                    LocalSubcommand::Start(_) => "start",
                    LocalSubcommand::Stop => "stop",
                    LocalSubcommand::Query(_) => "query",
                    LocalSubcommand::Status => "status",
                    LocalSubcommand::Ui => "ui",
                }),
            ),
            Commands::Wrap(_) => ("wrap", None),
            Commands::Skills(args) => (
                "skills",
                Some(match &args.command {
                    SkillsSubcommand::List(_) => "list",
                    SkillsSubcommand::Install(_) => "install",
                    SkillsSubcommand::Update(_) => "update",
                    SkillsSubcommand::Uninstall(_) => "uninstall",
                }),
            ),
            Commands::Apply(_) => ("apply", None),
            Commands::Resources(args) => (
                "resources",
                Some(match &args.command {
                    ResourcesSubcommand::List(_) => "list",
                    ResourcesSubcommand::Show(_) => "show",
                    ResourcesSubcommand::Delete(_) => "delete",
                    ResourcesSubcommand::Adopt(_) => "adopt",
                }),
            ),
        };

        let options = if matches!(&cli.command, Commands::Wrap(_)) {
            Vec::new()
        } else {
            option_names(argv)
        };

        Self {
            command,
            subcommand,
            options,
        }
    }
}

fn option_names(argv: impl IntoIterator<Item = OsString>) -> Vec<String> {
    let mut names = BTreeSet::new();

    for arg in argv.into_iter().skip(1) {
        let Some(arg) = arg.to_str() else {
            continue;
        };

        if arg == "--" {
            break;
        }

        if let Some(long) = arg.strip_prefix("--") {
            let name = long.split_once('=').map_or(long, |(name, _)| name);
            if !name.is_empty() {
                names.insert(name.to_string());
            }
            continue;
        }

        if let Some(short) = arg.strip_prefix('-') {
            if !short.is_empty() && short.chars().all(|flag| flag.is_ascii_alphabetic()) {
                names.extend(short.chars().map(|flag| flag.to_string()));
            }
        }
    }

    names.into_iter().collect()
}

fn resource() -> Resource {
    Resource::builder_empty()
        .with_detector(Box::new(
            opentelemetry_sdk::resource::TelemetryResourceDetector,
        ))
        .with_service_name(SERVICE_NAME)
        .with_attribute(opentelemetry::KeyValue::new(
            "service.version",
            env!("EVERR_VERSION"),
        ))
        .with_attribute(opentelemetry::KeyValue::new(
            "deployment.environment.name",
            internal_telemetry::deployment_environment(),
        ))
        .build()
}

fn operating_system() -> &'static str {
    std::env::consts::OS
}

#[cfg(test)]
mod tests {
    use clap::Parser;
    use std::ffi::OsString;

    use super::{CommandTelemetry, option_names};
    use crate::cli::Cli;
    use crate::internal_telemetry::signal_endpoint;

    #[test]
    fn internal_resource_does_not_inherit_customer_resource_attributes() {
        let _guard = crate::test_support::ENV_LOCK.lock().unwrap();
        let previous = std::env::var_os("OTEL_RESOURCE_ATTRIBUTES");
        unsafe {
            std::env::set_var(
                "OTEL_RESOURCE_ATTRIBUTES",
                "service.name=customer-app,everr.customer.data=customer-sentinel",
            );
        }
        let resource = super::resource();
        unsafe {
            match previous {
                Some(value) => std::env::set_var("OTEL_RESOURCE_ATTRIBUTES", value),
                None => std::env::remove_var("OTEL_RESOURCE_ATTRIBUTES"),
            }
        }
        assert_eq!(
            resource
                .get(&opentelemetry::Key::new("service.name"))
                .unwrap()
                .as_str(),
            "everr-cli"
        );
        assert!(
            resource
                .get(&opentelemetry::Key::new("everr.customer.data"))
                .is_none()
        );
        assert_eq!(
            resource
                .get(&opentelemetry::Key::new("telemetry.sdk.language"))
                .unwrap()
                .as_str(),
            "rust"
        );
    }

    #[test]
    fn records_local_ui_command_name() {
        let argv = ["everr", "local", "ui"].map(OsString::from);
        let cli = Cli::try_parse_from(argv.clone()).unwrap();
        let metadata = CommandTelemetry::from_cli_and_argv(&cli, argv);
        assert_eq!(metadata.command, "local");
        assert_eq!(metadata.subcommand, Some("ui"));
        assert!(metadata.options.is_empty());
    }

    #[test]
    fn records_cloud_status_command_name() {
        let argv = ["everr", "cloud", "status"].map(OsString::from);
        let cli = Cli::try_parse_from(argv.clone()).unwrap();
        let metadata = CommandTelemetry::from_cli_and_argv(&cli, argv);
        assert_eq!(metadata.command, "cloud");
        assert_eq!(metadata.subcommand, Some("status"));
        assert!(metadata.options.is_empty());
    }

    #[test]
    fn records_command_subcommand_and_option_names_without_values() {
        let argv = [
            "everr",
            "ci",
            "logs",
            "trace-secret",
            "--job-name",
            "deploy-secret",
            "--log-failed",
            "--tail=50",
            "--egrep",
            "token=.*",
        ]
        .map(OsString::from);
        let cli = Cli::try_parse_from(argv.clone()).expect("valid logs command");

        let metadata = CommandTelemetry::from_cli_and_argv(&cli, argv);

        assert_eq!(metadata.command, "ci");
        assert_eq!(metadata.subcommand, Some("logs"));
        assert_eq!(
            metadata.options,
            vec!["egrep", "job-name", "log-failed", "tail"]
        );
        assert!(
            !metadata.options.join(",").contains("deploy-secret"),
            "option values must not be recorded"
        );
    }

    #[test]
    fn stops_collecting_options_at_wrap_separator() {
        let argv = ["everr", "wrap", "--", "sh", "-c", "echo secret"].map(OsString::from);
        let cli = Cli::try_parse_from(argv.clone()).expect("valid wrap command");

        let metadata = CommandTelemetry::from_cli_and_argv(&cli, argv);

        assert_eq!(metadata.command, "wrap");
        assert_eq!(metadata.subcommand, None);
        assert_eq!(metadata.options, Vec::<String>::new());
    }

    #[test]
    fn ignores_wrapped_command_options_without_separator() {
        let argv = ["everr", "wrap", "sh", "-c", "echo secret"].map(OsString::from);
        let cli = Cli::try_parse_from(argv.clone()).expect("valid wrap command");

        let metadata = CommandTelemetry::from_cli_and_argv(&cli, argv);

        assert_eq!(metadata.command, "wrap");
        assert_eq!(metadata.options, Vec::<String>::new());
    }

    #[test]
    fn records_short_option_names() {
        assert_eq!(
            option_names(["everr", "skills", "uninstall", "-y"].map(OsString::from)),
            vec!["y"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn ignores_non_utf8_argv_tokens() {
        use std::os::unix::ffi::OsStringExt;

        let options = option_names(vec![
            OsString::from("everr"),
            OsString::from("skills"),
            OsString::from("list"),
            OsString::from("--global"),
            OsString::from_vec(vec![0xff]),
        ]);

        assert_eq!(options, vec!["global"]);
    }

    #[test]
    fn appends_signal_path_to_base_endpoint() {
        assert_eq!(
            signal_endpoint("http://127.0.0.1:54318", "logs"),
            "http://127.0.0.1:54318/v1/logs"
        );
    }

    #[test]
    fn leaves_existing_signal_path_unchanged() {
        assert_eq!(
            signal_endpoint("http://127.0.0.1:54318/v1/logs", "logs"),
            "http://127.0.0.1:54318/v1/logs"
        );
    }
}
