pub mod auth;
pub mod cli;
pub mod command_telemetry;
pub mod telemetry;
pub mod update_notice;
pub mod upgrade;

#[cfg(test)]
mod test_support {
    pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
}
