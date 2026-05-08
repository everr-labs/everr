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
use cli::{CiSubcommand, Cli, CloudSubcommand, Commands};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Uninstall => uninstall::run_uninstall()?,
        Commands::Cloud(args) => match args.command {
            CloudSubcommand::Login(login) => auth::login(login).await?,
            CloudSubcommand::Logout => auth::logout()?,
            CloudSubcommand::Query(args) => core::cloud_query(args).await?,
        },
        Commands::Ci(args) => match args.command {
            CiSubcommand::Status(args) => core::status(args).await?,
            CiSubcommand::Watch(args) => core::watch(args).await?,
            CiSubcommand::Runs(args) => core::runs_list(args).await?,
            CiSubcommand::Show(args) => core::runs_show(args).await?,
            CiSubcommand::Logs(args) => core::runs_logs(args).await?,
            CiSubcommand::Grep(args) => core::grep(args).await?,
        },
        Commands::Local(args) => telemetry::commands::run(args).await?,
        Commands::Wrap(args) => wrap::run(args).await?,
        Commands::Setup => onboarding::run().await?,
        Commands::Init => init::run().await?,
        Commands::Skills(args) => skills::run(args)?,
    }

    Ok(())
}
