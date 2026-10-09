use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};
use fs2::FileExt;
use serde::{Deserialize, Serialize};

use crate::build;

const NO_ACTIVE_SESSION: &str = "no active session";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Session {
    pub api_base_url: String,
    pub token: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct AppState {
    pub session: Option<Session>,
}

impl Default for AppState {
    fn default() -> Self {
        Self { session: None }
    }
}

#[derive(Debug, Clone)]
pub struct AppStateStore {
    namespace: String,
    state_file_name: String,
}

impl AppStateStore {
    pub fn for_namespace(namespace: impl Into<String>) -> Self {
        Self::for_namespace_with_file_name(namespace, build::default_session_file_name())
    }

    pub fn for_namespace_with_file_name(
        namespace: impl Into<String>,
        state_file_name: impl Into<String>,
    ) -> Self {
        Self {
            namespace: namespace.into(),
            state_file_name: state_file_name.into(),
        }
    }

    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    pub fn session_file_name(&self) -> &str {
        &self.state_file_name
    }

    pub fn session_file_path(&self) -> Result<PathBuf> {
        let config_dir = dirs::config_dir().context("failed to resolve user config dir")?;
        Ok(config_dir.join(&self.namespace).join(&self.state_file_name))
    }

    pub fn load_state(&self) -> Result<AppState> {
        self.load_state_unlocked()
    }

    fn load_state_unlocked(&self) -> Result<AppState> {
        let path = self.session_file_path()?;
        if !path.exists() {
            return Ok(AppState::default());
        }

        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return Ok(AppState::default());
        };
        let Some(object) = value.as_object_mut() else {
            return Ok(AppState::default());
        };
        // Desktop-era session files included settings. Ignore that field while
        // retaining strict validation of the session envelope.
        object.remove("settings");
        if object.len() != 1 || !object.contains_key("session") {
            return Ok(AppState::default());
        }

        match serde_json::from_value::<AppState>(value) {
            Ok(state) => Ok(state),
            Err(_) => Ok(AppState::default()),
        }
    }

    pub fn save_state(&self, state: &AppState) -> Result<()> {
        let path = self.session_file_path()?;
        if state == &AppState::default() {
            if path.exists() {
                fs::remove_file(&path)
                    .with_context(|| format!("failed to remove {}", path.display()))?;
            }
            return Ok(());
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }

        let serialized =
            serde_json::to_string_pretty(state).context("failed to serialize app state")?;
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, serialized)
            .with_context(|| format!("failed to write {}", tmp.display()))?;
        fs::rename(&tmp, &path)
            .with_context(|| format!("failed to rename {} to {}", tmp.display(), path.display()))?;
        Ok(())
    }

    pub fn load_session(&self) -> Result<Session> {
        self.load_state()?
            .session
            .ok_or_else(|| anyhow!(NO_ACTIVE_SESSION))
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        let _lock = self.lock_exclusive()?;
        self.save_state(&AppState {
            session: Some(session.clone()),
        })?;
        Ok(())
    }

    pub fn clear_session(&self) -> Result<bool> {
        let _lock = self.lock_exclusive()?;
        let mut state = self.load_state_unlocked()?;
        if state.session.is_none() {
            return Ok(false);
        }

        state.session = None;
        self.save_state(&state)?;
        Ok(true)
    }

    pub fn has_active_session(&self) -> Result<bool> {
        Ok(self.load_state()?.session.is_some())
    }

    pub fn load_session_for_api_base_url(&self, expected_api_base_url: &str) -> Result<Session> {
        let session = self.load_session()?;
        if session_matches_api_base_url(&session.api_base_url, expected_api_base_url) {
            return Ok(session);
        }

        bail!(NO_ACTIVE_SESSION);
    }

    /// Deletes the state file entirely, removing the saved session.
    pub fn wipe(&self) -> Result<()> {
        let path = self.session_file_path()?;
        if path.exists() {
            fs::remove_file(&path)
                .with_context(|| format!("failed to remove {}", path.display()))?;
        }
        Ok(())
    }

    pub fn has_active_session_for_api_base_url(&self, expected_api_base_url: &str) -> Result<bool> {
        match self.load_session_for_api_base_url(expected_api_base_url) {
            Ok(_) => Ok(true),
            Err(error) if is_no_active_session_error(&error) => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn lock_exclusive(&self) -> Result<fs::File> {
        self.acquire_lock()
    }

    fn acquire_lock(&self) -> Result<fs::File> {
        let lock_path = self.session_file_path()?.with_extension("lock");
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let lock_file = fs::File::create(&lock_path)
            .with_context(|| format!("failed to create lock file {}", lock_path.display()))?;
        lock_file
            .lock_exclusive()
            .with_context(|| format!("failed to acquire lock on {}", lock_path.display()))?;
        Ok(lock_file)
    }
}

pub fn is_no_active_session_error(error: &anyhow::Error) -> bool {
    error.to_string() == NO_ACTIVE_SESSION
}

fn session_matches_api_base_url(actual: &str, expected: &str) -> bool {
    actual.trim_end_matches('/') == expected.trim_end_matches('/')
}

#[cfg(test)]
mod tests {
    use super::{AppState, AppStateStore, Session};
    use crate::test_support::ENV_LOCK;
    use serde_json::json;
    use tempfile::tempdir;

    fn session() -> Session {
        Session {
            api_base_url: "https://app.everr.dev".into(),
            token: "test-token".into(),
        }
    }

    fn write_fixture(store: &AppStateStore, value: serde_json::Value) {
        let path = store.session_file_path().unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, value.to_string()).unwrap();
    }

    #[test]
    fn session_round_trips_atomically_and_uses_a_lock() {
        with_temp_config_home(|store| {
            store.save_session(&session()).unwrap();
            assert_eq!(store.load_session().unwrap(), session());
            let path = store.session_file_path().unwrap();
            assert!(path.with_extension("lock").is_file());
            assert!(!path.with_extension("tmp").exists());
            assert_eq!(
                store.session_file_name(),
                crate::build::default_session_file_name()
            );
            assert_eq!(store.namespace(), "everr");
        });
    }

    #[test]
    fn desktop_session_files_remain_readable_and_save_without_unused_settings() {
        with_temp_config_home(|store| {
            write_fixture(
                &store,
                json!({"session": session(), "settings": {
                    "wizard_completed": true, "completed_base_url": "https://app.everr.dev",
                    "notification_emails": ["old@example.test"], "user_profile": {"name": "Old profile"}
                }}),
            );
            assert_eq!(store.load_session().unwrap(), session());
            store.save_session(&session()).unwrap();
            let saved: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(store.session_file_path().unwrap()).unwrap(),
            )
            .unwrap();
            assert_eq!(saved, json!({"session": session()}));
        });
    }

    #[test]
    fn malformed_or_unsupported_envelopes_do_not_create_a_session() {
        with_temp_config_home(|store| {
            for value in [
                json!(null),
                json!({"token":"old", "api_base_url":"https://app.everr.dev"}),
                json!({"settings": {}}),
                json!({"session":session(), "unknown":true}),
                json!({"session":{"token":42}}),
            ] {
                write_fixture(&store, value);
                assert_eq!(store.load_state().unwrap(), AppState::default());
            }
        });
    }

    #[test]
    fn mismatched_base_url_preserves_the_saved_session() {
        with_temp_config_home(|store| {
            store.save_session(&session()).unwrap();
            assert!(
                store
                    .load_session_for_api_base_url("http://localhost:5173")
                    .is_err()
            );
            assert_eq!(store.load_session().unwrap(), session());
            assert!(
                store
                    .load_session_for_api_base_url("https://app.everr.dev/")
                    .is_ok()
            );
        });
    }

    #[test]
    fn logout_removes_the_session_file_and_is_repeatable() {
        with_temp_config_home(|store| {
            store.save_session(&session()).unwrap();
            assert!(store.clear_session().unwrap());
            assert!(!store.session_file_path().unwrap().exists());
            assert!(!store.clear_session().unwrap());
        });
    }

    #[test]
    fn custom_state_filename_is_preserved() {
        let store = AppStateStore::for_namespace_with_file_name("everr", "custom-session.json");
        assert_eq!(store.session_file_name(), "custom-session.json");
    }

    fn with_temp_config_home(test: impl FnOnce(AppStateStore)) {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let temp = tempdir().expect("tempdir");
        let config_home = temp.path().join("config");
        std::fs::create_dir_all(&config_home).expect("create config dir");

        let original_home = std::env::var_os("HOME");
        let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
        unsafe {
            std::env::set_var("HOME", temp.path());
            std::env::set_var("XDG_CONFIG_HOME", &config_home);
        }

        let store = AppStateStore::for_namespace("everr");
        test(store);

        match original_home {
            Some(value) => unsafe { std::env::set_var("HOME", value) },
            None => unsafe { std::env::remove_var("HOME") },
        }
        match original_xdg {
            Some(value) => unsafe { std::env::set_var("XDG_CONFIG_HOME", value) },
            None => unsafe { std::env::remove_var("XDG_CONFIG_HOME") },
        }
    }
}
