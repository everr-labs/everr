use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::NaiveDateTime;

/// Staleness threshold for the sibling-directory mismatch banner.
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

/// A telemetry file with its parsed rotation timestamp.
///
/// The collector names rotated backups `otlp-YYYY-MM-DDTHH-MM-SS.sss.json`
/// (hyphens where ISO 8601 uses colons in the time segment; `localtime: false`
/// so the timestamp is UTC). The currently-active file is `otlp.json`.
///
/// `rotation_time_ns` is an **upper bound on event timestamps inside the file**:
/// every event was written before rotation, so `event_ts <= rotation_ts`. This
/// lets queries prune files when `filter.from_ns` exceeds it.
///
/// `None` means the file is the current `otlp.json` (actively written, no upper
/// bound known) or the filename was unparseable. Such files must always be scanned.
pub struct OtlpFile {
    pub path: PathBuf,
    pub rotation_time_ns: Option<u64>,
}

/// Parse the rotation timestamp embedded in an OTLP backup filename.
/// Returns `None` for `otlp.json` and for unparseable names.
fn parse_rotation_ns(name: &str) -> Option<u64> {
    let stem = name.strip_prefix("otlp-")?.strip_suffix(".json")?;
    let dt = NaiveDateTime::parse_from_str(stem, "%Y-%m-%dT%H-%M-%S%.f").ok()?;
    let ts_ns = dt.and_utc().timestamp_nanos_opt()?;
    u64::try_from(ts_ns).ok()
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

    /// List `otlp*.json` files newest-first, tagged with rotation timestamps
    /// parsed from the filename (see `OtlpFile`). The current `otlp.json` — and
    /// any backup with an unparseable name — have `rotation_time_ns = None` and
    /// sort first so queries always scan them.
    pub fn otlp_files(&self) -> Result<Vec<OtlpFile>, std::io::Error> {
        let mut entries: Vec<OtlpFile> = Vec::new();
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
            entries.push(OtlpFile {
                path: entry.path(),
                rotation_time_ns: parse_rotation_ns(&name),
            });
        }
        // `None` (current / unparseable) sorts first; rotated backups follow
        // by rotation time descending (most recent first).
        entries.sort_by_key(|e| std::cmp::Reverse(e.rotation_time_ns.unwrap_or(u64::MAX)));
        Ok(entries)
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
