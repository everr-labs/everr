use std::io::Write;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use semver::Version;
use sha2::{Digest, Sha256};

use crate::update_notice;

const DOWNLOAD_PATH_PREFIX: &str = "/everr-app";
const METADATA_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(30);
const FALLBACK_COMMAND: &str = "curl -fsSL https://everr.dev/upgrade.sh | bash";
const DOWNLOAD_BASE_URL_OVERRIDE_ENV: &str = "EVERR_DOWNLOAD_BASE_URL_FOR_TESTS";

pub async fn run() -> Result<()> {
    let current = Version::parse(env!("EVERR_VERSION")).context("parse current CLI version")?;
    let latest = fetch_latest_version().await?;

    if latest <= current {
        println!("Already up to date (v{current})");
        return Ok(());
    }

    let binary_name = release_binary_name()?;
    let base = download_base_url()?;
    let client = download_client()?;
    println!("Downloading Everr CLI v{latest}...");
    let (binary, checksum_file) = futures_util::try_join!(
        download_bytes(&client, format!("{base}/{binary_name}")),
        download_bytes(&client, format!("{base}/{binary_name}.sha256")),
    )?;
    verify_sha256(&binary, &checksum_file)?;
    replace_current_exe(&binary)?;
    println!("Upgraded everr v{current} → v{latest}");
    Ok(())
}

async fn fetch_latest_version() -> Result<Version> {
    let raw = update_notice::fetch_latest_version(METADATA_TIMEOUT).await?;
    Version::parse(&raw).with_context(|| format!("parse latest version {raw:?}"))
}

/// Same platform → artifact mapping as packages/docs/public/install.sh.
pub fn release_binary_name() -> Result<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("everr"),
        ("linux", "aarch64") => Ok("everr-linux-arm64"),
        ("linux", "x86_64") => Ok("everr-linux-x86_64"),
        (os, arch) => bail!("everr upgrade does not support {os} {arch}. Use: {FALLBACK_COMMAND}"),
    }
}

/// Debug builds refuse to hit the production artifacts: replacing
/// target/debug/everr with a release binary silently corrupts the dev
/// workflow. Tests point this at a mock server via the override env.
fn download_base_url() -> Result<String> {
    if cfg!(debug_assertions) {
        let url = std::env::var(DOWNLOAD_BASE_URL_OVERRIDE_ENV).unwrap_or_default();
        if url.trim().is_empty() {
            bail!(
                "refusing to self-update a debug build; set {DOWNLOAD_BASE_URL_OVERRIDE_ENV} or use a release binary"
            );
        }
        return Ok(url);
    }

    Ok(format!(
        "{}{}",
        everr_core::build::default_docs_base_url(),
        DOWNLOAD_PATH_PREFIX
    ))
}

fn download_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
        .read_timeout(DOWNLOAD_READ_TIMEOUT)
        .build()
        .context("build download client")
}

async fn download_bytes(client: &reqwest::Client, url: String) -> Result<Vec<u8>> {
    let response = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?
        .error_for_status()
        .with_context(|| format!("GET {url}"))?;
    Ok(response
        .bytes()
        .await
        .with_context(|| format!("read {url}"))?
        .to_vec())
}

/// The checksum file is `<hex>  <filename>`, as produced by `shasum -a 256`.
fn verify_sha256(binary: &[u8], checksum_file: &[u8]) -> Result<()> {
    let checksum_file =
        std::str::from_utf8(checksum_file).context("checksum file is not utf-8")?;
    let expected = checksum_file
        .split_whitespace()
        .next()
        .context("checksum file is empty")?
        .to_ascii_lowercase();
    let actual = format!("{:x}", Sha256::digest(binary));
    if actual != expected {
        bail!("checksum mismatch for downloaded binary: expected {expected}, got {actual}");
    }
    Ok(())
}

fn replace_current_exe(binary: &[u8]) -> Result<()> {
    let exe = std::env::current_exe().context("resolve current executable path")?;
    let dir = exe.parent().context("resolve executable directory")?;

    // Staged in the same directory so the final rename is atomic (same
    // filesystem) and never leaves a truncated binary in place.
    let mut staged = tempfile::NamedTempFile::new_in(dir)
        .with_context(|| format!("create temp file in {}", dir.display()))?;
    staged.write_all(binary).context("write downloaded binary")?;
    // fsync before the rename: without it a crash after persist() can leave
    // a truncated binary at the final path, bricking the CLI.
    staged
        .as_file()
        .sync_all()
        .context("sync downloaded binary")?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(staged.path(), std::fs::Permissions::from_mode(0o755))
            .context("set executable permissions")?;
    }

    staged.persist(&exe).with_context(|| {
        format!(
            "failed to replace {} (check permissions, or run: {FALLBACK_COMMAND})",
            exe.display()
        )
    })?;
    Ok(())
}
