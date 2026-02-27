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
    #[command(name = "current-branch-status")]
    CurrentBranchStatus(StatusArgs),
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
