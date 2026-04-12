//! Bootstrap binary that installs the DuckDB `otlp` community extension
//! into a shared test-fixture cache. Run this once (via `make prepare-test-fixtures`
//! or manually) before executing the CLI integration tests; it is idempotent.
//!
//! Why: the CLI test harness overrides `HOME` to a temp dir on every run, so
//! DuckDB's default `~/.duckdb/` cache is always cold. Without a warm shared
//! cache, every test that opens a `TelemetryStore` would hit the network to
//! re-install the extension, which is both slow and flaky.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use duckdb::Connection;

fn main() -> ExitCode {
    let cache_dir = match resolve_cache_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("warm_otlp_extension: cannot resolve cache dir: {err}");
            return ExitCode::from(1);
        }
    };

    if let Err(err) = fs::create_dir_all(&cache_dir) {
        eprintln!(
            "warm_otlp_extension: cannot create {}: {err}",
            cache_dir.display()
        );
        return ExitCode::from(1);
    }

    if let Err(err) = install_if_missing(&cache_dir) {
        eprintln!("warm_otlp_extension: install failed: {err}");
        return ExitCode::from(1);
    }

    println!(
        "warm_otlp_extension: cache ready at {}",
        cache_dir.display()
    );
    ExitCode::SUCCESS
}

fn resolve_cache_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    // Walk up from CARGO_MANIFEST_DIR to find the workspace root by looking
    // for a `target/` directory sibling. This keeps the cache inside the repo.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut cursor = manifest.as_path();
    loop {
        let candidate = cursor.join("target");
        if candidate.is_dir() {
            return Ok(candidate.join("test-fixtures").join("duckdb"));
        }
        cursor = match cursor.parent() {
            Some(parent) => parent,
            None => return Err("could not locate workspace target/ directory".into()),
        };
    }
}

fn install_if_missing(cache_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch(&format!(
        "SET extension_directory = '{}';",
        cache_dir.display()
    ))?;

    // LOAD succeeds silently if already installed. If not, INSTALL goes over
    // the network once, then LOAD picks it up.
    if conn.execute_batch("LOAD otlp;").is_err() {
        conn.execute_batch("INSTALL otlp FROM community; LOAD otlp;")?;
    }
    Ok(())
}
