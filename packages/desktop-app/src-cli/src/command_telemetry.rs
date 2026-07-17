use std::collections::{BTreeSet, HashMap};
use std::env;
use std::ffi::OsString;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use opentelemetry_otlp::{Protocol, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::{BatchConfigBuilder, BatchLogProcessor, SdkLoggerProvider};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::cli::{
    CiSubcommand, Cli, CloudSubcommand, Commands, ErrorsSubcommand, LocalSubcommand,
    ResourcesSubcommand, SkillsSubcommand,
};

const SERVICE_NAME: &str = "everr-cli";
const EVENT_NAME: &str = "everr.cli.command";
const RESULT_EVENT_NAME: &str = "everr.cli.command.result";
const EVENT_TARGET: &str = "everr_cli_command";
const EXPORT_TIMEOUT: Duration = Duration::from_millis(750);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(750);

static LOGGER_PROVIDER: OnceLock<Mutex<Option<SdkLoggerProvider>>> = OnceLock::new();

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

/// Records how the command ended. On failure the full anyhow context chain
/// is attached, which names the step that broke (each fallible step in the
/// command implementations carries its own context label).
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
            let error = format!("{err:#}");
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

pub fn shutdown() {
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
    let config = TelemetryConfig::from_env();
    let resource = resource();

    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(signal_endpoint(&config.endpoint, "logs"))
        .with_timeout(EXPORT_TIMEOUT)
        .with_headers(config.headers)
        .build()?;
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
        .with(EnvFilter::new(format!("{EVENT_TARGET}=info")))
        .with(log_layer)
        .try_init()?;

    let _ = LOGGER_PROVIDER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .replace(logger_provider);

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
                    CloudSubcommand::Query(_) => "query",
                    CloudSubcommand::Errors(args) => match &args.command {
                        ErrorsSubcommand::List(_) => "errors list",
                        ErrorsSubcommand::Show(_) => "errors show",
                    },
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
                    LocalSubcommand::Query(_) => "query",
                    LocalSubcommand::Status => "status",
                }),
            ),
            Commands::Wrap(_) => ("wrap", None),
            Commands::Setup => ("setup", None),
            Commands::Init => ("init", None),
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

struct TelemetryConfig {
    endpoint: String,
    headers: HashMap<String, String>,
}

impl TelemetryConfig {
    fn from_env() -> Self {
        let ingest_key = ingest_key();
        let endpoint = env_value("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_else(|| {
            if ingest_key.is_some() {
                "https://ingest.everr.dev".into()
            } else {
                everr_core::build::otlp_http_origin()
            }
        });
        let headers = ingest_key
            .map(|key| HashMap::from([("Authorization".to_string(), format!("Bearer {key}"))]))
            .unwrap_or_default();

        Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            headers,
        }
    }
}

fn env_value(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .and_then(|value| non_empty_value(&value))
}

fn ingest_key() -> Option<String> {
    env_value("EVERR_INGEST_KEY").or_else(|| {
        if cfg!(debug_assertions) {
            None
        } else {
            option_env!("EVERR_INGEST_KEY").and_then(non_empty_value)
        }
    })
}

fn non_empty_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resource() -> Resource {
    Resource::builder()
        .with_service_name(SERVICE_NAME)
        .with_attribute(opentelemetry::KeyValue::new(
            "service.version",
            env!("EVERR_VERSION"),
        ))
        .with_attribute(opentelemetry::KeyValue::new(
            "deployment.environment.name",
            deployment_environment(),
        ))
        .build()
}

fn deployment_environment() -> &'static str {
    if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    }
}

fn operating_system() -> &'static str {
    std::env::consts::OS
}

fn signal_endpoint(base_endpoint: &str, signal: &str) -> String {
    let endpoint = base_endpoint.trim_end_matches('/');
    if endpoint.ends_with(&format!("/v1/{signal}")) {
        endpoint.to_string()
    } else {
        format!("{endpoint}/v1/{signal}")
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;
    use std::ffi::OsString;

    use super::{CommandTelemetry, option_names, signal_endpoint};
    use crate::cli::Cli;

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
