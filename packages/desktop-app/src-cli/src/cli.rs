use clap::{Args, Parser, Subcommand, ValueEnum};

#[cfg(debug_assertions)]
const VERSION_OUTPUT: &str = concat!(env!("EVERR_VERSION"), " (debug build)");

#[cfg(not(debug_assertions))]
const VERSION_OUTPUT: &str = concat!(env!("EVERR_VERSION"), " (release build)");

pub const DEFAULT_LOG_PAGE_SIZE: u32 = 1000;
pub const MAX_LOG_PAGE_SIZE: u32 = 5000;

#[derive(Parser, Debug)]
#[command(
    name = "everr",
    version = VERSION_OUTPUT,
    long_version = VERSION_OUTPUT,
    about = "CLI for CI/CD observability in Everr, designed for humans and agent skills"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Remove local Everr setup artifacts
    Uninstall,
    /// Work with Everr Cloud auth and cloud-backed CI data
    Cloud(CloudArgs),
    /// Inspect GitHub Actions CI runs
    Ci(CiArgs),
    /// Inspect local diagnostic telemetry recorded by the Everr Desktop app
    Local(LocalArgs),
    /// Run a command and send its stdout/stderr logs to the local collector
    Wrap(WrapArgs),
    /// Run the full setup wizard (login + org + import + skills installation)
    #[command(name = "setup")]
    Setup,
    /// Initialize the current repository by importing recent runs
    Init,
    /// Manage bundled Everr agent skills
    #[command(name = "skills")]
    Skills(SkillsArgs),
}

#[derive(Args, Debug)]
pub struct CloudArgs {
    #[command(subcommand)]
    pub command: CloudSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum CloudSubcommand {
    /// Log in and persist a local session
    Login(LoginArgs),
    /// Log out and clear the local session
    Logout,
    /// Search failing step logs on other branches
    Grep(GrepArgs),
}

#[derive(Args, Debug)]
pub struct CiArgs {
    #[command(subcommand)]
    pub command: CiSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum CiSubcommand {
    /// Show all pipeline runs for a specific commit
    Status(StatusArgs),
    /// Watch the current commit until pipeline runs complete
    Watch(WatchArgs),
    /// List recent runs
    Runs(ListRunsArgs),
    /// Show run details
    Show(ShowRunArgs),
    /// Show step logs for a run
    Logs(GetLogsArgs),
}

#[derive(Args, Debug)]
pub struct LocalArgs {
    #[command(subcommand)]
    pub command: LocalSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum LocalSubcommand {
    /// Start the local collector in the foreground.
    Start(TelemetryStartArgs),
    /// Run a SQL query against local telemetry.
    Query(TelemetryQueryArgs),
    /// Check whether the local collector is running.
    Status,
    /// Print the local collector URL.
    Endpoint,
}

#[derive(Args, Debug)]
pub struct SkillsArgs {
    #[command(subcommand)]
    pub command: SkillsSubcommand,
}

#[derive(Subcommand, Debug)]
pub enum SkillsSubcommand {
    /// List bundled Everr skills
    List(SkillsListArgs),
    /// Install bundled Everr skills
    Install(SkillsInstallArgs),
    /// Update installed bundled Everr skills
    Update(SkillsUpdateArgs),
    /// Uninstall bundled Everr skills
    Uninstall(SkillsUninstallArgs),
}

#[derive(ValueEnum, Debug, Clone, Copy, Eq, PartialEq)]
#[value(rename_all = "kebab-case")]
pub enum SkillAgentArg {
    All,
    Codex,
    ClaudeCode,
    Cursor,
}

#[derive(Args, Debug, Default, Clone)]
pub struct SkillScopeArgs {
    /// Use project-local .agents/skills in the current directory
    #[arg(long, conflicts_with = "global")]
    pub project: bool,
    /// Use global ~/.agents/skills
    #[arg(long)]
    pub global: bool,
}

#[derive(Args, Debug, Default)]
pub struct SkillsListArgs {
    #[command(flatten)]
    pub scope: SkillScopeArgs,
    /// Provider to inspect
    #[arg(long = "agent", value_enum)]
    pub agents: Vec<SkillAgentArg>,
}

#[derive(Args, Debug, Default)]
pub struct SkillsInstallArgs {
    /// Skill names to install. Omit in an interactive terminal to choose from a prompt.
    pub skills: Vec<String>,
    /// Install all bundled skills
    #[arg(long)]
    pub all: bool,
    #[command(flatten)]
    pub scope: SkillScopeArgs,
    /// Provider to install for
    #[arg(long = "agent", value_enum)]
    pub agents: Vec<SkillAgentArg>,
    /// Copy into provider directories instead of symlinking
    #[arg(long)]
    pub copy: bool,
    /// Overwrite existing differing skill files
    #[arg(long)]
    pub force: bool,
    /// Preview without writing files
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Args, Debug, Default)]
pub struct SkillsUpdateArgs {
    /// Skill names to update. With none, updates installed bundled skills.
    pub skills: Vec<String>,
    #[command(flatten)]
    pub scope: SkillScopeArgs,
    /// Provider to update for
    #[arg(long = "agent", value_enum)]
    pub agents: Vec<SkillAgentArg>,
    /// Preview without writing files
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Args, Debug, Default)]
pub struct SkillsUninstallArgs {
    /// Skill names to uninstall
    pub skills: Vec<String>,
    /// Uninstall all bundled skills
    #[arg(long)]
    pub all: bool,
    /// Confirm uninstalling all bundled skills
    #[arg(long, short = 'y')]
    pub yes: bool,
    #[command(flatten)]
    pub scope: SkillScopeArgs,
    /// Provider to uninstall for
    #[arg(long = "agent", value_enum)]
    pub agents: Vec<SkillAgentArg>,
    /// Preview without removing files
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Args, Debug, Default)]
pub struct TelemetryStartArgs {
    /// Suppress collector URL output after the collector is ready.
    #[arg(long)]
    pub quiet: bool,
}

#[derive(Args, Debug, Default)]
pub struct TelemetryQueryArgs {
    /// The SQL query to run. Keep it quoted. Include LIMIT yourself.
    pub sql: String,
    /// Output format. Default: table on TTY, ndjson otherwise.
    #[arg(long, value_enum)]
    pub format: Option<TelemetryFormat>,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
pub enum TelemetryFormat {
    Json,
    Ndjson,
    Table,
}

#[derive(Args, Debug, Default)]
pub struct LoginArgs {}

#[derive(Args, Debug, Default)]
pub struct StatusArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub branch: Option<String>,
    #[arg(long)]
    pub commit: Option<String>,
}

#[derive(Args, Debug)]
pub struct GrepArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long, requires = "step_number")]
    pub job_name: Option<String>,
    #[arg(long, requires = "job_name")]
    pub step_number: Option<String>,
    #[arg(long)]
    pub pattern: String,
    #[arg(long)]
    pub branch: Option<String>,
    #[arg(long)]
    pub from: Option<String>,
    #[arg(long)]
    pub to: Option<String>,
    #[arg(long, default_value_t = 20, value_parser = clap::value_parser!(u32).range(1..=100))]
    pub limit: u32,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
}

#[derive(Args, Debug, Default)]
pub struct WatchArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub branch: Option<String>,
    #[arg(long)]
    pub commit: Option<String>,
    #[arg(long)]
    pub attempt: Option<u32>,
    #[arg(long)]
    pub fail_fast: bool,
}

#[derive(Args, Debug, Default)]
pub struct ListRunsArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub branch: Option<String>,
    /// Use the current git branch as the branch filter
    #[arg(long)]
    pub current_branch: bool,
    #[arg(long)]
    pub conclusion: Option<String>,
    #[arg(long)]
    pub workflow_name: Option<String>,
    #[arg(long)]
    pub run_id: Option<String>,
    #[arg(long, default_value_t = 20, value_parser = clap::value_parser!(u32).range(1..=100))]
    pub limit: u32,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
    #[arg(long)]
    pub from: Option<String>,
    #[arg(long)]
    pub to: Option<String>,
}

#[derive(Args, Debug)]
pub struct ShowRunArgs {
    pub trace_id: String,

    /// Show only failed jobs and their failed steps
    #[arg(long)]
    pub failed: bool,
}

#[derive(Args, Debug)]
pub struct GetLogsArgs {
    pub trace_id: String,
    #[arg(long, required_unless_present = "job_id", conflicts_with = "job_id")]
    pub job_name: Option<String>,
    #[arg(
        long,
        required_unless_present = "job_name",
        conflicts_with = "job_name"
    )]
    pub job_id: Option<String>,
    #[arg(
        long,
        required_unless_present = "log_failed",
        conflicts_with = "log_failed"
    )]
    pub step_number: Option<String>,
    /// Automatically resolve and show the first failing step for the given job
    #[arg(long, conflicts_with = "step_number")]
    pub log_failed: bool,
    /// Show the last N lines of the log (default: 1000); combine with --offset to skip lines from the bottom
    #[arg(long, conflicts_with_all = ["limit"])]
    pub tail: Option<u32>,
    #[arg(
        long,
        conflicts_with_all = ["tail"],
        value_parser = clap::value_parser!(u32).range(1..=MAX_LOG_PAGE_SIZE as i64),
        help = "Fetch a raw log page of N lines (oldest-first)"
    )]
    pub limit: Option<u32>,
    #[arg(
        long,
        help = "Skip this many lines before printing; works with both --tail (from bottom) and --limit (from top)"
    )]
    pub offset: Option<u32>,
    /// Preserve ANSI color codes (stripped by default)
    #[arg(long)]
    pub color: bool,
    /// Filter output to lines matching a re2 regex pattern; exits 1 if no lines match
    #[arg(long)]
    pub egrep: Option<String>,
}

#[derive(Args, Debug, Default)]
pub struct WrapArgs {
    /// Command and arguments to run
    #[arg(
        required = true,
        trailing_var_arg = true,
        allow_hyphen_values = true,
        value_name = "COMMAND"
    )]
    pub command: Vec<String>,
}

impl GetLogsArgs {
    pub fn paging(&self) -> Option<LogPagingArgs> {
        if self.limit.is_none() {
            return None;
        }

        Some(LogPagingArgs {
            limit: self.limit.unwrap_or(DEFAULT_LOG_PAGE_SIZE),
            offset: self.offset.unwrap_or(0),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LogPagingArgs {
    pub limit: u32,
    pub offset: u32,
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{CiSubcommand, Cli, CloudSubcommand, Commands, LocalSubcommand, WatchArgs};

    #[test]
    fn parses_top_level_commands() {
        let login = Cli::try_parse_from(["everr", "cloud", "login"]).expect("login command");
        let Commands::Cloud(login) = login.command else {
            panic!("expected cloud command");
        };
        assert!(matches!(login.command, CloudSubcommand::Login(_)));

        let logout = Cli::try_parse_from(["everr", "cloud", "logout"]).expect("logout command");
        let Commands::Cloud(logout) = logout.command else {
            panic!("expected cloud command");
        };
        assert!(matches!(logout.command, CloudSubcommand::Logout));

        let uninstall = Cli::try_parse_from(["everr", "uninstall"]).expect("uninstall command");
        assert!(matches!(uninstall.command, Commands::Uninstall));

        let skills = Cli::try_parse_from(["everr", "skills", "list"]).expect("skills command");
        assert!(matches!(skills.command, Commands::Skills(_)));

        let wrap =
            Cli::try_parse_from(["everr", "wrap", "--", "cargo", "test"]).expect("wrap command");
        assert!(matches!(wrap.command, Commands::Wrap(_)));

        let local = Cli::try_parse_from(["everr", "local", "endpoint"]).expect("local command");
        let Commands::Local(local) = local.command else {
            panic!("expected local command");
        };
        assert!(matches!(local.command, LocalSubcommand::Endpoint));
    }

    #[test]
    fn validates_required_trace_id_for_runs_show() {
        let err =
            Cli::try_parse_from(["everr", "ci", "show"]).expect_err("show should require trace_id");
        let err_string = err.to_string();
        assert!(
            err_string.contains("TRACE_ID")
                || err_string.contains("trace_id")
                || err_string.contains("required")
        );
    }

    #[test]
    fn status_accepts_repo_branch_and_commit() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "status",
            "--repo",
            "everr-labs/everr",
            "--branch",
            "feature/tests",
            "--commit",
            "abc123def456",
        ])
        .expect("valid status command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Status(args) = ci.command else {
            panic!("expected ci status command");
        };

        assert_eq!(args.repo.as_deref(), Some("everr-labs/everr"));
        assert_eq!(args.branch.as_deref(), Some("feature/tests"));
        assert_eq!(args.commit.as_deref(), Some("abc123def456"));
    }

    #[test]
    fn wrap_accepts_command_after_separator() {
        let cli = Cli::try_parse_from([
            "everr",
            "wrap",
            "--",
            "cargo",
            "test",
            "--package",
            "everr-cli",
        ])
        .expect("valid wrap command");

        let Commands::Wrap(args) = cli.command else {
            panic!("expected wrap command");
        };

        assert_eq!(
            args.command,
            vec!["cargo", "test", "--package", "everr-cli"]
        );
    }

    #[test]
    fn wrap_requires_command() {
        let err = Cli::try_parse_from(["everr", "wrap"]).expect_err("wrap should require command");

        assert!(err.to_string().contains("<COMMAND>"));
    }

    #[test]
    fn validates_required_arguments_for_runs_logs() {
        let err = Cli::try_parse_from(["everr", "ci", "logs", "trace-1", "--job-name", "build"])
            .expect_err("logs should require --step-number or --log-failed");
        let err_string = err.to_string();
        assert!(
            err_string.contains("step-number") || err_string.contains("log-failed"),
            "expected error to mention --step-number or --log-failed, got: {err_string}"
        );
    }

    #[test]
    fn logs_accepts_log_failed_without_step_number() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--log-failed",
        ])
        .expect("valid logs command with --log-failed");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Logs(args) = ci.command else {
            panic!("expected ci logs command");
        };

        assert_eq!(args.job_name.as_deref(), Some("build"));
        assert!(args.step_number.is_none());
        assert!(args.log_failed);
    }

    #[test]
    fn logs_accepts_job_id_with_log_failed() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-id",
            "42",
            "--log-failed",
        ])
        .expect("valid logs command with --job-id and --log-failed");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Logs(args) = ci.command else {
            panic!("expected ci logs command");
        };

        assert_eq!(args.job_id.as_deref(), Some("42"));
        assert!(args.job_name.is_none());
        assert!(args.log_failed);
    }

    #[test]
    fn logs_accepts_job_id_with_step_number() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-id",
            "42",
            "--step-number",
            "3",
        ])
        .expect("valid logs command with --job-id and --step-number");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Logs(args) = ci.command else {
            panic!("expected ci logs command");
        };

        assert_eq!(args.job_id.as_deref(), Some("42"));
        assert_eq!(args.step_number.as_deref(), Some("3"));
        assert!(!args.log_failed);
    }

    #[test]
    fn logs_rejects_both_job_name_and_job_id() {
        let err = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--job-id",
            "42",
            "--step-number",
            "1",
        ])
        .expect_err("logs should reject both --job-name and --job-id");
        assert!(err.to_string().contains("job"));
    }

    #[test]
    fn logs_rejects_both_step_number_and_log_failed() {
        let err = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "1",
            "--log-failed",
        ])
        .expect_err("logs should reject both --step-number and --log-failed");
        let err_string = err.to_string();
        assert!(
            err_string.contains("step-number") || err_string.contains("log-failed"),
            "expected conflict error, got: {err_string}"
        );
    }

    #[test]
    fn logs_requires_job_identifier() {
        let err = Cli::try_parse_from(["everr", "ci", "logs", "trace-1", "--step-number", "1"])
            .expect_err("logs should require --job-name or --job-id");
        let err_string = err.to_string();
        assert!(
            err_string.contains("job-name") || err_string.contains("job-id"),
            "expected error to mention --job-name or --job-id, got: {err_string}"
        );
    }

    #[test]
    fn cloud_logs_is_no_longer_accepted() {
        let err = Cli::try_parse_from(["everr", "cloud", "logs", "--help"])
            .expect_err("cloud logs should be moved to ci logs");

        assert!(err.to_string().contains("logs"));
    }

    #[test]
    fn validates_required_pattern_for_grep() {
        let err = Cli::try_parse_from(["everr", "cloud", "grep"])
            .expect_err("grep should require --pattern");
        assert!(err.to_string().contains("--pattern"));
    }

    #[test]
    fn old_assistant_commands_are_rejected() {
        let setup_err = Cli::try_parse_from(["everr", "setup-assistant"])
            .expect_err("setup-assistant should be removed");
        assert!(setup_err.to_string().contains("setup-assistant"));

        let instructions_err = Cli::try_parse_from(["everr", "ai-instructions"])
            .expect_err("ai-instructions should be removed");
        assert!(instructions_err.to_string().contains("ai-instructions"));
    }

    #[test]
    fn runs_logs_defaults_to_no_paging() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
        ])
        .expect("valid logs command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Logs(args) = ci.command else {
            panic!("expected ci logs command");
        };
        assert_eq!(args.paging(), None);
    }

    #[test]
    fn grep_limit_defaults_to_twenty() {
        let cli = Cli::try_parse_from(["everr", "cloud", "grep", "--pattern", "panic"])
            .expect("valid grep command");

        let Commands::Cloud(cloud) = cli.command else {
            panic!("expected cloud command");
        };
        let CloudSubcommand::Grep(args) = cloud.command else {
            panic!("expected cloud grep command");
        };

        assert_eq!(args.limit, 20);
        assert_eq!(args.offset, 0);
    }

    #[test]
    fn grep_limit_must_be_in_range() {
        let err = Cli::try_parse_from([
            "everr",
            "cloud",
            "grep",
            "--pattern",
            "panic",
            "--limit",
            "101",
        ])
        .expect_err("grep should reject out-of-range limit");

        assert!(err.to_string().contains("--limit"));
    }

    #[test]
    fn grep_job_and_step_filters_are_optional() {
        let cli = Cli::try_parse_from(["everr", "cloud", "grep", "--pattern", "panic"])
            .expect("valid grep command");

        let Commands::Cloud(cloud) = cli.command else {
            panic!("expected cloud command");
        };
        let CloudSubcommand::Grep(args) = cloud.command else {
            panic!("expected cloud grep command");
        };
        let super::GrepArgs {
            job_name,
            step_number,
            ..
        } = args;

        assert!(job_name.is_none());
        assert!(step_number.is_none());
    }

    #[test]
    fn grep_job_name_requires_step_number() {
        let err = Cli::try_parse_from([
            "everr",
            "cloud",
            "grep",
            "--pattern",
            "panic",
            "--job-name",
            "integration",
        ])
        .expect_err("grep should require --step-number when --job-name is set");

        assert!(err.to_string().contains("--step-number"));
    }

    #[test]
    fn grep_step_number_requires_job_name() {
        let err = Cli::try_parse_from([
            "everr",
            "cloud",
            "grep",
            "--pattern",
            "panic",
            "--step-number",
            "5",
        ])
        .expect_err("grep should require --job-name when --step-number is set");

        assert!(err.to_string().contains("--job-name"));
    }

    #[test]
    fn runs_logs_limit_enables_paging_mode() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
            "--limit",
            "250",
        ])
        .expect("valid paged logs command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Logs(args) = ci.command else {
            panic!("expected ci logs command");
        };

        assert_eq!(
            args.paging().map(|value| (value.limit, value.offset)),
            Some((250, 0))
        );
    }

    #[test]
    fn runs_logs_offset_alone_uses_tail_mode() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
            "--offset",
            "2000",
        ])
        .expect("valid logs command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Logs(args) = ci.command else {
            panic!("expected ci logs command");
        };

        assert_eq!(args.paging(), None);
        assert_eq!(args.offset, Some(2000));
    }

    #[test]
    fn runs_logs_limit_rejects_values_over_maximum() {
        let err = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
            "--limit",
            "5001",
        ])
        .expect_err("logs should reject oversize page limits");

        assert!(err.to_string().contains("--limit"));
    }

    #[test]
    fn skills_install_parses_without_json_option() {
        let interactive_cli =
            Cli::try_parse_from(["everr", "skills", "install"]).expect("skills install command");
        assert!(matches!(interactive_cli.command, Commands::Skills(_)));

        let cli = Cli::try_parse_from([
            "everr",
            "skills",
            "install",
            "ci-debugging",
            "--project",
            "--agent",
            "claude-code",
        ])
        .expect("skills install command");

        assert!(matches!(cli.command, Commands::Skills(_)));
        let err = Cli::try_parse_from(["everr", "skills", "install", "ci-debugging", "--json"])
            .expect_err("skills install should not accept --json");
        assert!(err.to_string().contains("--json"));
    }

    #[test]
    fn watch_parses_without_arguments() {
        let cli = Cli::try_parse_from(["everr", "ci", "watch"]).expect("watch command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Watch(WatchArgs {
            repo,
            branch,
            commit,
            attempt: _,
            fail_fast: _,
        }) = ci.command
        else {
            panic!("expected ci watch command");
        };

        assert_eq!(repo, None);
        assert_eq!(branch, None);
        assert_eq!(commit, None);
    }

    #[test]
    fn wait_pipeline_is_no_longer_accepted() {
        let err =
            Cli::try_parse_from(["everr", "wait-pipeline"]).expect_err("legacy command rejected");

        assert!(err.to_string().contains("wait-pipeline"));
    }

    #[test]
    fn moved_top_level_commands_are_rejected() {
        for command in [
            "login",
            "logout",
            "status",
            "grep",
            "watch",
            "runs",
            "show",
            "logs",
            "telemetry",
        ] {
            let err = Cli::try_parse_from(["everr", command])
                .expect_err("moved top-level command should be rejected");
            assert!(err.to_string().contains(command));
        }
    }

    #[test]
    fn retired_commands_are_rejected() {
        for command in ["test-history", "slowest-tests", "slowest-jobs", "workflows"] {
            let err = Cli::try_parse_from(["everr", command])
                .expect_err("retired command should be rejected");
            assert!(err.to_string().contains(command));
        }
    }

    #[test]
    fn runs_list_parses_limit_and_offset() {
        let cli = Cli::try_parse_from(["everr", "ci", "runs", "--limit", "15", "--offset", "30"])
            .expect("runs command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Runs(args) = ci.command else {
            panic!("expected ci runs command");
        };

        assert_eq!(args.limit, 15);
        assert_eq!(args.offset, 30);
    }

    #[test]
    fn runs_list_defaults_to_limit_twenty_and_offset_zero() {
        let cli = Cli::try_parse_from(["everr", "ci", "runs"]).expect("runs command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Runs(args) = ci.command else {
            panic!("expected ci runs command");
        };

        assert_eq!(args.limit, 20);
        assert_eq!(args.offset, 0);
    }

    #[test]
    fn setup_parses_without_arguments() {
        let cli = Cli::try_parse_from(["everr", "setup"]).expect("setup command");
        assert!(matches!(cli.command, Commands::Setup));
    }

    #[test]
    fn init_parses_without_arguments() {
        let cli = Cli::try_parse_from(["everr", "init"]).expect("init command");
        assert!(matches!(cli.command, Commands::Init));
    }

    #[test]
    fn watch_parses_fail_fast_flag() {
        let cli =
            Cli::try_parse_from(["everr", "ci", "watch", "--fail-fast"]).expect("watch command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Watch(WatchArgs { fail_fast, .. }) = ci.command else {
            panic!("expected ci watch command");
        };

        assert!(fail_fast);
    }

    #[test]
    fn watch_fail_fast_defaults_to_false() {
        let cli = Cli::try_parse_from(["everr", "ci", "watch"]).expect("watch command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Watch(WatchArgs { fail_fast, .. }) = ci.command else {
            panic!("expected ci watch command");
        };

        assert!(!fail_fast);
    }

    #[test]
    fn runs_logs_accepts_egrep_pattern() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
            "--egrep",
            "Error.*timeout",
        ])
        .expect("valid logs command with egrep");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Logs(args) = ci.command else {
            panic!("expected ci logs command");
        };

        assert_eq!(args.egrep.as_deref(), Some("Error.*timeout"));
    }

    #[test]
    fn runs_logs_egrep_defaults_to_none() {
        let cli = Cli::try_parse_from([
            "everr",
            "ci",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
        ])
        .expect("valid logs command");

        let Commands::Ci(ci) = cli.command else {
            panic!("expected ci command");
        };
        let CiSubcommand::Logs(args) = ci.command else {
            panic!("expected ci logs command");
        };

        assert!(args.egrep.is_none());
    }
}
