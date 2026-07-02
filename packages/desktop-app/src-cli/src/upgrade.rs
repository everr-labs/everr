use std::time::Duration;

use anyhow::{Context, Result, bail};
use semver::Version;
use serde::Deserialize;

use crate::update_notice;

const METADATA_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct ReleaseMetadata {
    version: String,
}

pub async fn run() -> Result<()> {
    let current = Version::parse(env!("EVERR_VERSION")).context("parse current CLI version")?;
    let latest = fetch_latest_version().await?;

    if latest <= current {
        println!("Already up to date (v{current})");
        return Ok(());
    }

    bail!("not implemented");
}

async fn fetch_latest_version() -> Result<Version> {
    let url = update_notice::release_metadata_url();
    let client = reqwest::Client::builder()
        .timeout(METADATA_TIMEOUT)
        .build()
        .context("build release metadata client")?;
    let metadata: ReleaseMetadata = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?
        .error_for_status()
        .with_context(|| format!("GET {url}"))?
        .json()
        .await
        .with_context(|| format!("parse {url}"))?;
    Version::parse(&metadata.version)
        .with_context(|| format!("parse latest version {:?}", metadata.version))
}
