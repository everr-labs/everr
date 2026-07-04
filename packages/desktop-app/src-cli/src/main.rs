mod api;
mod auth;
mod banner;
mod cli;
mod command_telemetry;
mod core;
mod init;
mod onboarding;
mod skills;
mod telemetry;
mod uninstall;
mod update_notice;
mod upgrade;
mod wrap;

#[cfg(test)]
mod test_support {
    pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
}

use anyhow::Result;
use clap::Parser;
use cli::{CiSubcommand, Cli, CloudSubcommand, Commands};

#[tokio::main]
async fn main() -> Result<()> {
    let argv: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let cli = Cli::parse_from(argv.clone());
    let telemetry = command_telemetry::init();
    let (command, subcommand) = command_telemetry::command_names(&cli);
    command_telemetry::record_invocation(&cli, argv);
    update_notice::maybe_print(&cli).await;

    let result = run_command(cli.command).await;
    command_telemetry::record_result(command, subcommand, &result);
    telemetry.shutdown();

    result
}

async fn run_command(command: Commands) -> Result<()> {
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
        Commands::Local(args) => telemetry::commands::run(args).await?,
        Commands::Wrap(args) => wrap::run(args).await?,
        Commands::Setup => onboarding::run().await?,
        Commands::Init => init::run().await?,
        Commands::Skills(args) => skills::run(args)?,
        Commands::Apply(args) => core::run_apply(args).await?,
    }

    Ok(())
}
