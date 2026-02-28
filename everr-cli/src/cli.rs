use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Parser, Debug)]
#[command(
    name = "everr",
    version,
    about = "CLI for CI/CD observability in Everr, designed for humans and code assistants"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// First-run setup wizard
    Install,
    /// Remove local Everr setup artifacts
    Uninstall,
    /// Guide GitHub App installation for the current repository
    Connect(ConnectArgs),
    /// Authentication commands
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
    /// Global assistant integration
    Assistant {
        #[command(subcommand)]
        command: AssistantCommand,
    },
    /// Show current git repository and branch context
    Context,
    /// CI status for current or selected branch
    Status(StatusArgs),
    /// Pipeline runs commands
    Runs {
        #[command(subcommand)]
        command: RunsCommand,
    },
}

#[derive(Subcommand, Debug)]
pub enum AuthCommand {
    /// Log in and persist a local session
    Login(LoginArgs),
    /// Log out and clear the local session
    Logout,
}

#[derive(Args, Debug)]
pub struct LoginArgs {
    /// API base URL to use for requests
    #[arg(long)]
    pub api_base_url: Option<String>,
    /// Access token (if omitted, wizard prompts securely)
    #[arg(long)]
    pub token: Option<String>,
}

#[derive(Subcommand, Debug)]
pub enum AssistantCommand {
    /// Initialize global assistant integration files
    Init(AssistantInitArgs),
}

#[derive(Subcommand, Debug)]
pub enum RunsCommand {
    /// List recent runs
    List(ListRunsArgs),
    /// Show run details
    Show(ShowRunArgs),
    /// Show step logs for a run
    Logs(GetLogsArgs),
}

#[derive(Args, Debug, Default)]
pub struct StatusArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub branch: Option<String>,
    #[arg(long)]
    pub main_branch: Option<String>,
    #[arg(long)]
    pub from: Option<String>,
    #[arg(long)]
    pub to: Option<String>,
}

#[derive(Args, Debug, Default)]
pub struct ConnectArgs {
    /// Repository in owner/name format
    #[arg(long)]
    pub repo: Option<String>,
    /// Everr app base URL (defaults to active session or app.everr.dev)
    #[arg(long)]
    pub api_base_url: Option<String>,
}

#[derive(Args, Debug, Default)]
pub struct ListRunsArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub branch: Option<String>,
    #[arg(long)]
    pub conclusion: Option<String>,
    #[arg(long)]
    pub workflow_name: Option<String>,
    #[arg(long)]
    pub run_id: Option<String>,
    #[arg(long)]
    pub page: Option<u32>,
    #[arg(long)]
    pub from: Option<String>,
    #[arg(long)]
    pub to: Option<String>,
}

#[derive(Args, Debug)]
pub struct ShowRunArgs {
    #[arg(long)]
    pub trace_id: String,
}

#[derive(Args, Debug)]
pub struct GetLogsArgs {
    #[arg(long)]
    pub trace_id: String,
    #[arg(long)]
    pub job_name: String,
    #[arg(long)]
    pub step_number: String,
    #[arg(long, default_value_t = false)]
    pub full: bool,
}

#[derive(Args, Debug)]
pub struct AssistantInitArgs {
    /// One or more assistants to configure
    #[arg(long = "assistant", value_enum, required = true)]
    pub assistants: Vec<AssistantKind>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum AssistantKind {
    Codex,
    Claude,
    Cursor,
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{AssistantCommand, AssistantKind, Cli, Commands, RunsCommand};

    #[test]
    fn parses_top_level_commands() {
        let context = Cli::try_parse_from(["everr", "context"]).expect("context command");
        assert!(matches!(context.command, Commands::Context));

        let uninstall = Cli::try_parse_from(["everr", "uninstall"]).expect("uninstall command");
        assert!(matches!(uninstall.command, Commands::Uninstall));

        let connect = Cli::try_parse_from(["everr", "connect"]).expect("connect command");
        assert!(matches!(connect.command, Commands::Connect(_)));
    }

    #[test]
    fn validates_required_trace_id_for_runs_show() {
        let err = Cli::try_parse_from(["everr", "runs", "show"])
            .expect_err("runs show should require --trace-id");
        let err_string = err.to_string();
        assert!(err_string.contains("--trace-id"));
    }

    #[test]
    fn validates_required_arguments_for_runs_logs() {
        let err = Cli::try_parse_from([
            "everr",
            "runs",
            "logs",
            "--trace-id",
            "trace-1",
            "--job-name",
            "build",
        ])
        .expect_err("runs logs should require --step-number");
        assert!(err.to_string().contains("--step-number"));
    }

    #[test]
    fn validates_required_assistants_for_assistant_init() {
        let err = Cli::try_parse_from(["everr", "assistant", "init"])
            .expect_err("assistant init should require --assistant");
        assert!(err.to_string().contains("--assistant"));
    }

    #[test]
    fn runs_logs_full_flag_defaults_to_false() {
        let cli = Cli::try_parse_from([
            "everr",
            "runs",
            "logs",
            "--trace-id",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
        ])
        .expect("valid runs logs command");

        let Commands::Runs { command } = cli.command else {
            panic!("expected runs command");
        };
        let RunsCommand::Logs(args) = command else {
            panic!("expected runs logs command");
        };
        assert!(!args.full);
    }

    #[test]
    fn runs_logs_full_flag_parses_true_when_present() {
        let cli = Cli::try_parse_from([
            "everr",
            "runs",
            "logs",
            "--trace-id",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
            "--full",
        ])
        .expect("valid runs logs command");

        let Commands::Runs { command } = cli.command else {
            panic!("expected runs command");
        };
        let RunsCommand::Logs(args) = command else {
            panic!("expected runs logs command");
        };
        assert!(args.full);
    }

    #[test]
    fn assistant_init_supports_repeated_assistant_flags() {
        let cli = Cli::try_parse_from([
            "everr",
            "assistant",
            "init",
            "--assistant",
            "codex",
            "--assistant",
            "cursor",
        ])
        .expect("assistant init command");

        let Commands::Assistant {
            command: AssistantCommand::Init(args),
        } = cli.command
        else {
            panic!("expected assistant init command");
        };

        assert_eq!(
            args.assistants,
            vec![AssistantKind::Codex, AssistantKind::Cursor]
        );
    }
}
