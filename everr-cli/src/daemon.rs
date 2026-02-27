use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result};

const LAUNCHD_LABEL: &str = "dev.everr.daemon";

pub struct DaemonInstallResult {
    pub service_path: PathBuf,
    pub installed_now: bool,
    pub started: bool,
}

pub fn install_if_missing() -> Result<DaemonInstallResult> {
    let service_path = service_file_path()?;
    if service_path.exists() {
        let already_loaded = is_service_loaded();
        let started = if already_loaded {
            true
        } else {
            start_service(&service_path)
        };
        return Ok(DaemonInstallResult {
            service_path,
            installed_now: false,
            started,
        });
    }

    if let Some(parent) = service_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let exe = env::current_exe().context("failed to resolve current executable")?;
    let service = render_service_file(exe.to_string_lossy().as_ref());
    fs::write(&service_path, service)
        .with_context(|| format!("failed to write {}", service_path.display()))?;

    let started = start_service(&service_path);
    Ok(DaemonInstallResult {
        service_path,
        installed_now: true,
        started,
    })
}

pub fn uninstall() -> Result<()> {
    let service_path = service_file_path()?;
    if !service_path.exists() {
        println!("daemon: service is not installed");
        return Ok(());
    }

    let stopped = stop_service(&service_path);
    fs::remove_file(&service_path)
        .with_context(|| format!("failed to remove {}", service_path.display()))?;

    if stopped {
        println!("daemon: stopped and removed {}", service_path.display());
    } else {
        println!(
            "daemon: removed {} (stop command failed or unsupported)",
            service_path.display()
        );
    }
    Ok(())
}

pub fn is_service_installed() -> Result<bool> {
    Ok(service_file_path()?.exists())
}

pub fn service_path() -> Result<PathBuf> {
    service_file_path()
}

pub fn stop_if_installed() -> Result<bool> {
    let service_path = service_file_path()?;
    if !service_path.exists() {
        return Ok(false);
    }
    Ok(stop_service(&service_path))
}

fn service_file_path() -> Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().context("failed to resolve home dir")?;
        return Ok(home
            .join("Library")
            .join("LaunchAgents")
            .join("dev.everr.daemon.plist"));
    }

    #[cfg(not(target_os = "macos"))]
    {
        anyhow::bail!("daemon service install is currently supported only on macOS");
    }
}

fn render_service_file(exe_path: &str) -> String {
    #[cfg(target_os = "macos")]
    {
        return format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>dev.everr.daemon</string>
    <key>ProgramArguments</key>
    <array>
      <string>{exe_path}</string>
      <string>notify</string>
      <string>daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
  </dict>
</plist>
"#
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        String::new()
    }
}

fn start_service(service_path: &PathBuf) -> bool {
    #[cfg(target_os = "macos")]
    {
        if is_service_loaded() {
            return true;
        }
        let output = Command::new("launchctl")
            .arg("load")
            .arg("-w")
            .arg(service_path)
            .output();
        return output.is_ok_and(|result| result.status.success());
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn stop_service(service_path: &PathBuf) -> bool {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("launchctl")
            .arg("unload")
            .arg("-w")
            .arg(service_path)
            .output();
        return output.is_ok_and(|result| result.status.success());
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn is_service_loaded() -> bool {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("launchctl")
            .arg("list")
            .arg(LAUNCHD_LABEL)
            .output();
        return output.is_ok_and(|result| result.status.success());
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
