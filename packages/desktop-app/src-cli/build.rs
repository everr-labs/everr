use std::path::Path;

fn main() {
    let tauri_conf = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src-tauri/tauri.conf.json");

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", tauri_conf.display());

    let content = std::fs::read_to_string(&tauri_conf)
        .expect("failed to read tauri.conf.json");
    let json: serde_json::Value = serde_json::from_str(&content)
        .expect("failed to parse tauri.conf.json");
    let version = json["version"]
        .as_str()
        .expect("missing 'version' in tauri.conf.json");

    println!("cargo:rustc-env=EVERR_VERSION={version}");
}
