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
    /// Log in and persist a local session
    Login(LoginArgs),
    /// Log out and clear the local session
    Logout,
    /// Integrate Everr CLI with your code assistant
    SetupAssistant(AssistantInitArgs),
    /// CI status for current or selected branch
    Status(StatusArgs),
    /// Wait for the current commit to appear in runs
    WaitPipeline(WaitArgs),
    /// Show historical executions for a specific test
    TestHistory(TestHistoryArgs),
    /// Pipeline runs commands
    Runs {
        #[command(subcommand)]
        command: RunsCommand,
    },
}

#[derive(Args, Debug, Default)]
pub struct LoginArgs {}

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
pub struct WaitArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub branch: Option<String>,
    #[arg(long)]
    pub commit: Option<String>,
    #[arg(long)]
    pub timeout_seconds: Option<u64>,
    #[arg(long, default_value_t = 5)]
    pub interval_seconds: u64,
}

#[derive(Args, Debug)]
pub struct TestHistoryArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub test_name: Option<String>,
    #[arg(long = "module")]
    pub test_module: Option<String>,
    #[arg(long)]
    pub from: Option<String>,
    #[arg(long)]
    pub to: Option<String>,
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

    use super::{AssistantKind, Cli, Commands, RunsCommand, TestHistoryArgs, WaitArgs};

    #[test]
    fn parses_top_level_commands() {
        let login = Cli::try_parse_from(["everr", "login"]).expect("login command");
        assert!(matches!(login.command, Commands::Login(_)));

        let logout = Cli::try_parse_from(["everr", "logout"]).expect("logout command");
        assert!(matches!(logout.command, Commands::Logout));

        let uninstall = Cli::try_parse_from(["everr", "uninstall"]).expect("uninstall command");
        assert!(matches!(uninstall.command, Commands::Uninstall));
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
    fn validates_required_assistants_for_setup_assistant() {
        let err = Cli::try_parse_from(["everr", "setup-assistant"])
            .expect_err("setup-assistant should require --assistant");
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
    fn setup_assistant_supports_repeated_assistant_flags() {
        let cli = Cli::try_parse_from([
            "everr",
            "setup-assistant",
            "--assistant",
            "codex",
            "--assistant",
            "cursor",
        ])
        .expect("setup-assistant command");

        let Commands::SetupAssistant(args) = cli.command else {
            panic!("expected setup-assistant command");
        };

        assert_eq!(
            args.assistants,
            vec![AssistantKind::Codex, AssistantKind::Cursor]
        );
    }

    #[test]
    fn wait_pipeline_defaults_to_no_timeout_and_five_second_interval() {
        let cli = Cli::try_parse_from(["everr", "wait-pipeline"]).expect("wait-pipeline command");

        let Commands::WaitPipeline(WaitArgs {
            repo,
            branch,
            commit,
            timeout_seconds,
            interval_seconds,
        }) = cli.command
        else {
            panic!("expected wait-pipeline command");
        };

        assert_eq!(repo, None);
        assert_eq!(branch, None);
        assert_eq!(commit, None);
        assert_eq!(timeout_seconds, None);
        assert_eq!(interval_seconds, 5);
    }

    #[test]
    fn wait_pipeline_parses_custom_timeout_and_interval() {
        let cli = Cli::try_parse_from([
            "everr",
            "wait-pipeline",
            "--commit",
            "abc123",
            "--timeout-seconds",
            "1200",
            "--interval-seconds",
            "2",
        ])
        .expect("wait-pipeline command");

        let Commands::WaitPipeline(args) = cli.command else {
            panic!("expected wait-pipeline command");
        };

        assert_eq!(args.commit.as_deref(), Some("abc123"));
        assert_eq!(args.timeout_seconds, Some(1200));
        assert_eq!(args.interval_seconds, 2);
    }

    #[test]
    fn test_history_requires_filter_inputs() {
        let cli =
            Cli::try_parse_from(["everr", "test-history"]).expect("test-history command parses");
        let Commands::TestHistory(TestHistoryArgs {
            test_name,
            test_module,
            ..
        }) = cli.command
        else {
            panic!("expected test-history command");
        };
        assert_eq!(test_name, None);
        assert_eq!(test_module, None);
    }

    #[test]
    fn test_history_parses_optional_filters() {
        let cli = Cli::try_parse_from([
            "everr",
            "test-history",
            "--repo",
            "citric-app/citric",
            "--module",
            "suite",
            "--test-name",
            "test",
            "--from",
            "now-7d",
            "--to",
            "now",
        ])
        .expect("test-history command");

        let Commands::TestHistory(TestHistoryArgs {
            repo,
            test_name,
            test_module,
            from,
            to,
        }) = cli.command
        else {
            panic!("expected test-history command");
        };

        assert_eq!(repo.as_deref(), Some("citric-app/citric"));
        assert_eq!(test_name.as_deref(), Some("test"));
        assert_eq!(test_module.as_deref(), Some("suite"));
        assert_eq!(from.as_deref(), Some("now-7d"));
        assert_eq!(to.as_deref(), Some("now"));
    }

    #[test]
    fn test_history_allows_test_name_without_module() {
        let cli = Cli::try_parse_from(["everr", "test-history", "--test-name", "my-test"])
            .expect("test-history command");

        let Commands::TestHistory(TestHistoryArgs {
            test_name,
            test_module,
            ..
        }) = cli.command
        else {
            panic!("expected test-history command");
        };

        assert_eq!(test_name.as_deref(), Some("my-test"));
        assert_eq!(test_module, None);
    }

    #[test]
    fn test_history_allows_module_without_test_name() {
        let cli = Cli::try_parse_from(["everr", "test-history", "--module", "suite"])
            .expect("test-history command");

        let Commands::TestHistory(TestHistoryArgs {
            test_name,
            test_module,
            ..
        }) = cli.command
        else {
            panic!("expected test-history command");
        };

        assert_eq!(test_name, None);
        assert_eq!(test_module.as_deref(), Some("suite"));
    }
}
