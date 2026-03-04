use std::env;
use std::path::{Path, PathBuf};

const KEYS: [&str; 1] = ["EVERR_API_BASE_URL"];

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let env_paths = [manifest_dir.join(".env.prod"), manifest_dir.join(".env")];

    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
        if let Some(value) = resolve_value(key, &env_paths) {
            println!("cargo:rustc-env={key}={value}");
        }
    }

    for path in env_paths {
        println!("cargo:rerun-if-changed={}", path.display());
    }
}

fn resolve_value(key: &str, env_paths: &[PathBuf]) -> Option<String> {
    if let Ok(value) = env::var(key) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    for path in env_paths {
        if let Some(value) = resolve_value_from_file(path.as_path(), key) {
            return Some(value);
        }
    }

    None
}

fn resolve_value_from_file(path: &Path, key: &str) -> Option<String> {
    let iter = dotenvy::from_path_iter(path).ok()?;
    for item in iter {
        let (entry_key, entry_value) = item.ok()?;
        if entry_key == key {
            let trimmed = entry_value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
            return None;
        }
    }
    None
}
