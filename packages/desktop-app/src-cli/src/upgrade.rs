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
pub const DOWNLOAD_BASE_URL_OVERRIDE_ENV: &str = "EVERR_DOWNLOAD_BASE_URL_FOR_TESTS";
pub const APP_INSTALL_PATH_OVERRIDE_ENV: &str = "EVERR_APP_INSTALL_PATH_FOR_TESTS";
pub const UPDATER_PUBKEY_OVERRIDE_ENV: &str = "EVERR_UPDATER_PUBKEY_FOR_TESTS";

pub async fn run() -> Result<()> {
    let metadata = update_notice::fetch_release_metadata(METADATA_TIMEOUT).await?;
    // One client for both phases, so the app download reuses the CLI
    // download's connection instead of paying a second TLS handshake.
    let client = download_client()?;
    upgrade_cli(&metadata, &client).await?;
    upgrade_app(&metadata, &client).await?;
    Ok(())
}

async fn upgrade_cli(metadata: &ReleaseMetadata, client: &reqwest::Client) -> Result<()> {
    let current = Version::parse(env!("EVERR_VERSION")).context("parse current CLI version")?;
    let latest = parse_version(&metadata.version, "latest CLI version")?;

    if latest <= current {
        println!("Already up to date (v{current})");
        return Ok(());
    }

    let binary_name = release_binary_name()?;
    let base = download_base_url()?;
    println!("Downloading Everr CLI v{latest}...");
    let (binary, checksum_file) = futures_util::try_join!(
        download_bytes(client, format!("{base}/{binary_name}")),
        download_bytes(client, format!("{base}/{binary_name}.sha256")),
    )?;
    verify_sha256(&binary, &checksum_file)?;
    replace_current_exe(&binary)?;
    println!("Upgraded everr v{current} → v{latest}");
    Ok(())
}

async fn upgrade_app(metadata: &ReleaseMetadata, client: &reqwest::Client) -> Result<()> {
    let Some(installed) = installed_app_path() else {
        return Ok(());
    };

    // Metadata published before the app fields existed must not fail the
    // CLI upgrade that already succeeded; the app can still update itself.
    let (Some(latest), Some(target)) = (metadata.platform_version.as_deref(), &metadata.target)
    else {
        println!(
            "Skipping the Everr app update: the release metadata has no app info yet. The app can update itself from its own updater."
        );
        return Ok(());
    };

    let installed_version = installed_app_version(&installed)?;
    let latest = parse_version(latest, "latest app version")?;

    if latest <= installed_version {
        println!("Everr app already up to date (v{installed_version})");
        return Ok(());
    }

    let archive_name = &target.updater_archive_name;
    let expected_sha256 = app_archive_sha256(metadata, archive_name)?;
    let pubkey = updater_pubkey()?;
    let base = download_base_url()?;
    println!("Downloading Everr app v{latest}...");
    let (archive, signature) = futures_util::try_join!(
        download_bytes(client, format!("{base}/{archive_name}")),
        download_bytes(client, format!("{base}/{archive_name}.sig")),
    )?;
    verify_sha256_hex(&archive, expected_sha256)?;
    verify_updater_signature(&pubkey, &archive, &signature)?;
    replace_app_bundle(&installed, &archive, &latest)?;
    println!("Upgraded Everr app v{installed_version} → v{latest}");
    println!("If the Everr app is running, quit and reopen it to finish the update.");
    Ok(())
}

/// The Tauri updater public key from tauri.conf.json, so this channel trusts
/// the exact signing identity the in-app updater already trusts. The value is
/// base64 over the minisign .pub file content.
fn updater_pubkey() -> Result<minisign_verify::PublicKey> {
    let encoded = match update_notice::test_override(UPDATER_PUBKEY_OVERRIDE_ENV) {
        Some(value) => value,
        None => {
            let conf: serde_json::Value =
                serde_json::from_str(include_str!("../../src-tauri/tauri.conf.json"))
                    .context("parse bundled tauri.conf.json")?;
            conf.pointer("/plugins/updater/pubkey")
                .and_then(|value| value.as_str())
                .context("tauri.conf.json is missing plugins.updater.pubkey")?
                .to_owned()
        }
    };

    let decoded = decode_base64_file(&encoded, "updater pubkey")?;
    minisign_verify::PublicKey::decode(decoded.trim()).context("parse updater pubkey")
}

/// The published .sig artifact is base64 over the minisign signature file,
/// the same encoding the Tauri updater uses for latest.json's signature field.
fn verify_updater_signature(
    pubkey: &minisign_verify::PublicKey,
    archive: &[u8],
    signature: &[u8],
) -> Result<()> {
    let signature = std::str::from_utf8(signature).context("signature file is not utf-8")?;
    let signature = decode_base64_file(signature, "updater signature")?;
    let signature =
        minisign_verify::Signature::decode(signature.trim()).context("parse updater signature")?;
    pubkey
        .verify(archive, &signature, true)
        .context("updater signature verification failed for the app archive")
}

/// Tauri encodes minisign files (pubkey, signatures) as base64 over the
/// two-line text file format.
fn decode_base64_file(encoded: &str, what: &str) -> Result<String> {
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .with_context(|| format!("base64-decode {what}"))?;
    String::from_utf8(decoded).with_context(|| format!("{what} is not utf-8"))
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
        return update_notice::test_override(DOWNLOAD_BASE_URL_OVERRIDE_ENV).with_context(|| {
            format!(
                "refusing to self-update a debug build; set {DOWNLOAD_BASE_URL_OVERRIDE_ENV} or use a release binary"
            )
        });
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

async fn download_bytes(client: &reqwest::Client, url: String) -> Result<bytes::Bytes> {
    let response = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?
        .error_for_status()
        .with_context(|| format!("GET {url}"))?;
    response
        .bytes()
        .await
        .with_context(|| format!("read {url}"))
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
    const APP_BUNDLE_NAME: &str = "Everr.app";

    if cfg!(debug_assertions) {
        return update_notice::test_override(APP_INSTALL_PATH_OVERRIDE_ENV)
            .map(PathBuf::from)
            .filter(|path| path.exists());
    }

    // The app is only released for macOS arm64 (see the darwin-aarch64
    // updater target in copy-release-artifact.ts); never swap that bundle
    // onto another platform.
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return None;
    }
    let mut candidates = vec![PathBuf::from("/Applications").join(APP_BUNDLE_NAME)];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Applications").join(APP_BUNDLE_NAME));
    }
    candidates.into_iter().find(|path| path.exists())
}

fn installed_app_version(app: &Path) -> Result<Version> {
    let plist_path = app.join("Contents").join("Info.plist");
    let raw = read_plist_short_version(&plist_path).with_context(|| {
        format!(
            "read CFBundleShortVersionString from {}",
            plist_path.display()
        )
    })?;
    parse_version(&raw, "app bundle version")
}

/// Tauri writes XML plists, but installed apps can end up with binary plists
/// (`plutil -convert binary1`, distribution tooling); the plist crate parses
/// both on every platform.
fn read_plist_short_version(plist_path: &Path) -> Result<String> {
    let value = plist::Value::from_file(plist_path).context("parse plist")?;
    value
        .as_dictionary()
        .and_then(|dict| dict.get("CFBundleShortVersionString"))
        .and_then(|value| value.as_string())
        .map(str::to_owned)
        .context("could not find CFBundleShortVersionString")
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
fn replace_app_bundle(installed: &Path, archive: &[u8], expected_version: &Version) -> Result<()> {
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

    // The signature proves the archive is ours, not that it is the version
    // the (unsigned) metadata claims: without this check a tampered
    // platform_version could pair an old, validly signed archive with a
    // newer claimed version and silently downgrade the app.
    let new_version = installed_app_version(&new_app)?;
    if new_version != *expected_version {
        bail!(
            "extracted app bundle is v{new_version}, but the release metadata claims v{expected_version}; refusing to swap"
        );
    }

    // The window between the two renames is the only moment without an
    // installed app; a crash inside it leaves the previous bundle intact in
    // the staging directory, so it is recoverable rather than lost.
    let previous = staging.path().join("previous.app");
    std::fs::rename(installed, &previous)
        .with_context(|| format!("move aside {}", installed.display()))?;
    if let Err(err) = std::fs::rename(&new_app, installed) {
        if std::fs::rename(&previous, installed).is_err() {
            // Never let TempDir cleanup delete the only remaining copy.
            let staging = staging.keep();
            return Err(err).with_context(|| {
                format!(
                    "install new app at {} (rollback also failed; the previous app was preserved at {})",
                    installed.display(),
                    staging.join("previous.app").display()
                )
            });
        }
        return Err(err).with_context(|| format!("install new app at {}", installed.display()));
    }
    Ok(())
}

/// A broken bundle (e.g. missing Info.plist) is rejected by the version
/// cross-check in replace_app_bundle before any rename happens.
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
