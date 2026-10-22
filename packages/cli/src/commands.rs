use anyhow::Result;

use crate::auth::client;
use crate::cli::{CiSubcommand, CloudSubcommand, Commands};
use crate::{auth, core, skills, telemetry, uninstall, upgrade, wrap};

pub async fn run_command(
    command: Commands,
    lifetime: &mut telemetry::SupervisorLifetime,
) -> Result<()> {
    match command {
        Commands::Uninstall => uninstall::run_uninstall()?,
        Commands::Upgrade => upgrade::run().await?,
        Commands::Cloud(args) => match args.command {
            CloudSubcommand::Login(login) => auth::login(login).await?,
            CloudSubcommand::Logout => auth::logout().await?,
            CloudSubcommand::Status(args) => auth::status(args).await?,
            CloudSubcommand::Query(args) => core::cloud_query(args, client(false)?).await?,
        },
        Commands::Ci(args) => match args.command {
            CiSubcommand::Status(args) => core::status(args, client(false)?).await?,
            CiSubcommand::Watch(args) => core::watch(args, client(false)?).await?,
            CiSubcommand::Runs(args) => core::runs_list(args, client(false)?).await?,
            CiSubcommand::Show(args) => core::runs_show(args, client(false)?).await?,
            CiSubcommand::Logs(args) => core::runs_logs(args, client(false)?).await?,
        },
        Commands::Local(args) => telemetry::commands::run(args, lifetime).await?,
        Commands::Wrap(args) => wrap::run(args).await?,
        Commands::Skills(args) => skills::run(args)?,
        Commands::Apply(args) => core::run_apply(args, client(true)?).await?,
        Commands::Resources(args) => core::run_resources(args.command, client(false)?).await?,
    }

    Ok(())
}
