use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use fs2::FileExt;
use serde::{Deserialize, Serialize};

use crate::build;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Session {
    pub api_base_url: String,
    pub token: String,
}

#[derive(Default, Deserialize, Serialize)]
struct SessionFile {
    session: Option<Session>,
}

pub struct SessionStore {
    directory: PathBuf,
}

impl SessionStore {
    pub fn user() -> Result<Self> {
        Ok(Self::at(user_config_directory()?))
    }

    pub fn at(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    pub fn session_file_path(&self) -> PathBuf {
        self.directory.join(build::default_session_file_name())
    }

    pub fn load_session(&self) -> Result<Option<Session>> {
        let path = self.session_file_path();
        if !path.try_exists()? {
            return Ok(None);
        }
        let file: SessionFile = serde_json::from_str(&fs::read_to_string(&path)?)
            .with_context(|| format!("Invalid session file {}", path.display()))?;
        Ok(file.session)
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        let _lock = self.lock()?;
        let mut file = tempfile::NamedTempFile::new_in(&self.directory)?;
        file.write_all(&serde_json::to_vec_pretty(&SessionFile {
            session: Some(session.clone()),
        })?)?;
        file.as_file().sync_all()?;
        file.persist(self.session_file_path())?;
        Ok(())
    }

    pub fn clear_session(&self, expected: &Session) -> Result<bool> {
        let _lock = self.lock()?;
        if self.load_session()?.as_ref() != Some(expected) {
            return Ok(false);
        }
        fs::remove_file(self.session_file_path())?;
        Ok(true)
    }

    pub fn wipe(&self) -> Result<()> {
        let _lock = self.lock()?;
        let path = self.session_file_path();
        if path.try_exists()? {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    fn lock(&self) -> Result<File> {
        fs::create_dir_all(&self.directory)?;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(self.session_file_path().with_extension("lock"))?;
        file.lock_exclusive()?;
        Ok(file)
    }
}

pub(crate) fn user_config_directory() -> Result<PathBuf> {
    if let Some(directory) = std::env::var_os("EVERR_CONFIG_DIR") {
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            bail!("EVERR_CONFIG_DIR must be an absolute path");
        }
        return Ok(directory);
    }
    Ok(dirs::config_dir()
        .context("failed to resolve user config dir")?
        .join(build::session_namespace()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_session_files_remain_readable_and_saving_keeps_only_url_and_token() {
        let directory = tempfile::tempdir().unwrap();
        let store = SessionStore::at(directory.path());
        let contents = serde_json::json!({
            "session": { "api_base_url": "https://example.test", "token": "old-token" },
            "settings": { "wizard_completed": true }
        });
        fs::write(store.session_file_path(), contents.to_string()).unwrap();
        let mut session = store.load_session().unwrap().unwrap();
        session.token = "new-token".into();
        store.save_session(&session).unwrap();
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(store.session_file_path()).unwrap()).unwrap();
        assert_eq!(
            saved,
            serde_json::json!({
                "session": { "api_base_url": "https://example.test", "token": "new-token" }
            })
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(store.session_file_path())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn clearing_a_session_preserves_a_newer_login() {
        let directory = tempfile::tempdir().unwrap();
        let store = SessionStore::at(directory.path());
        let old = Session {
            api_base_url: "https://example.test".into(),
            token: "old-token".into(),
        };
        let new = Session {
            token: "new-token".into(),
            ..old.clone()
        };
        store.save_session(&old).unwrap();
        store.save_session(&new).unwrap();
        assert!(!store.clear_session(&old).unwrap());
        assert_eq!(store.load_session().unwrap(), Some(new.clone()));
        assert!(store.clear_session(&new).unwrap());
        assert!(store.load_session().unwrap().is_none());
        assert!(!store.clear_session(&new).unwrap());
    }
}
