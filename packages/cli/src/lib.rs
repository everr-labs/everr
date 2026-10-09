pub mod api;
pub mod apply;
pub mod auth;
mod banner;
pub mod build;
pub mod cli;
pub mod collector;
pub mod command_telemetry;
mod commands;
mod core;
pub mod datemath;
pub mod device_auth;
pub mod git;
mod init;
mod onboarding;
pub mod skill_store;
mod skills;
pub mod state;
pub mod telemetry;
mod uninstall;
pub mod update_notice;
pub mod upgrade;
mod wrap;

pub use commands::run_command;

#[cfg(test)]
mod test_support {
    pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
}
