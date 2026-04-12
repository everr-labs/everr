use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use duckdb::Connection;

/// Staleness threshold for the sibling-directory mismatch banner.
/// See the On-disk contract section in the spec for why this is 5 minutes.
#[allow(dead_code)]
pub const STALE_SIBLING_THRESHOLD: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub enum StoreError {
    DirMissing(PathBuf),
    ExtensionUnavailable(String),
    Query(duckdb::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DirMissing(path) => write!(f, "telemetry directory missing: {}", path.display()),
            Self::ExtensionUnavailable(msg) => {
                write!(f, "DuckDB otlp extension unavailable: {msg}")
            }
            Self::Query(err) => write!(f, "duckdb query error: {err}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<duckdb::Error> for StoreError {
    fn from(err: duckdb::Error) -> Self {
        Self::Query(err)
    }
}

pub struct TelemetryStore {
    dir: PathBuf,
    conn: Connection,
}

impl fmt::Debug for TelemetryStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TelemetryStore")
            .field("dir", &self.dir)
            .finish_non_exhaustive()
    }
}

impl TelemetryStore {
    /// Opens the default telemetry directory for this build profile.
    pub fn open() -> Result<Self, StoreError> {
        let dir = everr_core::build::telemetry_dir()
            .map_err(|err| StoreError::ExtensionUnavailable(err.to_string()))?;
        Self::open_at(&dir)
    }

    /// Opens the store against an explicit telemetry directory. Used by
    /// the hidden `--telemetry-dir` flag and by tests.
    pub fn open_at(dir: &Path) -> Result<Self, StoreError> {
        if !dir.exists() {
            return Err(StoreError::DirMissing(dir.to_path_buf()));
        }
        let conn = Connection::open_in_memory().map_err(StoreError::Query)?;

        // If the harness has set EVERR_DUCKDB_EXT_DIR, point DuckDB there so
        // tests never hit the network. Production leaves this unset.
        if let Ok(ext_dir) = std::env::var("EVERR_DUCKDB_EXT_DIR") {
            conn.execute_batch(&format!("SET extension_directory = '{ext_dir}';"))
                .map_err(|err| StoreError::ExtensionUnavailable(err.to_string()))?;
        }

        if conn.execute_batch("LOAD otlp;").is_err() {
            conn.execute_batch("INSTALL otlp FROM community; LOAD otlp;")
                .map_err(|err| StoreError::ExtensionUnavailable(err.to_string()))?;
        }

        Ok(Self {
            dir: dir.to_path_buf(),
            conn,
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }
}

/// Newest mtime across `otlp*.json*` files in a directory, or `None` if the
/// directory is missing or contains no matching files. Used by the CLI
/// command handler's mismatch and stale-sibling probes.
pub fn newest_otlp_mtime(dir: &Path) -> Option<SystemTime> {
    let entries = std::fs::read_dir(dir).ok()?;
    entries
        .filter_map(Result::ok)
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with("otlp") && name.contains(".json")
        })
        .filter_map(|e| e.metadata().and_then(|m| m.modified()).ok())
        .max()
}

/// Count of `otlp*.json*` files in a directory. Returns 0 on missing dir.
pub fn count_otlp_files(dir: &Path) -> usize {
    match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter(|e| {
                let name = e.file_name();
                let name = name.to_string_lossy();
                name.starts_with("otlp") && name.contains(".json")
            })
            .count(),
        Err(_) => 0,
    }
}
