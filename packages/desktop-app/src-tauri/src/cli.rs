use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

fn install_cli_from_path(source_path: &Path, install_path: &Path) -> Result<()> {
    if let Some(parent) = install_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    fs::copy(source_path, install_path).with_context(|| {
        format!(
            "failed to copy bundled CLI from {} to {}",
            source_path.display(),
            install_path.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let metadata = fs::metadata(install_path)
            .with_context(|| format!("failed to read {}", install_path.display()))?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(install_path, permissions)
            .with_context(|| format!("failed to chmod {}", install_path.display()))?;
    }

    Ok(())
}

pub(crate) fn sync_installed_cli(app: &AppHandle) -> Result<bool> {
    let bin_name = if tauri::is_dev() {
        "everr-dev"
    } else {
        "everr"
    };
    let install_path = cli_install_path(bin_name)?;
    if !install_path.exists() {
        return Ok(false);
    }

    let bundled_cli_path = bundled_cli_path(app)?;
    sync_installed_cli_from_paths(&bundled_cli_path, &install_path)
}

pub(crate) fn sync_installed_cli_from_paths(
    bundled_cli_path: &Path,
    install_path: &Path,
) -> Result<bool> {
    if !install_path.exists() {
        install_cli_from_path(bundled_cli_path, install_path)?;
        return Ok(true);
    }

    if cli_sha256(bundled_cli_path)? == cli_sha256(install_path)? {
        return Ok(false);
    }

    install_cli_from_path(bundled_cli_path, install_path)?;
    Ok(true)
}

fn cli_sha256(path: &Path) -> Result<[u8; 32]> {
    let mut file =
        fs::File::open(path).with_context(|| format!("failed to open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("failed to read {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hasher.finalize().into())
}

fn cli_install_path(bin_name: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().context("failed to resolve home directory")?;
    Ok(home.join(".local").join("bin").join(bin_name))
}

fn bundled_cli_path(app: &AppHandle) -> Result<PathBuf> {
    let resource_dir = app
        .path()
        .resource_dir()
        .context("failed to resolve app resource directory")?;
    let direct = resource_dir.join("everr");
    if direct.exists() {
        return Ok(direct);
    }

    Err(anyhow!(
        "bundled CLI resource not found in {}",
        resource_dir.display()
    ))
}
