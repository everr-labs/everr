use anyhow::Result;

use crate::cli::{CiSubcommand, Cli, CloudSubcommand, Commands};
use crate::profiles::client;
use crate::{auth, core, skills, telemetry, uninstall, upgrade, wrap};

pub async fn run_command(cli: Cli, lifetime: &mut telemetry::SupervisorLifetime) -> Result<()> {
    let profile = cli.profile.as_deref();
    match cli.command {
        Commands::Login(args) => auth::login(args, profile).await?,
        Commands::Logout => auth::logout(profile).await?,
        Commands::Whoami(args) => auth::whoami(args, profile).await?,
        Commands::Query(args) => core::cloud_query(args, client(profile, false).await?).await?,
        Commands::Profiles(args) => auth::profiles(args.command)?,
        Commands::Uninstall => uninstall::run_uninstall()?,
        Commands::Upgrade => upgrade::run().await?,
        Commands::Cloud(args) => match args.command {
            CloudSubcommand::Login(login) => auth::login(login, profile).await?,
            CloudSubcommand::Logout => auth::logout(profile).await?,
            CloudSubcommand::Status => auth::status(profile).await?,
            CloudSubcommand::Query(args) => {
                core::cloud_query(args, client(profile, false).await?).await?
            }
        },
        Commands::Ci(args) => match args.command {
            CiSubcommand::Status(args) => core::status(args, client(profile, false).await?).await?,
            CiSubcommand::Watch(args) => core::watch(args, client(profile, false).await?).await?,
            CiSubcommand::Runs(args) => {
                core::runs_list(args, client(profile, false).await?).await?
            }
            CiSubcommand::Show(args) => {
                core::runs_show(args, client(profile, false).await?).await?
            }
            CiSubcommand::Logs(args) => {
                core::runs_logs(args, client(profile, false).await?).await?
            }
        },
        Commands::Local(args) => telemetry::commands::run(args, lifetime, profile).await?,
        Commands::Wrap(args) => wrap::run(args).await?,
        Commands::Skills(args) => skills::run(args)?,
        Commands::Apply(args) => core::run_apply(args, client(profile, true).await?).await?,
        Commands::Resources(args) => {
            core::run_resources(args.command, client(profile, false).await?).await?
        }
    }

    Ok(())
}
