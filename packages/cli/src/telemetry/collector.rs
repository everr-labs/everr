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

use super::{local_lifecycle, local_server::SupervisorRequest};
use crate::cli::TelemetryStartArgs;

const COLLECTOR_BIN_NAME: &str = "everr-local-collector";
const CHDB_LIB_NAME: &str = "libchdb.so";

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

pub async fn run_start(
    args: TelemetryStartArgs,
    lifetime: &mut local_lifecycle::SupervisorLifetime,
) -> Result<()> {
    ensure_supported_platform()?;

    let status = super::local_instance::LocalStatus::inspect().await;
    if status.running_instance().is_some() {
        if !args.quiet {
            print_endpoints();
        }
        open_ui(&args);
        return Ok(());
    }
    status.require_stopped()?;
    if args.detach {
        local_lifecycle::start_detached().await?;
        if !args.quiet {
            print_endpoints();
            println!("log: {}", super::local_log::path()?.display());
        }
        open_ui(&args);
        return Ok(());
    }
    let telemetry_dir = crate::build::telemetry_dir()?;
    lifetime.acquire(&telemetry_dir)?;
    super::local_instance::require_free_port(&crate::build::sql_http_origin()).await?;
    super::local_instance::require_free_port(&crate::build::otlp_http_origin()).await?;
    let instance_id = std::env::var(local_lifecycle::BACKGROUND_INSTANCE_ID)
        .unwrap_or(local_lifecycle::new_instance_id()?);

    let (supervisor_tx, mut supervisor_rx) = tokio::sync::mpsc::channel(1);
    let ui = super::local_server::LocalServer::bind(supervisor_tx, instance_id.clone()).await?;
    let assets = extract_embedded_assets().context("extract embedded collector assets")?;

    let child = start_collector(&assets, &telemetry_dir, &instance_id).await?;

    if !args.quiet {
        print_endpoints();
    }

    let mut child = Some(child);
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let mut server = tokio::task::JoinSet::new();
    server.spawn(ui.serve(shutdown_rx));
    let shutdown = wait_for_shutdown_signal();
    tokio::pin!(shutdown);
    open_ui(&args);
    let mut stop_reply = None;
    let result = loop {
        tokio::select! {
            result = server.join_next() => {
                break result.context("local UI task stopped")
                    .and_then(|joined| joined.context("local UI task failed"))
                    .and_then(|served| served);
            }
            Some(request) = supervisor_rx.recv() => {
                let reply = match request {
                    SupervisorRequest::Stop(reply) => {
                        stop_reply = Some(reply);
                        break Ok(());
                    }
                    SupervisorRequest::Restart(reply) => reply,
                };
                let result = restart_collector(
                    &mut child,
                    extract_embedded_assets(),
                    &telemetry_dir,
                    &instance_id,
                ).await;
                let _ = reply.send(result.map_err(|error| format!("{error:#}")));
            }
            signal = &mut shutdown => {
                break signal;
            }
            status = wait_collector(&mut child) => {
                child = None;
                eprintln!("Collector stopped: {status:?}. Restart it from the local UI.");
            }
        }
    };
    stop_collector(&mut child).await;
    if let Some(reply) = stop_reply {
        let _ = reply.send(Ok(()));
    }
    let _ = shutdown_tx.send(());
    if !server.is_empty() {
        if let Ok(Some(joined)) = timeout(Duration::from_secs(5), server.join_next()).await {
            joined.context("local UI task failed")??;
        } else {
            server.shutdown().await;
        }
    }
    result
}

async fn wait_collector(child: &mut Option<Child>) -> io::Result<std::process::ExitStatus> {
    match child {
        Some(child) => child.wait().await,
        None => std::future::pending().await,
    }
}

async fn stop_collector(child: &mut Option<Child>) {
    if let Some(mut child) = child.take() {
        terminate_child(&mut child).await;
    }
}

async fn restart_collector(
    child: &mut Option<Child>,
    assets: Result<ExtractedAssets>,
    telemetry_dir: &Path,
    instance_id: &str,
) -> Result<()> {
    // Another CLI build may have pruned this build's cached assets.
    // Restore them before stopping the collector so extraction failure leaves it running.
    let assets = assets.context("extract embedded collector assets for restart")?;
    stop_collector(child).await;
    *child = Some(start_collector(&assets, telemetry_dir, instance_id).await?);
    Ok(())
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
    if cfg!(all(
        target_os = "linux",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )) {
        return Ok(());
    }

    bail!(
        "embedded local collector is currently supported only on macOS arm64 and Linux arm64/x86_64"
    );
}

async fn start_collector(
    assets: &ExtractedAssets,
    telemetry_dir: &Path,
    instance_id: &str,
) -> Result<Child> {
    let chdb_path = telemetry_dir.join("chdb");
    fs::create_dir_all(&chdb_path)
        .with_context(|| format!("create chdb dir {}", chdb_path.display()))?;
    let otlp_endpoint = crate::build::otlp_http_origin();
    let sql_endpoint = crate::build::sql_http_origin();

    let mut child = Command::new(&assets.collector)
        .arg("--otlp-http-endpoint")
        .arg(&otlp_endpoint)
        .arg("--sql-http-endpoint")
        .arg(&sql_endpoint)
        .arg("--chdb-path")
        .arg(&chdb_path)
        .arg("--ttl")
        .arg("7d")
        .env("EVERR_LOCAL_INSTANCE_ID", instance_id)
        .env("EVERR_LOCAL_VERSION", env!("EVERR_VERSION"))
        .env("CHDB_LIB_PATH", &assets.chdb_lib)
        .env("TZ", "UTC")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("spawn {}", assets.collector.display()))?;

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(crate::collector::forward_output(
            stdout,
            "[collector stdout]",
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(crate::collector::forward_output(
            stderr,
            "[collector stderr]",
        ));
    }

    if !crate::collector::wait_for_collector(
        &crate::build::healthcheck_endpoint(),
        instance_id,
        Duration::from_secs(10),
    )
    .await
    {
        if let Some(status) = child.try_wait().context("poll collector process")? {
            bail!("collector exited before it became ready: {status}");
        }
        terminate_child(&mut child).await;
        bail!(
            "collector healthcheck did not become ready; collector URL: {}",
            crate::build::otlp_http_origin()
        );
    }

    Ok(child)
}

pub(super) async fn terminate_child(child: &mut Child) {
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

fn print_endpoints() {
    println!("otlp: {}", crate::build::otlp_http_origin());
    println!("sql: {}", crate::build::sql_http_origin());
    println!("ui: {}", crate::build::local_ui_origin());
}

fn open_ui(args: &TelemetryStartArgs) {
    if !args.no_open && !args.quiet {
        if let Err(error) = webbrowser::open(&crate::build::local_ui_origin()) {
            eprintln!("Could not open the local UI: {error}");
        }
    }
}

fn extract_embedded_assets() -> Result<ExtractedAssets> {
    let cache_root = dirs::cache_dir()
        .context("failed to resolve user cache directory")?
        .join(crate::build::session_namespace())
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
            "collector assets are not embedded in this CLI build; rebuild with `pnpm --filter @everr/cli build:debug`"
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

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_restart_extraction_keeps_collector_running() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut child = Some(
            Command::new("sleep")
                .arg("60")
                .kill_on_drop(true)
                .spawn()
                .expect("spawn collector"),
        );
        let original_pid = child.as_ref().unwrap().id().expect("collector PID");
        let assets = extract_assets_to_cache(dir.path(), &[], &[], "", "");
        let result = restart_collector(&mut child, assets, dir.path(), "restart-test").await;
        let retained_pid = child.as_ref().and_then(Child::id);
        let still_running = child
            .as_mut()
            .is_some_and(|child| child.try_wait().expect("poll collector").is_none());
        stop_collector(&mut child).await;

        assert!(
            result
                .expect_err("extraction must fail")
                .to_string()
                .contains("extract embedded collector assets for restart")
        );
        assert_eq!(retained_pid, Some(original_pid));
        assert!(still_running);
    }

    #[cfg(unix)]
    #[test]
    fn restart_restores_assets_pruned_by_another_build() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let mut server = mockito::Server::new();
        server
            .mock("GET", "/health")
            .with_status(200)
            .with_body(
                serde_json::json!({
                    "service": "everr-local-collector",
                    "version": env!("EVERR_VERSION"),
                    "instance_id": "restart-test",
                    "protocol_version": 1,
                    "status": "ok",
                })
                .to_string(),
            )
            .create();
        let _guard = crate::test_support::ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = std::env::var_os("EVERR_SQL_HTTP_ORIGIN");
        unsafe {
            std::env::set_var("EVERR_SQL_HTTP_ORIGIN", server.url());
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let collector = gzip(b"#!/bin/sh\nexec sleep 60\n");
        let chdb = gzip(b"chdb bytes");
        let first = extract_test_assets_to_cache(&cache, &collector, &chdb).expect("first extract");
        let result = runtime.block_on(async {
            let mut child = Some(
                start_collector(&first, dir.path(), "restart-test")
                    .await
                    .expect("start collector"),
            );
            let original_pid = child.as_ref().unwrap().id().expect("collector PID");
            extract_test_assets_to_cache(&cache, &gzip(b"another build"), &chdb)
                .expect("extract another build");
            assert!(!first.collector.exists());
            assert!(!first.chdb_lib.exists());

            let assets = extract_test_assets_to_cache(&cache, &collector, &chdb);
            let result = restart_collector(&mut child, assets, dir.path(), "restart-test").await;
            let restarted_pid = child.as_ref().and_then(Child::id);
            stop_collector(&mut child).await;
            result.map(|()| (original_pid, restarted_pid))
        });
        match previous {
            Some(value) => unsafe {
                std::env::set_var("EVERR_SQL_HTTP_ORIGIN", value);
            },
            None => unsafe {
                std::env::remove_var("EVERR_SQL_HTTP_ORIGIN");
            },
        }

        let (original_pid, restarted_pid) = result.expect("restart from restored assets");
        assert!(restarted_pid.is_some());
        assert_ne!(restarted_pid, Some(original_pid));
        assert_eq!(
            kill(Pid::from_raw(original_pid as i32), None),
            Err(Errno::ESRCH)
        );
        assert_eq!(
            fs::read(first.collector).expect("restored collector"),
            b"#!/bin/sh\nexec sleep 60\n"
        );
        assert_eq!(
            fs::read(first.chdb_lib).expect("restored chdb"),
            b"chdb bytes"
        );
    }

    #[cfg(unix)]
    #[test]
    fn unready_collector_is_terminated_before_start_returns() {
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let mut server = mockito::Server::new();
        server.mock("GET", "/health").with_status(503).create();
        let _guard = crate::test_support::ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = std::env::var_os("EVERR_SQL_HTTP_ORIGIN");
        unsafe {
            std::env::set_var("EVERR_SQL_HTTP_ORIGIN", server.url());
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let collector = dir.path().join("collector");
        fs::write(
            &collector,
            "#!/bin/sh\necho $$ > \"$6/../collector.pid\"\nexec sleep 60\n",
        )
        .expect("write unready collector");
        set_permissions(&collector, 0o755).expect("make collector executable");
        let assets = ExtractedAssets {
            collector,
            chdb_lib: dir.path().join("libchdb.so"),
        };

        let result = runtime.block_on(start_collector(&assets, dir.path(), "unready-test"));
        match previous {
            Some(value) => unsafe {
                std::env::set_var("EVERR_SQL_HTTP_ORIGIN", value);
            },
            None => unsafe {
                std::env::remove_var("EVERR_SQL_HTTP_ORIGIN");
            },
        }

        assert!(
            result
                .expect_err("collector must fail readiness")
                .to_string()
                .contains("collector healthcheck did not become ready")
        );
        let pid = fs::read_to_string(dir.path().join("collector.pid"))
            .expect("collector was spawned")
            .trim()
            .parse::<i32>()
            .expect("collector PID");
        assert_eq!(kill(Pid::from_raw(pid), None), Err(Errno::ESRCH));
    }

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
