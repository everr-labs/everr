use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};

use crate::build;

const NO_ACTIVE_SESSION: &str = "no active session";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Session {
    pub api_base_url: String,
    pub token: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct WizardState {
    pub wizard_completed: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct UserProfile {
    pub email: String,
    pub name: String,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    pub completed_base_url: Option<String>,
    #[serde(flatten)]
    pub wizard_state: WizardState,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notification_emails: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_profile: Option<UserProfile>,
}

impl AppSettings {
    pub fn mark_setup_complete(&mut self, current_base_url: &str) {
        self.completed_base_url = Some(current_base_url.to_string());
        self.wizard_state.wizard_completed = true;
    }

    pub fn apply_runtime_base_url(&mut self, current_base_url: &str) {
        if self.wizard_state.wizard_completed
            && self.completed_base_url.as_deref() != Some(current_base_url)
        {
            self.wizard_state.wizard_completed = false;
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct AppState {
    pub session: Option<Session>,
    pub settings: AppSettings,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            session: None,
            settings: AppSettings::default(),
        }
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
        let path = self.session_file_path()?;
        if !path.exists() {
            return Ok(AppState::default());
        }

        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return Ok(AppState::default());
        };
        let Some(object) = value.as_object() else {
            return Ok(AppState::default());
        };
        if object.len() != 2 || !object.contains_key("session") || !object.contains_key("settings")
        {
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
        fs::write(&path, serialized)
            .with_context(|| format!("failed to write {}", path.display()))?;
        Ok(())
    }

    pub fn update_state<F, T>(&self, mutate: F) -> Result<T>
    where
        F: FnOnce(&mut AppState) -> T,
    {
        let mut state = self.load_state()?;
        let result = mutate(&mut state);
        self.save_state(&state)?;
        Ok(result)
    }

    pub fn load_session(&self) -> Result<Session> {
        self.load_state()?
            .session
            .ok_or_else(|| anyhow!(NO_ACTIVE_SESSION))
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        self.update_state(|state| state.session = Some(session.clone()))?;
        Ok(())
    }

    pub fn clear_session(&self) -> Result<bool> {
        let mut state = self.load_state()?;
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

        self.clear_session()?;
        bail!(NO_ACTIVE_SESSION);
    }

    pub fn has_active_session_for_api_base_url(&self, expected_api_base_url: &str) -> Result<bool> {
        match self.load_session_for_api_base_url(expected_api_base_url) {
            Ok(_) => Ok(true),
            Err(error) if is_no_active_session_error(&error) => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn clear_mismatched_session(&self, expected_api_base_url: &str) -> Result<bool> {
        let mut state = self.load_state()?;
        let Some(session) = &state.session else {
            return Ok(false);
        };

        if session_matches_api_base_url(&session.api_base_url, expected_api_base_url) {
            return Ok(false);
        }

        state.session = None;
        self.save_state(&state)?;
        Ok(true)
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
    use std::sync::Mutex;

    use serde_json::json;
    use tempfile::tempdir;

    use super::{AppSettings, AppState, AppStateStore, Session, UserProfile, WizardState};
    use crate::build;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn default_state_store_matches_current_build_defaults() {
        let store = AppStateStore::for_namespace("everr");

        assert_eq!(store.namespace(), "everr");
        assert_eq!(
            store.session_file_name(),
            build::default_session_file_name()
        );
    }

    #[test]
    fn custom_state_file_name_is_preserved() {
        let store = AppStateStore::for_namespace_with_file_name("everr", "session-dev.json");

        assert_eq!(store.namespace(), "everr");
        assert_eq!(store.session_file_name(), "session-dev.json");
    }

    #[test]
    fn app_state_round_trips() {
        with_temp_config_home(|store| {
            let state = AppState {
                session: Some(Session {
                    api_base_url: "https://app.everr.dev".to_string(),
                    token: "token-123".to_string(),
                }),
                settings: AppSettings {
                    completed_base_url: Some("https://app.everr.dev".to_string()),
                    wizard_state: WizardState {
                        wizard_completed: true,
                    },
                    notification_emails: vec!["user@example.com".to_string()],
                    user_profile: Some(UserProfile {
                        email: "user@example.com".to_string(),
                        name: "Test User".to_string(),
                        profile_url: None,
                    }),
                },
            };

            store.save_state(&state).expect("save state");

            assert_eq!(store.load_state().expect("load state"), state);
        });
    }

    #[test]
    fn saving_session_preserves_settings() {
        with_temp_config_home(|store| {
            store
                .save_state(&AppState {
                    session: None,
                    settings: AppSettings {
                        completed_base_url: Some("https://app.everr.dev".to_string()),
                        wizard_state: WizardState {
                            wizard_completed: true,
                        },
                        ..AppSettings::default()
                    },
                })
                .expect("save state");

            store
                .save_session(&Session {
                    api_base_url: "https://app.everr.dev".to_string(),
                    token: "token-123".to_string(),
                })
                .expect("save session");

            let state = store.load_state().expect("load state");
            assert_eq!(
                state.settings.completed_base_url.as_deref(),
                Some("https://app.everr.dev")
            );
            assert!(state.settings.wizard_state.wizard_completed);
        });
    }

    #[test]
    fn updating_settings_preserves_session() {
        with_temp_config_home(|store| {
            store
                .save_state(&AppState {
                    session: Some(Session {
                        api_base_url: "https://app.everr.dev".to_string(),
                        token: "token-123".to_string(),
                    }),
                    settings: AppSettings::default(),
                })
                .expect("save state");

            store
                .update_state(|state| {
                    state.settings.mark_setup_complete("https://app.everr.dev");
                })
                .expect("update state");

            let state = store.load_state().expect("load state");
            assert_eq!(
                state.session.as_ref().map(|session| session.token.as_str()),
                Some("token-123")
            );
            assert!(state.settings.wizard_state.wizard_completed);
        });
    }

    #[test]
    fn clearing_session_leaves_settings_intact() {
        with_temp_config_home(|store| {
            store
                .save_state(&AppState {
                    session: Some(Session {
                        api_base_url: "https://app.everr.dev".to_string(),
                        token: "token-123".to_string(),
                    }),
                    settings: AppSettings {
                        completed_base_url: Some("https://app.everr.dev".to_string()),
                        wizard_state: WizardState {
                            wizard_completed: true,
                        },
                        ..AppSettings::default()
                    },
                })
                .expect("save state");

            assert!(store.clear_session().expect("clear session"));

            let state = store.load_state().expect("load state");
            assert!(state.session.is_none());
            assert_eq!(
                state.settings.completed_base_url.as_deref(),
                Some("https://app.everr.dev")
            );
            assert!(state.settings.wizard_state.wizard_completed);
        });
    }

    #[test]
    fn load_session_for_api_base_url_clears_mismatched_session_only() {
        with_temp_config_home(|store| {
            store
                .save_state(&AppState {
                    session: Some(Session {
                        api_base_url: "https://app.everr.dev".to_string(),
                        token: "token-123".to_string(),
                    }),
                    settings: AppSettings {
                        completed_base_url: Some("https://app.everr.dev".to_string()),
                        wizard_state: WizardState {
                            wizard_completed: true,
                        },
                        ..AppSettings::default()
                    },
                })
                .expect("save state");

            let error = store
                .load_session_for_api_base_url("http://localhost:5173")
                .expect_err("mismatched session should be rejected");
            assert_eq!(error.to_string(), "no active session");

            let state = store.load_state().expect("load state");
            assert!(state.session.is_none());
            assert_eq!(
                state.settings.completed_base_url.as_deref(),
                Some("https://app.everr.dev")
            );
            assert!(state.settings.wizard_state.wizard_completed);
        });
    }

    #[test]
    fn unsupported_old_format_loads_as_default_state() {
        with_temp_config_home(|store| {
            let path = store.session_file_path().expect("state path");
            let parent = path.parent().expect("state parent");
            std::fs::create_dir_all(parent).expect("create state dir");
            std::fs::write(
                &path,
                serde_json::to_string_pretty(&json!({
                "api_base_url": "https://app.everr.dev",
                "token": "token-123",
                    "settings": {
                        "completed_base_url": "https://app.everr.dev",
                        "wizard_completed": true,
                    }
                }))
                .expect("serialize old state"),
            )
            .expect("write old state");

            assert_eq!(store.load_state().expect("load state"), AppState::default());
        });
    }

    #[test]
    fn first_successful_save_after_unsupported_load_rewrites_canonical_format() {
        with_temp_config_home(|store| {
            let path = store.session_file_path().expect("state path");
            let parent = path.parent().expect("state parent");
            std::fs::create_dir_all(parent).expect("create state dir");
            std::fs::write(
                &path,
                serde_json::to_string_pretty(&json!({
                    "settings": {
                        "wizard_completed": true,
                    }
                }))
                .expect("serialize old state"),
            )
            .expect("write old state");

            assert_eq!(store.load_state().expect("load state"), AppState::default());

            store
                .update_state(|state| {
                    state.settings.completed_base_url = Some("https://app.everr.dev".to_string());
                })
                .expect("save canonical state");

            let raw = std::fs::read_to_string(&path).expect("read canonical state");
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&raw).expect("parse canonical state"),
                json!({
                    "session": null,
                    "settings": {
                        "completed_base_url": "https://app.everr.dev",
                        "wizard_completed": false,
                    }
                })
            );
        });
    }

    #[test]
    fn settings_without_notification_emails_loads_with_empty_defaults() {
        with_temp_config_home(|store| {
            let path = store.session_file_path().expect("state path");
            let parent = path.parent().expect("state parent");
            std::fs::create_dir_all(parent).expect("create state dir");
            std::fs::write(
                &path,
                serde_json::to_string_pretty(&serde_json::json!({
                    "session": null,
                    "settings": {
                        "completed_base_url": "https://app.everr.dev",
                        "wizard_completed": true
                    }
                }))
                .expect("serialize"),
            )
            .expect("write");

            let state = store.load_state().expect("load state");
            assert!(state.settings.notification_emails.is_empty());
            assert!(state.settings.user_profile.is_none());
            assert!(state.settings.wizard_state.wizard_completed);
        });
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
