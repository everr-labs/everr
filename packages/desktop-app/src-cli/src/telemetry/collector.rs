use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use flate2::read::GzDecoder;
use nix::errno::Errno;
use nix::sys::signal::{Signal, kill};
use nix::unistd::Pid;
use tokio::process::{Child, Command};
use tokio::time::timeout;

use crate::cli::TelemetryStartArgs;

const COLLECTOR_BIN_NAME: &str = "everr-local-collector";
const CHDB_LIB_NAME: &str = "libchdb.so";
const SKIP_ORPHANED_COLLECTOR_KILL_ENV: &str = "EVERR_SKIP_ORPHANED_COLLECTOR_KILL";

#[cfg(everr_embedded_collector_assets)]
const COLLECTOR_GZ: &[u8] = include_bytes!(env!("EVERR_EMBEDDED_COLLECTOR_GZ"));
#[cfg(not(everr_embedded_collector_assets))]
const COLLECTOR_GZ: &[u8] = &[];

#[cfg(everr_embedded_collector_assets)]
const COLLECTOR_GZ_SHA256: &str = env!("EVERR_EMBEDDED_COLLECTOR_GZ_SHA256");
#[cfg(not(everr_embedded_collector_assets))]
const COLLECTOR_GZ_SHA256: &str = "";

#[cfg(everr_embedded_collector_assets)]
const CHDB_GZ: &[u8] = include_bytes!(env!("EVERR_EMBEDDED_CHDB_GZ"));
#[cfg(not(everr_embedded_collector_assets))]
const CHDB_GZ: &[u8] = &[];

#[cfg(everr_embedded_collector_assets)]
const CHDB_GZ_SHA256: &str = env!("EVERR_EMBEDDED_CHDB_GZ_SHA256");
#[cfg(not(everr_embedded_collector_assets))]
const CHDB_GZ_SHA256: &str = "";

#[derive(Debug)]
pub struct ExtractedAssets {
    pub collector: PathBuf,
    pub chdb_lib: PathBuf,
}

pub async fn run_start(args: TelemetryStartArgs) -> Result<()> {
    ensure_supported_platform()?;

    let telemetry_dir = everr_core::build::telemetry_dir()?;
    let config_path =
        everr_core::collector::write_config(&telemetry_dir).context("write collector config")?;
    let assets = extract_embedded_assets().context("extract embedded collector assets")?;

    kill_orphaned_collector();

    let mut child = spawn_collector(&assets, &config_path).await?;
    let health_endpoint = format!("http://127.0.0.1:{}/", everr_core::build::HEALTHCHECK_PORT);
    if !everr_core::collector::wait_healthcheck(&health_endpoint, Duration::from_secs(10)).await {
        if let Some(status) = child.try_wait().context("poll collector process")? {
            bail!("collector exited before it became ready: {status}");
        }
        terminate_child(&mut child).await;
        bail!(
            "collector healthcheck did not become ready; collector URL: {}",
            everr_core::build::otlp_http_origin()
        );
    }

    if !args.quiet {
        println!("{}", everr_core::build::otlp_http_origin());
    }

    tokio::select! {
        signal = wait_for_shutdown_signal() => {
            signal?;
            terminate_child(&mut child).await;
            Ok(())
        }
        status = child.wait() => {
            let status = status.context("wait for collector process")?;
            if status.success() {
                Ok(())
            } else {
                Err(anyhow!("collector exited: {status}"))
            }
        }
    }
}

async fn wait_for_shutdown_signal() -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

        let mut terminate =
            signal(SignalKind::terminate()).context("listen for SIGTERM shutdown signal")?;
        tokio::select! {
            signal = tokio::signal::ctrl_c() => {
                signal.context("listen for Ctrl+C shutdown signal")?;
            }
            _ = terminate.recv() => {}
        }
        Ok(())
    }

    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .context("listen for Ctrl+C shutdown signal")
    }
}

fn ensure_supported_platform() -> Result<()> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Ok(());
    }

    bail!("embedded local collector is currently supported only on macOS arm64");
}

async fn spawn_collector(assets: &ExtractedAssets, config_path: &Path) -> Result<Child> {
    let mut child = Command::new(&assets.collector)
        .arg("--config")
        .arg(config_path)
        .env("CHDB_LIB_PATH", &assets.chdb_lib)
        .env("TZ", "UTC")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("spawn {}", assets.collector.display()))?;

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(everr_core::collector::forward_output(
            stdout,
            "[collector stdout]",
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(everr_core::collector::forward_output(
            stderr,
            "[collector stderr]",
        ));
    }

    Ok(child)
}

async fn terminate_child(child: &mut Child) {
    let Some(pid) = child.id() else {
        let _ = child.kill().await;
        return;
    };

    match kill(Pid::from_raw(pid as i32), Signal::SIGTERM) {
        Ok(()) => {}
        Err(Errno::ESRCH) => return,
        Err(err) => {
            eprintln!("[collector] SIGTERM failed: {err}; hard-killing");
            let _ = child.kill().await;
            return;
        }
    }

    match timeout(Duration::from_secs(3), child.wait()).await {
        Ok(Ok(_)) => {}
        Ok(Err(err)) => eprintln!("[collector] wait after SIGTERM failed: {err}"),
        Err(_) => {
            eprintln!("[collector] did not exit within 3s of SIGTERM; hard-killing");
            let _ = child.kill().await;
        }
    }
}

fn kill_orphaned_collector() {
    if std::env::var(SKIP_ORPHANED_COLLECTOR_KILL_ENV)
        .ok()
        .as_deref()
        == Some("1")
    {
        return;
    }

    everr_core::collector::kill_processes_on_port(
        everr_core::build::HEALTHCHECK_PORT,
        "orphaned collector process",
    );
}

fn extract_embedded_assets() -> Result<ExtractedAssets> {
    let cache_root = dirs::cache_dir()
        .context("failed to resolve user cache directory")?
        .join(everr_core::build::session_namespace())
        .join("collector-assets");
    extract_assets_to_cache(
        &cache_root,
        COLLECTOR_GZ,
        CHDB_GZ,
        COLLECTOR_GZ_SHA256,
        CHDB_GZ_SHA256,
    )
}

fn extract_assets_to_cache(
    cache_root: &Path,
    collector_gz: &[u8],
    chdb_gz: &[u8],
    collector_hash: &str,
    chdb_hash: &str,
) -> Result<ExtractedAssets> {
    if collector_gz.is_empty()
        || chdb_gz.is_empty()
        || collector_hash.is_empty()
        || chdb_hash.is_empty()
    {
        bail!(
            "collector assets are not embedded in this CLI build; rebuild with `pnpm --dir packages/desktop-app build:cli:debug`"
        );
    }

    let asset_dir = cache_root.join(format!("{collector_hash}-{chdb_hash}"));
    let collector = asset_dir.join(COLLECTOR_BIN_NAME);
    let chdb_lib = asset_dir.join(CHDB_LIB_NAME);
    let marker = asset_dir.join(".complete");

    if marker.is_file() && collector.is_file() && chdb_lib.is_file() {
        set_permissions(&collector, 0o755)
            .with_context(|| format!("chmod {}", collector.display()))?;
        set_permissions(&chdb_lib, 0o644)
            .with_context(|| format!("chmod {}", chdb_lib.display()))?;
        prune_stale_asset_dirs(cache_root, &asset_dir)?;
        return Ok(ExtractedAssets {
            collector,
            chdb_lib,
        });
    }

    fs::create_dir_all(&asset_dir)
        .with_context(|| format!("create asset cache {}", asset_dir.display()))?;
    write_gzip_asset(collector_gz, &collector, 0o755)?;
    write_gzip_asset(chdb_gz, &chdb_lib, 0o644)?;
    fs::write(&marker, format!("{collector_hash}\n{chdb_hash}\n"))
        .with_context(|| format!("write {}", marker.display()))?;
    prune_stale_asset_dirs(cache_root, &asset_dir)?;

    Ok(ExtractedAssets {
        collector,
        chdb_lib,
    })
}

fn prune_stale_asset_dirs(cache_root: &Path, keep_dir: &Path) -> Result<()> {
    let entries = match fs::read_dir(cache_root) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err).with_context(|| format!("read {}", cache_root.display())),
    };

    for entry in entries {
        let entry = entry.with_context(|| format!("read {}", cache_root.display()))?;
        let path = entry.path();
        if path == keep_dir || !entry.file_type()?.is_dir() {
            continue;
        }
        fs::remove_dir_all(&path)
            .with_context(|| format!("remove stale asset cache {}", path.display()))?;
    }

    Ok(())
}

fn write_gzip_asset(bytes: &[u8], path: &Path, mode: u32) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("asset path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;

    let tmp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("asset"),
        std::process::id()
    ));
    let mut decoder = GzDecoder::new(bytes);
    {
        let mut file =
            fs::File::create(&tmp).with_context(|| format!("write {}", tmp.display()))?;
        io::copy(&mut decoder, &mut file)
            .with_context(|| format!("decompress {}", path.display()))?;
    }
    set_permissions(&tmp, mode)?;
    let _ = fs::remove_file(path);
    fs::rename(&tmp, path).with_context(|| format!("move {} into place", path.display()))?;
    Ok(())
}

#[cfg(unix)]
fn set_permissions(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(mode);
    fs::set_permissions(path, permissions)
}

#[cfg(not(unix))]
fn set_permissions(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::Compression;
    use flate2::write::GzEncoder;

    use super::*;

    #[test]
    fn extraction_requires_embedded_assets() {
        let dir = tempfile::tempdir().expect("tempdir");
        let err =
            extract_assets_to_cache(dir.path(), &[], &[], "", "").expect_err("missing assets");

        assert!(
            err.to_string()
                .contains("collector assets are not embedded")
        );
    }

    #[test]
    fn extraction_writes_assets_to_content_addressed_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let collector = gzip(b"collector bytes");
        let chdb = gzip(b"chdb bytes");

        let assets =
            extract_test_assets_to_cache(dir.path(), &collector, &chdb).expect("extract assets");

        assert_eq!(
            fs::read(&assets.collector).expect("collector"),
            b"collector bytes"
        );
        assert_eq!(fs::read(&assets.chdb_lib).expect("chdb"), b"chdb bytes");
        assert!(
            assets
                .collector
                .parent()
                .unwrap()
                .join(".complete")
                .is_file()
        );
    }

    #[test]
    fn changed_asset_bytes_use_a_new_cache_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first = extract_test_assets_to_cache(dir.path(), &gzip(b"one"), &gzip(b"lib"))
            .expect("first extract");
        let first_dir = first
            .collector
            .parent()
            .expect("first cache dir")
            .to_path_buf();
        let second = extract_test_assets_to_cache(dir.path(), &gzip(b"two"), &gzip(b"lib"))
            .expect("second extract");

        assert_ne!(Some(first_dir.as_path()), second.collector.parent());
        assert!(!first_dir.exists());
        assert_eq!(fs::read(second.collector).expect("collector"), b"two");
    }

    #[cfg(unix)]
    #[test]
    fn cache_hit_repairs_asset_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let collector = gzip(b"collector bytes");
        let chdb = gzip(b"chdb bytes");
        let first =
            extract_test_assets_to_cache(dir.path(), &collector, &chdb).expect("first extract");

        fs::set_permissions(&first.collector, fs::Permissions::from_mode(0o644))
            .expect("make collector non-executable");
        fs::set_permissions(&first.chdb_lib, fs::Permissions::from_mode(0o600))
            .expect("make chdb permissions stale");

        let second =
            extract_test_assets_to_cache(dir.path(), &collector, &chdb).expect("cache hit");

        assert_eq!(
            fs::metadata(second.collector)
                .expect("collector metadata")
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
        assert_eq!(
            fs::metadata(second.chdb_lib)
                .expect("chdb metadata")
                .permissions()
                .mode()
                & 0o777,
            0o644
        );
    }

    fn extract_test_assets_to_cache(
        cache_root: &Path,
        collector_gz: &[u8],
        chdb_gz: &[u8],
    ) -> Result<ExtractedAssets> {
        extract_assets_to_cache(
            cache_root,
            collector_gz,
            chdb_gz,
            &sha256_hex(collector_gz),
            &sha256_hex(chdb_gz),
        )
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(bytes).expect("write gzip");
        encoder.finish().expect("finish gzip")
    }
}
