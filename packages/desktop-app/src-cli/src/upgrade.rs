use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use semver::Version;
use sha2::{Digest, Sha256};

use crate::update_notice::{self, ReleaseMetadata};

const DOWNLOAD_PATH_PREFIX: &str = "/everr-app";
const METADATA_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(30);
const FALLBACK_COMMAND: &str = "curl -fsSL https://everr.dev/upgrade.sh | bash";
const DOWNLOAD_BASE_URL_OVERRIDE_ENV: &str = "EVERR_DOWNLOAD_BASE_URL_FOR_TESTS";
const APP_INSTALL_PATH_OVERRIDE_ENV: &str = "EVERR_APP_INSTALL_PATH_FOR_TESTS";

pub async fn run() -> Result<()> {
    let metadata = update_notice::fetch_release_metadata(METADATA_TIMEOUT).await?;
    upgrade_cli(&metadata).await?;
    upgrade_app(&metadata).await?;
    Ok(())
}

async fn upgrade_cli(metadata: &ReleaseMetadata) -> Result<()> {
    let current = Version::parse(env!("EVERR_VERSION")).context("parse current CLI version")?;
    let latest = parse_version(&metadata.version, "latest CLI version")?;

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

async fn upgrade_app(metadata: &ReleaseMetadata) -> Result<()> {
    let Some(installed) = installed_app_path() else {
        return Ok(());
    };

    let installed_version = installed_app_version(&installed)?;
    let latest = metadata
        .platform_version
        .as_deref()
        .context("release metadata is missing platform_version; cannot update the Everr app")?;
    let latest = parse_version(latest, "latest app version")?;

    if latest <= installed_version {
        println!("Everr app already up to date (v{installed_version})");
        return Ok(());
    }

    let archive_name = &metadata
        .target
        .as_ref()
        .context("release metadata is missing target; cannot update the Everr app")?
        .updater_archive_name;
    let expected_sha256 = app_archive_sha256(metadata, archive_name)?;
    let base = download_base_url()?;
    let client = download_client()?;
    println!("Downloading Everr app v{latest}...");
    let archive = download_bytes(&client, format!("{base}/{archive_name}")).await?;
    verify_sha256_hex(&archive, expected_sha256)?;
    replace_app_bundle(&installed, &archive)?;
    println!("Upgraded Everr app v{installed_version} → v{latest}");
    println!("If the Everr app is running, quit and reopen it to finish the update.");
    Ok(())
}

fn parse_version(raw: &str, what: &str) -> Result<Version> {
    Version::parse(raw).with_context(|| format!("parse {what} {raw:?}"))
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
        .into())
}

/// The checksum file is `<hex>  <filename>`, as produced by `shasum -a 256`.
fn verify_sha256(binary: &[u8], checksum_file: &[u8]) -> Result<()> {
    let checksum_file = std::str::from_utf8(checksum_file).context("checksum file is not utf-8")?;
    let expected = checksum_file
        .split_whitespace()
        .next()
        .context("checksum file is empty")?;
    verify_sha256_hex(binary, expected)
}

fn verify_sha256_hex(bytes: &[u8], expected: &str) -> Result<()> {
    let expected = expected.to_ascii_lowercase();
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != expected {
        bail!("checksum mismatch for downloaded binary: expected {expected}, got {actual}");
    }
    Ok(())
}

/// Debug builds only look at the test override so `everr upgrade` from a dev
/// checkout can never touch a real /Applications install.
fn installed_app_path() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        std::env::var(APP_INSTALL_PATH_OVERRIDE_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .filter(|path| path.exists())
    }

    #[cfg(not(debug_assertions))]
    {
        const APP_BUNDLE_NAME: &str = "Everr.app";

        if std::env::consts::OS != "macos" {
            return None;
        }
        let mut candidates = vec![PathBuf::from("/Applications").join(APP_BUNDLE_NAME)];
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join("Applications").join(APP_BUNDLE_NAME));
        }
        candidates.into_iter().find(|path| path.exists())
    }
}

fn installed_app_version(app: &Path) -> Result<Version> {
    let plist_path = app.join("Contents").join("Info.plist");
    let body = std::fs::read_to_string(&plist_path)
        .with_context(|| format!("read {}", plist_path.display()))?;
    let pattern =
        regex::Regex::new(r"<key>CFBundleShortVersionString</key>\s*<string>([^<]+)</string>")
            .expect("static regex");
    let raw = pattern
        .captures(&body)
        .and_then(|captures| captures.get(1))
        .with_context(|| {
            format!(
                "find CFBundleShortVersionString in {}",
                plist_path.display()
            )
        })?
        .as_str();
    parse_version(raw, "installed app version")
}

fn app_archive_sha256<'a>(metadata: &'a ReleaseMetadata, archive_name: &str) -> Result<&'a str> {
    metadata
        .files
        .iter()
        .find(|file| {
            Path::new(&file.path)
                .file_name()
                .is_some_and(|name| name == archive_name)
        })
        .map(|file| file.sha256.as_str())
        .with_context(|| format!("release metadata has no checksum for {archive_name}"))
}

/// Everything is staged inside the install directory so the two renames are
/// atomic (same filesystem) and a failed swap can roll the old bundle back.
fn replace_app_bundle(installed: &Path, archive: &[u8]) -> Result<()> {
    let parent = installed
        .parent()
        .context("resolve app install directory")?;
    let staging = tempfile::tempdir_in(parent).with_context(|| {
        format!(
            "create staging directory in {} (if this is a permissions error, update from within the app instead)",
            parent.display()
        )
    })?;

    let unpack_dir = staging.path().join("new");
    std::fs::create_dir(&unpack_dir).context("create unpack directory")?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(archive));
    // Without this the app's executables lose their +x bits and the bundle
    // no longer launches.
    tar.set_preserve_permissions(true);
    tar.unpack(&unpack_dir).context("extract app archive")?;
    let new_app = find_app_bundle(&unpack_dir)?;

    let previous = staging.path().join("previous.app");
    std::fs::rename(installed, &previous)
        .with_context(|| format!("move aside {}", installed.display()))?;
    if let Err(err) = std::fs::rename(&new_app, installed) {
        let _ = std::fs::rename(&previous, installed);
        return Err(err).with_context(|| format!("install new app at {}", installed.display()));
    }
    Ok(())
}

fn find_app_bundle(dir: &Path) -> Result<PathBuf> {
    for entry in std::fs::read_dir(dir).with_context(|| format!("read {}", dir.display()))? {
        let path = entry.context("read extracted archive entry")?.path();
        if path.extension().is_some_and(|extension| extension == "app") {
            return Ok(path);
        }
    }
    bail!("app archive does not contain a .app bundle");
}

fn replace_current_exe(binary: &[u8]) -> Result<()> {
    let exe = std::env::current_exe().context("resolve current executable path")?;
    let dir = exe.parent().context("resolve executable directory")?;

    // Staged in the same directory so the final rename is atomic (same
    // filesystem) and never leaves a truncated binary in place.
    let mut staged = tempfile::NamedTempFile::new_in(dir)
        .with_context(|| format!("create temp file in {}", dir.display()))?;
    staged
        .write_all(binary)
        .context("write downloaded binary")?;
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
