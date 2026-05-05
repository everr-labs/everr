mod api;
mod auth;
mod cli;
mod core;
mod init;
mod onboarding;
mod skills;
mod telemetry;
mod uninstall;
mod wrap;

use anyhow::Result;
use clap::Parser;
use cli::{Cli, Commands};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Uninstall => uninstall::run_uninstall()?,
        Commands::Login(login) => auth::login(login).await?,
        Commands::Logout => auth::logout()?,
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
        Commands::Wrap(args) => wrap::run(args).await?,
        Commands::Setup => onboarding::run().await?,
        Commands::Init => init::run().await?,
        Commands::Telemetry(args) => telemetry::commands::run(args).await?,
        Commands::Skills(args) => skills::run(args)?,
    }

    Ok(())
}
