pub const CLI_COMMAND_NAME: &str = "everr";
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
pub const DEFAULT_SESSION_FILE_NAME: &str = "session-dev.json";

#[cfg(not(debug_assertions))]
pub const DEFAULT_SESSION_FILE_NAME: &str = "session.json";

pub const fn build_type_label() -> &'static str {
    BUILD_TYPE_LABEL
}

pub const fn command_name() -> &'static str {
    CLI_COMMAND_NAME
}

pub const fn default_api_base_url() -> &'static str {
    DEFAULT_API_BASE_URL
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
        build_type_label, command_name, default_api_base_url, default_session_file_name,
        session_namespace,
    };

    #[test]
    fn debug_builds_use_local_defaults() {
        assert_eq!(build_type_label(), "debug");
        assert_eq!(command_name(), "everr");
        assert_eq!(default_api_base_url(), "http://localhost:5173");
        assert_eq!(default_session_file_name(), "session-dev.json");
        assert_eq!(session_namespace(), "everr");
    }
}
