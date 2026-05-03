use std::path::Path;

fn main() {
    let tauri_conf = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", tauri_conf.display());
    println!("cargo:rerun-if-env-changed=EVERR_PLATFORM_VERSION");
    println!("cargo:rerun-if-env-changed=EVERR_RELEASE_SHA");
    println!("cargo:rerun-if-env-changed=EVERR_RELEASE_SHORT_SHA");

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

    tauri_build::build();
}
