pub mod api;
pub mod apply;
pub mod auth;
pub mod build;
pub mod cli;
pub mod collector;
pub mod command_telemetry;
pub mod datemath;
pub mod device_auth;
pub mod git;
pub mod skill_store;
pub mod state;
pub mod telemetry;
pub mod update_notice;
pub mod upgrade;

#[cfg(test)]
mod test_support {
    pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
}
