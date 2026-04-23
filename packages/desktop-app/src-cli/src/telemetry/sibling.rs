use std::path::Path;
use std::time::{Duration, SystemTime};

const STALE_SIBLING_THRESHOLD: Duration = Duration::from_secs(5 * 60);

fn last_flush(dir: &Path) -> Option<SystemTime> {
    std::fs::metadata(dir.join("chdb/.last_flush"))
        .ok()?
        .modified()
        .ok()
}

/// Emits the sibling-staleness banner to stderr if the other build's
/// `.last_flush` is newer than this build's by more than
/// STALE_SIBLING_THRESHOLD.
pub fn maybe_emit_banner() {
    let this = match everr_core::build::telemetry_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let sibling = match everr_core::build::telemetry_dir_sibling() {
        Ok(d) => d,
        Err(_) => return,
    };
    let (Some(this_flush), Some(sibling_flush)) = (last_flush(&this), last_flush(&sibling)) else {
        return;
    };

    if let Ok(delta) = sibling_flush.duration_since(this_flush) {
        if delta > STALE_SIBLING_THRESHOLD {
            eprintln!(
                "heads-up: the {} Everr build wrote data {}s more recently than this one ({}). \
                 You're probably querying the wrong sidecar — switch desktop-app builds.",
                sibling_label(),
                delta.as_secs(),
                this.display()
            );
        }
    }
}

#[cfg(debug_assertions)]
fn sibling_label() -> &'static str {
    "release"
}

#[cfg(not(debug_assertions))]
fn sibling_label() -> &'static str {
    "debug"
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::SystemTime;

    use super::last_flush;

    #[test]
    fn last_flush_returns_none_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(last_flush(dir.path()).is_none());
    }

    #[test]
    fn last_flush_reads_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let chdb = dir.path().join("chdb");
        fs::create_dir(&chdb).unwrap();
        fs::write(chdb.join(".last_flush"), b"").unwrap();
        let modified = last_flush(dir.path()).unwrap();
        assert!(modified <= SystemTime::now());
    }
}
