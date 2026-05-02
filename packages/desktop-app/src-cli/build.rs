use std::path::Path;

use sha2::{Digest, Sha256};

fn main() {
    let tauri_conf = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/tauri.conf.json");
    let collector_asset = std::env::var("EVERR_EMBEDDED_COLLECTOR_GZ").ok();
    let chdb_asset = std::env::var("EVERR_EMBEDDED_CHDB_GZ").ok();
    let require_assets = std::env::var("EVERR_REQUIRE_EMBEDDED_COLLECTOR")
        .ok()
        .as_deref()
        == Some("1");

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", tauri_conf.display());
    println!("cargo:rerun-if-env-changed=EVERR_EMBEDDED_COLLECTOR_GZ");
    println!("cargo:rerun-if-env-changed=EVERR_EMBEDDED_CHDB_GZ");
    println!("cargo:rerun-if-env-changed=EVERR_REQUIRE_EMBEDDED_COLLECTOR");
    println!("cargo:rerun-if-env-changed=EVERR_PLATFORM_VERSION");
    println!("cargo:rerun-if-env-changed=EVERR_RELEASE_SHA");
    println!("cargo:rerun-if-env-changed=EVERR_RELEASE_SHORT_SHA");
    println!("cargo:rustc-check-cfg=cfg(everr_embedded_collector_assets)");

    let content = std::fs::read_to_string(&tauri_conf).expect("failed to read tauri.conf.json");
    let json: serde_json::Value =
        serde_json::from_str(&content).expect("failed to parse tauri.conf.json");
    let fallback_version = json["version"]
        .as_str()
        .expect("missing 'version' in tauri.conf.json");
    let version =
        std::env::var("EVERR_PLATFORM_VERSION").unwrap_or_else(|_| fallback_version.into());
    let release_sha = std::env::var("EVERR_RELEASE_SHA").unwrap_or_else(|_| "unknown".into());
    let release_short_sha = std::env::var("EVERR_RELEASE_SHORT_SHA")
        .unwrap_or_else(|_| release_sha.chars().take(7).collect());

    println!("cargo:rustc-env=EVERR_VERSION={version}");
    println!("cargo:rustc-env=EVERR_RELEASE_SHA={release_sha}");
    println!("cargo:rustc-env=EVERR_RELEASE_SHORT_SHA={release_short_sha}");

    match (collector_asset, chdb_asset) {
        (Some(collector), Some(chdb))
            if Path::new(&collector).is_file() && Path::new(&chdb).is_file() =>
        {
            println!("cargo:rerun-if-changed={collector}");
            println!("cargo:rerun-if-changed={chdb}");
            println!("cargo:rustc-cfg=everr_embedded_collector_assets");
            println!("cargo:rustc-env=EVERR_EMBEDDED_COLLECTOR_GZ={collector}");
            println!("cargo:rustc-env=EVERR_EMBEDDED_CHDB_GZ={chdb}");
            println!(
                "cargo:rustc-env=EVERR_EMBEDDED_COLLECTOR_GZ_SHA256={}",
                sha256_file(&collector)
            );
            println!(
                "cargo:rustc-env=EVERR_EMBEDDED_CHDB_GZ_SHA256={}",
                sha256_file(&chdb)
            );
        }
        _ if require_assets => {
            panic!(
                "missing embedded collector assets; run the package build scripts so the collector and chDB assets are prepared first"
            );
        }
        _ => {}
    }
}

fn sha256_file(path: &str) -> String {
    let bytes = std::fs::read(path).unwrap_or_else(|err| panic!("failed to read {path}: {err}"));
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}
