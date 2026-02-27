mod api;
mod assistant;
mod auth;
mod cli;
mod core;
mod install;

use anyhow::Result;
use clap::Parser;
use cli::{AuthCommand, Cli, Commands, RunsCommand};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Install => install::run_install_wizard().await?,
        Commands::Uninstall => {
            assistant::remove_managed_prompts()?;
        }
        Commands::Auth { command } => match command {
            AuthCommand::Login(login) => auth::login(login).await?,
            AuthCommand::Logout => auth::logout()?,
        },
        Commands::Assistant { command } => match command {
            cli::AssistantCommand::Init(init) => assistant::init_from_args(init)?,
        },
        Commands::Context => core::context()?,
        Commands::Status(args) => core::status(args).await?,
        Commands::Runs { command } => match command {
            RunsCommand::List(args) => core::runs_list(args).await?,
            RunsCommand::Show(args) => core::runs_show(args).await?,
            RunsCommand::Logs(args) => core::runs_logs(args).await?,
        },
    }

    Ok(())
}
