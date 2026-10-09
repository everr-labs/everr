use anyhow::Result;

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
            CloudSubcommand::Logout => auth::logout()?,
            CloudSubcommand::Query(args) => core::cloud_query(args).await?,
        },
        Commands::Ci(args) => match args.command {
            CiSubcommand::Status(args) => core::status(args).await?,
            CiSubcommand::Watch(args) => core::watch(args).await?,
            CiSubcommand::Runs(args) => core::runs_list(args).await?,
            CiSubcommand::Show(args) => core::runs_show(args).await?,
            CiSubcommand::Logs(args) => core::runs_logs(args).await?,
        },
        Commands::Local(args) => telemetry::commands::run(args, lifetime).await?,
        Commands::Wrap(args) => wrap::run(args).await?,
        Commands::Skills(args) => skills::run(args)?,
        Commands::Apply(args) => core::run_apply(args).await?,
        Commands::Resources(args) => core::run_resources(args.command).await?,
    }

    Ok(())
}
