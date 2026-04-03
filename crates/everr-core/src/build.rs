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

#[cfg(test)]
mod tests {
    use super::{
        build_type_label, default_api_base_url, default_session_file_name, session_namespace,
    };

    #[test]
    fn debug_builds_use_local_defaults() {
        assert_eq!(build_type_label(), "debug");
        assert_eq!(default_api_base_url(), "http://localhost:5173");
        assert_eq!(default_session_file_name(), "session-dev.json");
        assert_eq!(session_namespace(), "everr");
    }
}
