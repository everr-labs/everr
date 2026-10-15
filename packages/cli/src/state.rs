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

#[derive(Default, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct SessionFile {
    session: Option<Session>,
}

/// Reads and removes the pre-profile session file during migration.
#[derive(Debug, Clone)]
pub struct LegacySessionStore {
    namespace: String,
    directory: Option<PathBuf>,
}

impl LegacySessionStore {
    pub fn for_namespace(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
            directory: None,
        }
    }

    pub fn at(directory: impl Into<PathBuf>) -> Self {
        Self {
            namespace: String::new(),
            directory: Some(directory.into()),
        }
    }

    pub fn user() -> Self {
        Self::for_namespace(build::session_namespace())
    }

    pub fn session_file_path(&self) -> Result<PathBuf> {
        if let Some(directory) = &self.directory {
            return Ok(directory.join(build::default_session_file_name()));
        }

        if let Some(directory) = std::env::var_os("EVERR_CONFIG_DIR") {
            let directory = PathBuf::from(directory);
            if !directory.is_absolute() {
                bail!("EVERR_CONFIG_DIR must be an absolute path");
            }
            return Ok(directory.join(build::default_session_file_name()));
        }
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

    pub fn load_session(&self) -> Result<Session> {
        self.load_file()?
            .session
            .ok_or_else(|| anyhow!(NO_ACTIVE_SESSION))
    }

    pub fn clear_session(&self) -> Result<bool> {
        let _lock = self.acquire_lock()?;
        let file = self.load_file()?;
        if file.session.is_none() {
            return Ok(false);
        }

        fs::remove_file(self.session_file_path()?)?;
        Ok(true)
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

#[cfg(test)]
mod tests {
    use super::{LegacySessionStore, Session, is_no_active_session_error};
    use crate::test_support::ENV_LOCK;
    use serde_json::json;
    use tempfile::tempdir;

    fn session() -> Session {
        Session {
            api_base_url: "https://app.everr.dev".into(),
            token: "test-token".into(),
        }
    }

    fn write_fixture(store: &LegacySessionStore, value: serde_json::Value) {
        let path = store.session_file_path().unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, value.to_string()).unwrap();
    }

    #[test]
    fn desktop_session_files_remain_readable_for_migration() {
        with_temp_config_home(|store| {
            write_fixture(
                &store,
                json!({"session": session(), "settings": {
                    "wizard_completed": true, "completed_base_url": "https://app.everr.dev",
                    "notification_emails": ["old@example.test"], "user_profile": {"name": "Old profile"}
                }}),
            );
            assert_eq!(store.load_session().unwrap(), session());
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
    fn logout_removes_the_session_file_and_is_repeatable() {
        with_temp_config_home(|store| {
            write_fixture(&store, json!({"session": session()}));
            assert!(store.clear_session().unwrap());
            assert!(!store.session_file_path().unwrap().exists());
            assert!(!store.clear_session().unwrap());
        });
    }

    fn with_temp_config_home(test: impl FnOnce(LegacySessionStore)) {
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

        let store = LegacySessionStore::for_namespace("everr");
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
