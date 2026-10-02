use std::fs;
use std::path::Path;

#[test]
fn cli_http_callers_send_requests_directly() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manifest = fs::read_to_string(root.join("Cargo.toml")).expect("read manifest");
    let lib = fs::read_to_string(root.join("src/lib.rs")).expect("read lib.rs");
    let api = fs::read_to_string(root.join("src/api.rs")).expect("read api");
    let auth = fs::read_to_string(root.join("src/device_auth.rs")).expect("read auth");
    let collector = fs::read_to_string(root.join("src/collector.rs")).expect("read collector");

    assert!(!manifest.contains("otel ="));
    assert!(!manifest.contains("tracing = { version = \"0.1\", optional = true }"));
    assert!(!lib.contains("pub mod http_telemetry;"));
    assert!(!root.join("src/http_telemetry.rs").exists());

    for source in [api, auth, collector] {
        assert!(
            !source.contains("http_telemetry"),
            "CLI HTTP callers should send requests directly"
        );
    }
}
