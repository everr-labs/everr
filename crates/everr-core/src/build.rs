use std::path::PathBuf;

use anyhow::Context;

pub const SESSION_NAMESPACE: &str = "everr";

#[cfg(debug_assertions)]
pub const BUILD_TYPE_LABEL: &str = "debug";

#[cfg(not(debug_assertions))]
pub const BUILD_TYPE_LABEL: &str = "release";

#[cfg(debug_assertions)]
pub const DEFAULT_API_BASE_URL: &str = "http://localhost:5173";

#[cfg(not(debug_assertions))]
pub const DEFAULT_API_BASE_URL: &str = "https://app.everr.dev";

#[cfg(debug_assertions)]
pub const DEFAULT_DOCS_BASE_URL: &str = "http://localhost:3000";

#[cfg(not(debug_assertions))]
pub const DEFAULT_DOCS_BASE_URL: &str = "https://everr.dev";

#[cfg(debug_assertions)]
pub const DEFAULT_SESSION_FILE_NAME: &str = "session-dev.json";

#[cfg(not(debug_assertions))]
pub const DEFAULT_SESSION_FILE_NAME: &str = "session.json";

pub const fn build_type_label() -> &'static str {
    BUILD_TYPE_LABEL
}

pub fn command_name() -> &'static str {
    use std::sync::OnceLock;
    static NAME: OnceLock<&'static str> = OnceLock::new();
    *NAME.get_or_init(|| {
        let is_dev = std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .map(|name| name.starts_with("everr-dev"))
            .unwrap_or(false);
        if is_dev { "everr-dev" } else { "everr" }
    })
}

pub const fn default_api_base_url() -> &'static str {
    DEFAULT_API_BASE_URL
}

pub const fn default_docs_base_url() -> &'static str {
    DEFAULT_DOCS_BASE_URL
}

pub const fn default_session_file_name() -> &'static str {
    DEFAULT_SESSION_FILE_NAME
}

pub const fn session_namespace() -> &'static str {
    SESSION_NAMESPACE
}

#[cfg(debug_assertions)]
const TELEMETRY_SUBDIR: &str = "telemetry-dev";

#[cfg(not(debug_assertions))]
const TELEMETRY_SUBDIR: &str = "telemetry";

#[cfg(debug_assertions)]
pub const OTLP_HTTP_PORT: u16 = 54318;

#[cfg(not(debug_assertions))]
pub const OTLP_HTTP_PORT: u16 = 54418;

#[cfg(debug_assertions)]
pub const HEALTHCHECK_PORT: u16 = 54319;

#[cfg(not(debug_assertions))]
pub const HEALTHCHECK_PORT: u16 = 54419;

/// Origin (scheme + host + port) for the local OTLP HTTP collector.
/// Instrumented code points its OTLP HTTP exporter at this.
pub fn otlp_http_origin() -> String {
    format!("http://127.0.0.1:{OTLP_HTTP_PORT}")
}

/// Resolve the local-only diagnostic telemetry directory for this build.
///
/// On macOS this is `~/Library/Application Support/everr/telemetry[-dev]/`.
/// Debug builds (including `everr-dev` and `cargo tauri dev`) resolve to
/// `telemetry-dev/`; release builds resolve to `telemetry/`.
///
/// Both the Desktop app sidecar supervisor (writer) and the CLI read path
/// (reader) MUST call this function so the two sides cannot drift. See the
/// spec's On-disk contract section for the rationale.
pub fn telemetry_dir() -> anyhow::Result<PathBuf> {
    let base = dirs::data_local_dir().context("failed to resolve user local data dir")?;
    Ok(base.join(SESSION_NAMESPACE).join(TELEMETRY_SUBDIR))
}

/// Resolve the sibling telemetry directory — used by the CLI for the
/// "wrong build" failure-mode detection. Returns the release dir when this
/// build is debug, and vice versa.
pub fn telemetry_dir_sibling() -> anyhow::Result<PathBuf> {
    let base = dirs::data_local_dir().context("failed to resolve user local data dir")?;
    #[cfg(debug_assertions)]
    let sibling = "telemetry";
    #[cfg(not(debug_assertions))]
    let sibling = "telemetry-dev";
    Ok(base.join(SESSION_NAMESPACE).join(sibling))
}

#[cfg(test)]
mod tests {
    use super::{
        build_type_label, default_api_base_url, default_session_file_name, session_namespace,
        telemetry_dir, telemetry_dir_sibling,
    };

    #[test]
    fn debug_builds_use_local_defaults() {
        assert_eq!(build_type_label(), "debug");
        assert_eq!(default_api_base_url(), "http://localhost:5173");
        assert_eq!(default_session_file_name(), "session-dev.json");
        assert_eq!(session_namespace(), "everr");
    }

    #[test]
    fn telemetry_dir_uses_everr_namespace_and_debug_subdir() {
        let dir = telemetry_dir().expect("resolve telemetry dir");
        let components: Vec<String> = dir
            .components()
            .rev()
            .take(2)
            .map(|c: std::path::Component| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        // On debug builds the last two components are `everr` then `telemetry-dev`.
        assert_eq!(components[0], "telemetry-dev");
        assert_eq!(components[1], "everr");
    }

    #[test]
    fn telemetry_dir_sibling_differs_from_primary_and_shares_parent() {
        let primary = telemetry_dir().expect("resolve telemetry dir");
        let sibling = telemetry_dir_sibling().expect("resolve sibling telemetry dir");
        assert_ne!(primary, sibling);
        assert_eq!(primary.parent(), sibling.parent());
    }
}
