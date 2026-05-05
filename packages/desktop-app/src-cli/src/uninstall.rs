use std::env;
use std::io::{self, Write};
use std::path::Path;

use anyhow::{Context, Result};

use crate::auth;

pub fn run_uninstall() -> Result<()> {
    let cli_path = env::current_exe().context("failed to resolve current executable path")?;

    print_uninstall_effects(&cli_path);
    wait_for_enter()?;

    auth::state_store().wipe()?;

    println!();
    println!("To remove the CLI binary, run:");
    println!("  rm \"{}\"", cli_path.display());

    Ok(())
}

fn print_uninstall_effects(cli_path: &Path) {
    println!("The uninstall command will:");
    println!("- Removes all local Everr state (session, settings, notification emails).");
    println!(
        "- Does not remove the CLI binary automatically: {}",
        cli_path.display()
    );
    println!();
    println!("Press Enter to continue, or Ctrl+C to abort.");
}

fn wait_for_enter() -> Result<()> {
    io::stdout().flush().context("failed to flush stdout")?;
    let mut input = String::new();
    let _ = io::stdin()
        .read_line(&mut input)
        .context("failed to read uninstall confirmation")?;
    Ok(())
}
