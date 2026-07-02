use std::fs;
use std::io::IsTerminal;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use semver::Version;
use serde::{Deserialize, Serialize};

use crate::cli::Cli;

const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const FETCH_TIMEOUT: Duration = Duration::from_millis(750);
const RELEASE_METADATA_PATH: &str = "/everr-app/release-metadata.json";
const UPGRADE_COMMAND: &str = "everr upgrade";

#[cfg(debug_assertions)]
const RELEASE_METADATA_URL_OVERRIDE_ENV: &str = "EVERR_RELEASE_METADATA_URL_FOR_TESTS";

#[cfg(debug_assertions)]
const CACHE_FILE_NAME: &str = "cli-update-check-dev.json";

#[cfg(not(debug_assertions))]
const CACHE_FILE_NAME: &str = "cli-update-check.json";

#[derive(Debug, Deserialize)]
struct ReleaseMetadata {
    version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CacheFile {
    last_checked_at: String,
    latest_version: String,
    update_available: bool,
}

pub async fn maybe_print(cli: &Cli) {
    if !cli.prints_human_stdout(std::io::stdout().is_terminal()) {
        return;
    }

    let Ok(status) = check().await else {
        return;
    };

    if status.update_available {
        println!("A new version is available: {}", status.latest_version);
        println!("Run: {UPGRADE_COMMAND}");
    }
}

async fn check() -> Result<CacheFile> {
    let path = cache_path()?;
    let cached = read_cache(&path);

    if let Some(cache) = cached.as_ref() {
        let cache = cache.for_current_version();
        if cache.update_available || !is_stale(&cache) {
            return Ok(cache);
        }
    }

    match fetch_latest_version().await {
        Ok(latest_version) => {
            let update_available = is_newer(&latest_version, env!("EVERR_VERSION"));
            let cache = CacheFile {
                last_checked_at: Utc::now().to_rfc3339(),
                latest_version,
                update_available,
            };
            let _ = write_cache(&path, &cache);
            Ok(cache)
        }
        Err(err) => {
            if let Some(cache) = cached {
                return Ok(cache.for_current_version());
            }
            Err(err)
        }
    }
}

impl CacheFile {
    fn for_current_version(&self) -> Self {
        Self {
            last_checked_at: self.last_checked_at.clone(),
            latest_version: self.latest_version.clone(),
            update_available: is_newer(&self.latest_version, env!("EVERR_VERSION")),
        }
    }
}

fn read_cache(path: &PathBuf) -> Option<CacheFile> {
    let body = fs::read_to_string(path).ok()?;
    serde_json::from_str(&body).ok()
}

fn write_cache(path: &PathBuf, cache: &CacheFile) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    fs::write(path, serde_json::to_string_pretty(cache)?)
        .with_context(|| format!("write {}", path.display()))
}

fn is_stale(cache: &CacheFile) -> bool {
    let Ok(last_checked) = DateTime::parse_from_rfc3339(&cache.last_checked_at) else {
        return true;
    };
    let elapsed = Utc::now().signed_duration_since(last_checked.with_timezone(&Utc));
    elapsed
        .to_std()
        .map_or(true, |elapsed| elapsed >= CHECK_INTERVAL)
}

async fn fetch_latest_version() -> Result<String> {
    let url = release_metadata_url();
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .context("build release metadata client")?;
    let metadata: ReleaseMetadata = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?
        .json()
        .await
        .with_context(|| format!("parse {url}"))?;
    Ok(metadata.version)
}

pub(crate) fn release_metadata_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var(RELEASE_METADATA_URL_OVERRIDE_ENV) {
        if !url.trim().is_empty() {
            return url;
        }
    }

    format!(
        "{}{}",
        everr_core::build::default_docs_base_url(),
        RELEASE_METADATA_PATH
    )
}

fn cache_path() -> Result<PathBuf> {
    let base = dirs::data_local_dir().context("failed to resolve user local data dir")?;
    Ok(base
        .join(everr_core::build::session_namespace())
        .join(CACHE_FILE_NAME))
}

fn is_newer(latest: &str, current: &str) -> bool {
    let Ok(latest) = Version::parse(latest) else {
        return false;
    };
    let Ok(current) = Version::parse(current) else {
        return false;
    };
    latest > current
}
