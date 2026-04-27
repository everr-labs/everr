mod api;
mod assistant;
mod auth;
mod cli;
mod core;
mod init;
mod onboarding;
mod telemetry;
mod uninstall;

use anyhow::Result;
use clap::Parser;
use cli::{Cli, Commands};
use tokio::task;

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Uninstall => uninstall::run_uninstall()?,
        Commands::Login(login) => auth::login(login).await?,
        Commands::Logout => auth::logout()?,
        Commands::SetupAssistant => assistant::print_repo_instructions(),
        Commands::AiInstructions => assistant::print_ai_instructions(),
        Commands::Status(args) => core::status(args).await?,
        Commands::Grep(args) => core::grep(args).await?,
        Commands::TestHistory(args) => core::test_history(args).await?,
        Commands::SlowestTests(args) => core::slowest_tests(args).await?,
        Commands::SlowestJobs(args) => core::slowest_jobs(args).await?,
        Commands::Watch(args) => core::watch(args).await?,
        Commands::RunsList(args) => core::runs_list(args).await?,
        Commands::RunsShow(args) => core::runs_show(args).await?,
        Commands::RunsLogs(args) => core::runs_logs(args).await?,
        Commands::WorkflowsList(args) => core::workflows_list(args).await?,
        Commands::Setup => onboarding::run().await?,
        Commands::Init => init::run().await?,
        Commands::Telemetry(args) => task::spawn_blocking(move || telemetry::commands::run(args))
            .await??,
    }

    Ok(())
}
