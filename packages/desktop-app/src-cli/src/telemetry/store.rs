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

fn is_otlp_file(name: &str) -> bool {
    name.starts_with("otlp") && name.contains(".json")
}

impl TelemetryStore {
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
            if !is_otlp_file(&name) {
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

/// Single-pass summary of `otlp*.json*` files in a directory.
pub fn otlp_file_summary(dir: &Path) -> (usize, Option<SystemTime>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return (0, None),
    };
    let mut count = 0usize;
    let mut newest: Option<SystemTime> = None;
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        if !is_otlp_file(&name.to_string_lossy()) {
            continue;
        }
        count += 1;
        if let Ok(mtime) = entry.metadata().and_then(|m| m.modified()) {
            newest = Some(newest.map_or(mtime, |prev: SystemTime| prev.max(mtime)));
        }
    }
    (count, newest)
}
