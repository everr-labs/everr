use std::{
    fs::{self, File, OpenOptions},
    os::unix::process::CommandExt,
    path::Path,
    process::Stdio,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use fs2::FileExt;
use tokio::{io::AsyncReadExt, process::Command};

use super::{
    collector::terminate_child,
    local_instance::{LocalStatus, ServiceState},
    local_log,
    local_server::StopLocalArgs,
};
use crate::build;

pub(super) const BACKGROUND_INSTANCE_ID: &str = "EVERR_LOCAL_BACKGROUND_INSTANCE_ID";

pub(super) fn new_instance_id() -> Result<String> {
    Ok(format!(
        "{:x}-{:x}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    ))
}

pub(super) fn lock(telemetry_dir: &Path) -> Result<File> {
    fs::create_dir_all(telemetry_dir).context("create telemetry directory")?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(telemetry_dir.join("local.lock"))?;
    file.try_lock_exclusive()
        .context("cannot start Everr: another instance is using this telemetry directory")?;
    Ok(file)
}

pub(super) async fn start_detached() -> Result<()> {
    let log_path = local_log::path()?;
    let instance_id = new_instance_id()?;
    let mut command = Command::new(std::env::current_exe()?);
    command
        .args(["local", "start", "--no-open"])
        .env(BACKGROUND_INSTANCE_ID, &instance_id)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    // The child must leave the terminal's session before running the supervisor.
    // setsid is async-signal-safe; no allocation or runtime work belongs here.
    unsafe {
        command.as_std_mut().pre_exec(|| {
            nix::unistd::setsid()
                .map(|_| ())
                .map_err(std::io::Error::from)
        });
    }
    let mut child = command.spawn().context("start Everr in the background")?;
    let deadline = Instant::now() + Duration::from_secs(20);
    let failure = loop {
        let status = LocalStatus::inspect().await;
        if status
            .running_instance()
            .is_some_and(|identity| identity.instance_id == instance_id)
        {
            return Ok(());
        }
        if let Some(exit) = child.try_wait()? {
            // A concurrent start may have found an already-ready instance.
            if exit.success() && status.running_instance().is_some() {
                return Ok(());
            }
            break format!("background process exited: {exit}");
        }
        if Instant::now() >= deadline {
            break "background startup did not become ready".to_string();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    terminate_child(&mut child).await;
    let mut output = Vec::new();
    if let Some(stderr) = child.stderr.take() {
        stderr.take(8192).read_to_end(&mut output).await?;
    }
    let output = if output.is_empty() {
        local_log::tail(&log_path).unwrap_or_default()
    } else {
        String::from_utf8_lossy(&output).into_owned()
    };
    bail!("{failure}; log: {}\n{}", log_path.display(), output.trim());
}

pub(super) async fn stop() -> Result<()> {
    let status = LocalStatus::inspect().await;
    if status.stopped() {
        println!("Everr is already stopped");
        return Ok(());
    }
    let ServiceState::Running(identity) = &status.ui else {
        bail!("cannot stop Everr: local UI is {}", status.ui.description());
    };
    if let ServiceState::Running(collector) = &status.collector {
        if collector.instance_id != identity.instance_id {
            bail!("cannot stop Everr: collector and UI do not belong to the same instance");
        }
    }
    let origin = build::local_ui_origin();
    let response = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()?
        .post(format!("{origin}/api/commands/stop_local"))
        .header("origin", &origin)
        .header("x-everr-local", "1")
        .json(&StopLocalArgs {
            instance_id: identity.instance_id.clone(),
        })
        .send()
        .await
        .context("request local shutdown")?;
    let code = response.status();
    if !code.is_success() {
        bail!("local shutdown failed ({code}): {}", response.text().await?);
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if LocalStatus::inspect().await.stopped() {
            println!("Everr stopped");
            return Ok(());
        }
        if Instant::now() >= deadline {
            bail!("local shutdown did not complete; check `everr local status`");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_lock_excludes_another_owner_and_can_be_reused_after_exit() {
        let dir = tempfile::tempdir().unwrap();
        let first = lock(dir.path()).unwrap();
        assert!(lock(dir.path()).is_err());
        drop(first);
        assert!(lock(dir.path()).is_ok());
    }
}
