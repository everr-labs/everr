//! Test-only helper that guarantees the DuckDB `otlp` extension is installed
//! into a shared cache directory before any test binary tries to load it.
//!
//! The harness calls `warm_otlp_extension()` once per test process. It uses
//! a workspace-wide file lock so parallel `cargo test` binaries serialize on
//! installation, and a `OnceLock` to short-circuit intra-process repeats.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use fd_lock::RwLock;

static WARM_CACHE: OnceLock<PathBuf> = OnceLock::new();

/// Ensures the DuckDB `otlp` extension is installed into
/// `target/test-fixtures/duckdb/` and returns that path. Safe to call from
/// multiple processes in parallel: access is serialized via an OS-level file
/// lock on a dedicated lock file inside the cache directory.
pub fn warm_otlp_extension() -> PathBuf {
    WARM_CACHE
        .get_or_init(|| {
            let cache_dir = resolve_cache_dir();
            fs::create_dir_all(&cache_dir).expect("create duckdb cache dir");

            // Acquire the lock before any check-or-install so two parallel
            // test binaries cannot race. _guard holds the OS lock until it
            // drops at the end of the block.
            let lock_path = cache_dir.join(".warm.lock");
            let lock_file = OpenOptions::new()
                .create(true)
                .read(true)
                .write(true)
                .open(&lock_path)
                .expect("open duckdb warm lock");
            let mut file_lock = RwLock::new(lock_file);
            let _guard = file_lock.write().expect("acquire duckdb warm lock");

            // Under the lock: check whether the extension is already loadable
            // from this cache. If so, we are done.
            if !extension_present(&cache_dir) {
                install_extension(&cache_dir);
            }

            // _guard drops here, releasing the OS lock.
            cache_dir
        })
        .clone()
}

fn resolve_cache_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut cursor = manifest.as_path();
    loop {
        let candidate = cursor.join("target");
        if candidate.is_dir() {
            return candidate.join("test-fixtures").join("duckdb");
        }
        cursor = cursor
            .parent()
            .expect("walked past workspace root without finding target/");
    }
}

fn extension_present(cache_dir: &Path) -> bool {
    let conn = match duckdb::Connection::open_in_memory() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let set_dir = format!("SET extension_directory = '{}';", cache_dir.display());
    if conn.execute_batch(&set_dir).is_err() {
        return false;
    }
    conn.execute_batch("LOAD otlp;").is_ok()
}

fn install_extension(cache_dir: &Path) {
    let conn = duckdb::Connection::open_in_memory().expect("open duckdb in-memory");
    conn.execute_batch(&format!(
        "SET extension_directory = '{}';",
        cache_dir.display()
    ))
    .expect("set extension_directory");
    conn.execute_batch("INSTALL otlp FROM community; LOAD otlp;")
        .expect(
            "install duckdb otlp extension from community repository — \
             this requires network access on a cold cache. Run \
             `make prepare-test-fixtures` manually if offline.",
        );
}
