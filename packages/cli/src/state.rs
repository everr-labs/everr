use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::build;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Session {
    pub api_base_url: String,
    pub token: String,
}

pub(crate) fn user_config_directory() -> Result<PathBuf> {
    if let Some(directory) = std::env::var_os("EVERR_CONFIG_DIR") {
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            bail!("EVERR_CONFIG_DIR must be an absolute path");
        }
        return Ok(directory);
    }
    Ok(dirs::config_dir()
        .context("failed to resolve user config dir")?
        .join(build::session_namespace()))
}
