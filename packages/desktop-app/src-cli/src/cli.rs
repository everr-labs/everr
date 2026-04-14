use clap::{Args, Parser, Subcommand};

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
    about = "CLI for CI/CD observability in Everr, designed for humans and code assistants"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Remove local Everr setup artifacts
    Uninstall,
    /// Log in and persist a local session
    Login(LoginArgs),
    /// Log out and clear the local session
    Logout,
    /// Print the repo-level AGENTS.md instructions for Everr
    SetupAssistant,
    /// Print the full AI instructions for Everr CLI usage
    AiInstructions,
    /// Show all pipeline runs for a specific commit
    Status(StatusArgs),
    /// Search failing step logs on other branches
    Grep(GrepArgs),
    /// Watch the current commit until pipeline runs complete
    Watch(WatchArgs),
    /// Show historical executions for a specific test
    TestHistory(TestHistoryArgs),
    /// Show the slowest tests in the selected time range, repo-wide by default
    SlowestTests(SlowestTestsArgs),
    /// Show the slowest jobs in the selected time range, repo-wide by default
    SlowestJobs(SlowestJobsArgs),
    /// List recent runs
    #[command(name = "runs")]
    RunsList(ListRunsArgs),
    /// Show run details
    #[command(name = "show")]
    RunsShow(ShowRunArgs),
    /// Show step logs for a run
    #[command(name = "logs")]
    RunsLogs(GetLogsArgs),
    /// List workflows and their jobs for a repository
    #[command(name = "workflows")]
    WorkflowsList(WorkflowsListArgs),
    /// Run the full setup wizard (login + org + import + assistant configuration)
    #[command(name = "setup")]
    Setup,
    /// Initialize the current repository (import runs + write assistant instructions)
    Init,
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
    #[arg(long, default_value_t = 100, value_parser = clap::value_parser!(u32).range(1..=100))]
    pub limit: u32,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
}

#[derive(Args, Debug)]
pub struct SlowestTestsArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub branch: Option<String>,
    #[arg(long)]
    pub from: Option<String>,
    #[arg(long)]
    pub to: Option<String>,
    #[arg(long, default_value_t = 10, value_parser = clap::value_parser!(u32).range(1..=100))]
    pub limit: u32,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
}

#[derive(Args, Debug)]
pub struct SlowestJobsArgs {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub branch: Option<String>,
    #[arg(long)]
    pub from: Option<String>,
    #[arg(long)]
    pub to: Option<String>,
    #[arg(long, default_value_t = 10, value_parser = clap::value_parser!(u32).range(1..=100))]
    pub limit: u32,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
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
pub struct WorkflowsListArgs {
    #[arg(long)]
    pub repo: Option<String>,

    #[arg(long)]
    pub branch: Option<String>,
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

    use super::{
        Cli, Commands, GrepArgs, SlowestJobsArgs, SlowestTestsArgs, TestHistoryArgs, WatchArgs,
    };

    #[test]
    fn parses_top_level_commands() {
        let login = Cli::try_parse_from(["everr", "login"]).expect("login command");
        assert!(matches!(login.command, Commands::Login(_)));

        let logout = Cli::try_parse_from(["everr", "logout"]).expect("logout command");
        assert!(matches!(logout.command, Commands::Logout));

        let uninstall = Cli::try_parse_from(["everr", "uninstall"]).expect("uninstall command");
        assert!(matches!(uninstall.command, Commands::Uninstall));

        let setup_assistant =
            Cli::try_parse_from(["everr", "setup-assistant"]).expect("setup-assistant command");
        assert!(matches!(setup_assistant.command, Commands::SetupAssistant));

        let ai_instructions =
            Cli::try_parse_from(["everr", "ai-instructions"]).expect("ai-instructions command");
        assert!(matches!(ai_instructions.command, Commands::AiInstructions));
    }

    #[test]
    fn validates_required_trace_id_for_runs_show() {
        let err = Cli::try_parse_from(["everr", "show"]).expect_err("show should require trace_id");
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
            "status",
            "--repo",
            "everr-labs/everr",
            "--branch",
            "feature/tests",
            "--commit",
            "abc123def456",
        ])
        .expect("valid status command");

        let Commands::Status(args) = cli.command else {
            panic!("expected status command");
        };

        assert_eq!(args.repo.as_deref(), Some("everr-labs/everr"));
        assert_eq!(args.branch.as_deref(), Some("feature/tests"));
        assert_eq!(args.commit.as_deref(), Some("abc123def456"));
    }

    #[test]
    fn validates_required_arguments_for_runs_logs() {
        let err = Cli::try_parse_from(["everr", "logs", "trace-1", "--job-name", "build"])
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
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--log-failed",
        ])
        .expect("valid logs command with --log-failed");

        let Commands::RunsLogs(args) = cli.command else {
            panic!("expected logs command");
        };

        assert_eq!(args.job_name.as_deref(), Some("build"));
        assert!(args.step_number.is_none());
        assert!(args.log_failed);
    }

    #[test]
    fn logs_accepts_job_id_with_log_failed() {
        let cli =
            Cli::try_parse_from(["everr", "logs", "trace-1", "--job-id", "42", "--log-failed"])
                .expect("valid logs command with --job-id and --log-failed");

        let Commands::RunsLogs(args) = cli.command else {
            panic!("expected logs command");
        };

        assert_eq!(args.job_id.as_deref(), Some("42"));
        assert!(args.job_name.is_none());
        assert!(args.log_failed);
    }

    #[test]
    fn logs_accepts_job_id_with_step_number() {
        let cli = Cli::try_parse_from([
            "everr",
            "logs",
            "trace-1",
            "--job-id",
            "42",
            "--step-number",
            "3",
        ])
        .expect("valid logs command with --job-id and --step-number");

        let Commands::RunsLogs(args) = cli.command else {
            panic!("expected logs command");
        };

        assert_eq!(args.job_id.as_deref(), Some("42"));
        assert_eq!(args.step_number.as_deref(), Some("3"));
        assert!(!args.log_failed);
    }

    #[test]
    fn logs_rejects_both_job_name_and_job_id() {
        let err = Cli::try_parse_from([
            "everr",
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
        let err = Cli::try_parse_from(["everr", "logs", "trace-1", "--step-number", "1"])
            .expect_err("logs should require --job-name or --job-id");
        let err_string = err.to_string();
        assert!(
            err_string.contains("job-name") || err_string.contains("job-id"),
            "expected error to mention --job-name or --job-id, got: {err_string}"
        );
    }

    #[test]
    fn validates_required_pattern_for_grep() {
        let err =
            Cli::try_parse_from(["everr", "grep"]).expect_err("grep should require --pattern");
        assert!(err.to_string().contains("--pattern"));
    }

    #[test]
    fn setup_assistant_rejects_removed_assistant_flag() {
        let err = Cli::try_parse_from(["everr", "setup-assistant", "--assistant", "codex"])
            .expect_err("setup-assistant should reject removed --assistant flag");
        assert!(err.to_string().contains("--assistant"));
    }

    #[test]
    fn runs_logs_defaults_to_no_paging() {
        let cli = Cli::try_parse_from([
            "everr",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
        ])
        .expect("valid logs command");

        let Commands::RunsLogs(args) = cli.command else {
            panic!("expected logs command");
        };
        assert_eq!(args.paging(), None);
    }

    #[test]
    fn grep_limit_defaults_to_twenty() {
        let cli = Cli::try_parse_from(["everr", "grep", "--pattern", "panic"])
            .expect("valid grep command");

        let Commands::Grep(args) = cli.command else {
            panic!("expected grep command");
        };

        assert_eq!(args.limit, 20);
        assert_eq!(args.offset, 0);
    }

    #[test]
    fn grep_limit_must_be_in_range() {
        let err = Cli::try_parse_from(["everr", "grep", "--pattern", "panic", "--limit", "101"])
            .expect_err("grep should reject out-of-range limit");

        assert!(err.to_string().contains("--limit"));
    }

    #[test]
    fn grep_job_and_step_filters_are_optional() {
        let cli = Cli::try_parse_from(["everr", "grep", "--pattern", "panic"])
            .expect("valid grep command");

        let Commands::Grep(GrepArgs {
            job_name,
            step_number,
            ..
        }) = cli.command
        else {
            panic!("expected grep command");
        };

        assert!(job_name.is_none());
        assert!(step_number.is_none());
    }

    #[test]
    fn grep_job_name_requires_step_number() {
        let err = Cli::try_parse_from([
            "everr",
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
        let err =
            Cli::try_parse_from(["everr", "grep", "--pattern", "panic", "--step-number", "5"])
                .expect_err("grep should require --job-name when --step-number is set");

        assert!(err.to_string().contains("--job-name"));
    }

    #[test]
    fn runs_logs_limit_enables_paging_mode() {
        let cli = Cli::try_parse_from([
            "everr",
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

        let Commands::RunsLogs(args) = cli.command else {
            panic!("expected logs command");
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

        let Commands::RunsLogs(args) = cli.command else {
            panic!("expected logs command");
        };

        assert_eq!(args.paging(), None);
        assert_eq!(args.offset, Some(2000));
    }

    #[test]
    fn runs_logs_limit_rejects_values_over_maximum() {
        let err = Cli::try_parse_from([
            "everr",
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
    fn setup_assistant_parses_without_arguments() {
        let cli =
            Cli::try_parse_from(["everr", "setup-assistant"]).expect("setup-assistant command");

        assert!(matches!(cli.command, Commands::SetupAssistant));
    }

    #[test]
    fn watch_parses_without_arguments() {
        let cli = Cli::try_parse_from(["everr", "watch"]).expect("watch command");

        let Commands::Watch(WatchArgs {
            repo,
            branch,
            commit,
            attempt: _,
            fail_fast: _,
        }) = cli.command
        else {
            panic!("expected watch command");
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
            "everr-labs/everr",
            "--module",
            "suite",
            "--test-name",
            "test",
            "--from",
            "now-7d",
            "--to",
            "now",
            "--limit",
            "25",
            "--offset",
            "50",
        ])
        .expect("test-history command");

        let Commands::TestHistory(TestHistoryArgs {
            repo,
            test_name,
            test_module,
            from,
            to,
            limit,
            offset,
        }) = cli.command
        else {
            panic!("expected test-history command");
        };

        assert_eq!(repo.as_deref(), Some("everr-labs/everr"));
        assert_eq!(test_name.as_deref(), Some("test"));
        assert_eq!(test_module.as_deref(), Some("suite"));
        assert_eq!(from.as_deref(), Some("now-7d"));
        assert_eq!(to.as_deref(), Some("now"));
        assert_eq!(limit, 25);
        assert_eq!(offset, 50);
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

    #[test]
    fn slowest_tests_parses_optional_filters() {
        let cli = Cli::try_parse_from([
            "everr",
            "slowest-tests",
            "--repo",
            "everr-labs/everr",
            "--branch",
            "main",
            "--from",
            "now-24h",
            "--to",
            "now",
            "--limit",
            "25",
            "--offset",
            "10",
        ])
        .expect("slowest-tests command");

        let Commands::SlowestTests(SlowestTestsArgs {
            repo,
            branch,
            from,
            to,
            limit,
            offset,
        }) = cli.command
        else {
            panic!("expected slowest-tests command");
        };

        assert_eq!(repo.as_deref(), Some("everr-labs/everr"));
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(from.as_deref(), Some("now-24h"));
        assert_eq!(to.as_deref(), Some("now"));
        assert_eq!(limit, 25);
        assert_eq!(offset, 10);
    }

    #[test]
    fn slowest_jobs_defaults_to_limit_ten() {
        let cli = Cli::try_parse_from(["everr", "slowest-jobs"]).expect("slowest-jobs command");

        let Commands::SlowestJobs(SlowestJobsArgs { limit, offset, .. }) = cli.command else {
            panic!("expected slowest-jobs command");
        };

        assert_eq!(limit, 10);
        assert_eq!(offset, 0);
    }

    #[test]
    fn runs_list_parses_limit_and_offset() {
        let cli = Cli::try_parse_from(["everr", "runs", "--limit", "15", "--offset", "30"])
            .expect("runs command");

        let Commands::RunsList(args) = cli.command else {
            panic!("expected runs command");
        };

        assert_eq!(args.limit, 15);
        assert_eq!(args.offset, 30);
    }

    #[test]
    fn runs_list_defaults_to_limit_twenty_and_offset_zero() {
        let cli = Cli::try_parse_from(["everr", "runs"]).expect("runs command");

        let Commands::RunsList(args) = cli.command else {
            panic!("expected runs command");
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
        let cli = Cli::try_parse_from(["everr", "watch", "--fail-fast"]).expect("watch command");

        let Commands::Watch(WatchArgs { fail_fast, .. }) = cli.command else {
            panic!("expected watch command");
        };

        assert!(fail_fast);
    }

    #[test]
    fn watch_fail_fast_defaults_to_false() {
        let cli = Cli::try_parse_from(["everr", "watch"]).expect("watch command");

        let Commands::Watch(WatchArgs { fail_fast, .. }) = cli.command else {
            panic!("expected watch command");
        };

        assert!(!fail_fast);
    }

    #[test]
    fn runs_logs_accepts_egrep_pattern() {
        let cli = Cli::try_parse_from([
            "everr",
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

        let Commands::RunsLogs(args) = cli.command else {
            panic!("expected logs command");
        };

        assert_eq!(args.egrep.as_deref(), Some("Error.*timeout"));
    }

    #[test]
    fn runs_logs_egrep_defaults_to_none() {
        let cli = Cli::try_parse_from([
            "everr",
            "logs",
            "trace-1",
            "--job-name",
            "build",
            "--step-number",
            "2",
        ])
        .expect("valid logs command");

        let Commands::RunsLogs(args) = cli.command else {
            panic!("expected logs command");
        };

        assert!(args.egrep.is_none());
    }
}
