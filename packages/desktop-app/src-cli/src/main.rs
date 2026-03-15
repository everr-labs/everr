mod api;
mod assistant;
mod auth;
mod cli;
mod core;
mod install;
mod uninstall;

use anyhow::Result;
use clap::Parser;
use cli::{Cli, Commands, RunsCommand};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Install => install::run_install_wizard().await?,
        Commands::Uninstall => uninstall::run_uninstall()?,
        Commands::Login(login) => auth::login(login).await?,
        Commands::Logout => auth::logout()?,
        Commands::SetupAssistant(init) => assistant::init_from_args(init)?,
        Commands::Status(args) => core::status(args).await?,
        Commands::Grep(args) => core::grep(args).await?,
        Commands::TestHistory(args) => core::test_history(args).await?,
        Commands::SlowestTests(args) => core::slowest_tests(args).await?,
        Commands::SlowestJobs(args) => core::slowest_jobs(args).await?,
        Commands::Watch(args) => core::watch(args).await?,
        Commands::Runs { command } => match command {
            RunsCommand::List(args) => core::runs_list(args).await?,
            RunsCommand::Show(args) => core::runs_show(args).await?,
            RunsCommand::Logs(args) => core::runs_logs(args).await?,
        },
    }

    Ok(())
}
