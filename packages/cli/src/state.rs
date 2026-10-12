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

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct SessionFile {
    session: Option<Session>,
}

#[derive(Debug, Clone)]
pub struct SessionStore {
    namespace: String,
}

impl SessionStore {
    pub fn for_namespace(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
        }
    }

    pub fn session_file_path(&self) -> Result<PathBuf> {
        let config_dir = dirs::config_dir().context("failed to resolve user config dir")?;
        Ok(config_dir
            .join(&self.namespace)
            .join(build::default_session_file_name()))
    }

    fn load_file(&self) -> Result<SessionFile> {
        let path = self.session_file_path()?;
        if !path.exists() {
            return Ok(SessionFile::default());
        }

        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return Ok(SessionFile::default());
        };
        let Some(object) = value.as_object_mut() else {
            return Ok(SessionFile::default());
        };
        // Desktop-era session files included settings. Ignore that field while
        // retaining strict validation of the session envelope.
        object.remove("settings");
        if object.len() != 1 || !object.contains_key("session") {
            return Ok(SessionFile::default());
        }

        match serde_json::from_value::<SessionFile>(value) {
            Ok(file) => Ok(file),
            Err(_) => Ok(SessionFile::default()),
        }
    }

    fn save_file(&self, file: &SessionFile) -> Result<()> {
        let path = self.session_file_path()?;
        if file.session.is_none() {
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
            serde_json::to_string_pretty(file).context("failed to serialize session file")?;
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, serialized)
            .with_context(|| format!("failed to write {}", tmp.display()))?;
        fs::rename(&tmp, &path)
            .with_context(|| format!("failed to rename {} to {}", tmp.display(), path.display()))?;
        Ok(())
    }

    pub fn load_session(&self) -> Result<Session> {
        self.load_file()?
            .session
            .ok_or_else(|| anyhow!(NO_ACTIVE_SESSION))
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        let _lock = self.acquire_lock()?;
        self.save_file(&SessionFile {
            session: Some(session.clone()),
        })?;
        Ok(())
    }

    pub fn clear_session(&self) -> Result<bool> {
        let _lock = self.acquire_lock()?;
        let file = self.load_file()?;
        if file.session.is_none() {
            return Ok(false);
        }

        self.save_file(&SessionFile::default())?;
        Ok(true)
    }

    pub fn load_session_for_api_base_url(&self, expected_api_base_url: &str) -> Result<Session> {
        let session = self.load_session()?;
        if session_matches_api_base_url(&session.api_base_url, expected_api_base_url) {
            return Ok(session);
        }

        bail!(NO_ACTIVE_SESSION);
    }

    /// Deletes the session file entirely, including malformed files.
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
    use super::{Session, SessionStore, is_no_active_session_error};
    use crate::test_support::ENV_LOCK;
    use serde_json::json;
    use tempfile::tempdir;

    fn session() -> Session {
        Session {
            api_base_url: "https://app.everr.dev".into(),
            token: "test-token".into(),
        }
    }

    fn write_fixture(store: &SessionStore, value: serde_json::Value) {
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
                path.file_name().unwrap(),
                crate::build::default_session_file_name(),
            );
            assert_eq!(path.parent().unwrap().file_name().unwrap(), "everr");
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
                assert!(is_no_active_session_error(
                    &store.load_session().unwrap_err()
                ));
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

    fn with_temp_config_home(test: impl FnOnce(SessionStore)) {
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

        let store = SessionStore::for_namespace("everr");
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
