use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Staleness threshold for the sibling-directory mismatch banner.
#[allow(dead_code)]
pub const STALE_SIBLING_THRESHOLD: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub enum StoreError {
    DirMissing(PathBuf),
    Io(std::io::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DirMissing(path) => write!(f, "telemetry directory missing: {}", path.display()),
            Self::Io(err) => write!(f, "telemetry I/O error: {err}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

#[derive(Debug)]
pub struct TelemetryStore {
    dir: PathBuf,
}

impl TelemetryStore {
    pub fn open() -> Result<Self, StoreError> {
        let dir = everr_core::build::telemetry_dir()
            .map_err(|err| StoreError::Io(std::io::Error::new(std::io::ErrorKind::Other, err)))?;
        Self::open_at(&dir)
    }

    pub fn open_at(dir: &Path) -> Result<Self, StoreError> {
        if !dir.exists() {
            return Err(StoreError::DirMissing(dir.to_path_buf()));
        }
        Ok(Self {
            dir: dir.to_path_buf(),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// List `otlp*.json*` files sorted by mtime (newest first).
    /// Files whose metadata can't be read are still returned (with UNIX_EPOCH
    /// mtime) so the query layer can attempt to open them and report failures
    /// via `ScanStats`.
    pub fn otlp_files(&self) -> Result<Vec<PathBuf>, std::io::Error> {
        let mut entries: Vec<(PathBuf, SystemTime)> = Vec::new();
        for entry in std::fs::read_dir(&self.dir)? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue, // directory-level read error, not a file
            };
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("otlp") || !name.contains(".json") {
                continue;
            }
            let mtime = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            entries.push((entry.path(), mtime));
        }
        entries.sort_by(|a, b| b.1.cmp(&a.1)); // newest first
        Ok(entries.into_iter().map(|(p, _)| p).collect())
    }
}

/// Newest mtime across `otlp*.json*` files in a directory, or `None` if the
/// directory is missing or contains no matching files.
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
