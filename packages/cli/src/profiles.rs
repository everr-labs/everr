use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use fs2::FileExt;
use serde::{Deserialize, Serialize};

use crate::{
    api::ApiClient,
    state::{LegacySessionStore, Session},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub url: String,
    pub organization_id: String,
}

impl Target {
    pub fn validate(&mut self) -> Result<()> {
        self.url = normalize_url(&self.url)?;
        if self.organization_id.trim().is_empty() {
            bail!("organizationId must not be empty");
        }
        Ok(())
    }

    pub fn client(&self, session: &Session) -> Result<ApiClient> {
        if normalize_url(&session.api_base_url)? != self.url {
            bail!("Saved credentials belong to a different installation. Run `everr login`.");
        }
        ApiClient::from_session(session)?.for_organization(&self.organization_id)
    }
}

pub fn normalize_url(value: &str) -> Result<String> {
    let mut url = reqwest::Url::parse(value.trim()).context("Invalid installation URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("Installation URL must be an HTTP(S) URL without credentials, query, or fragment");
    }
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_owned())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    #[serde(flatten)]
    pub target: Target,
    pub user_id: String,
    pub email: String,
    pub organization_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    version: u32,
    pub current_profile: Option<String>,
    pub profiles: BTreeMap<String, Profile>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            current_profile: None,
            profiles: BTreeMap::new(),
        }
    }
}

impl Config {
    pub fn select(
        &self,
        explicit: Option<&str>,
        project: &Project,
    ) -> Result<Option<(String, Profile)>> {
        if let Some(name) = explicit {
            return Ok(Some((
                name.to_owned(),
                self.profiles
                    .get(name)
                    .with_context(|| {
                        format!("Unknown profile '{name}'. Run `everr login --profile {name}`.")
                    })?
                    .clone(),
            )));
        }
        if let Some(target) = &project.target {
            let matching: Vec<_> = self
                .profiles
                .iter()
                .filter(|(_, profile)| &profile.target == target)
                .collect();
            return match matching.as_slice() {
                [(name, profile)] => Ok(Some(((*name).clone(), (*profile).clone()))),
                [] => Ok(None),
                _ => bail!(
                    "Multiple profiles match this project. Select an account with --profile or EVERR_PROFILE."
                ),
            };
        }
        match &self.current_profile {
            Some(name) => Ok(Some((
                name.clone(),
                self.profiles
                    .get(name)
                    .with_context(|| format!("Unknown current profile '{name}'"))?
                    .clone(),
            ))),
            None => Ok(None),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectConfig {
    version: u32,
    #[serde(flatten)]
    target: Target,
}

pub struct Project {
    pub root: Option<PathBuf>,
    pub target: Option<Target>,
}

impl Project {
    pub fn discover(cwd: &Path) -> Result<Self> {
        let cwd = cwd.canonicalize()?;
        let root = cwd
            .ancestors()
            .find(|dir| dir.join(".git").exists())
            .map(Path::to_path_buf);
        let mut project = Self { root, target: None };
        if let Some(root) = &project.root {
            for dir in cwd.ancestors() {
                let path = dir.join(".everr/config.yaml");
                if path.try_exists()? {
                    let config: ProjectConfig =
                        serde_yaml::from_str(&fs::read_to_string(&path)?)
                            .with_context(|| format!("Invalid {}", path.display()))?;
                    if config.version != 1 {
                        bail!("Unsupported project config version in {}", path.display());
                    }
                    let mut target = config.target;
                    target.validate()?;
                    project.target = Some(target);
                    break;
                }
                if dir == root {
                    break;
                }
            }
        }
        Ok(project)
    }

    pub fn save_if_absent(&self, target: &Target) -> Result<()> {
        if self.target.is_some() {
            return Ok(());
        }
        let Some(root) = &self.root else {
            return Ok(());
        };
        let path = root.join(".everr/config.yaml");
        fs::create_dir_all(path.parent().unwrap())?;
        let config = ProjectConfig {
            version: 1,
            target: target.clone(),
        };
        let serialized = serde_yaml::to_string(&config)?;
        let mut temporary = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
        temporary.write_all(serialized.as_bytes())?;
        temporary.as_file().sync_all()?;
        temporary.persist_noclobber(&path).with_context(|| {
            format!(
                "Could not create {} (existing configuration is preserved)",
                path.display()
            )
        })?;
        println!("Project target saved to {}", path.display());
        Ok(())
    }
}

#[derive(Clone)]
pub struct ProfileStore {
    directory: PathBuf,
}

impl ProfileStore {
    pub fn user() -> Result<Self> {
        Ok(Self::at(
            LegacySessionStore::user()
                .session_file_path()?
                .parent()
                .unwrap(),
        ))
    }

    pub fn at(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    fn path(&self, kind: &str, extension: &str) -> PathBuf {
        let suffix = if cfg!(debug_assertions) { "-dev" } else { "" };
        self.directory.join(format!("{kind}{suffix}.{extension}"))
    }

    pub fn load(&self) -> Result<Config> {
        let path = self.path("config", "yaml");
        if !path.try_exists()? {
            return Ok(Config::default());
        }
        let mut config: Config = serde_yaml::from_str(&fs::read_to_string(&path)?)
            .with_context(|| format!("Invalid {}", path.display()))?;
        if config.version != 1 {
            bail!("Unsupported global config version in {}", path.display());
        }
        for (name, profile) in &mut config.profiles {
            validate_name(name)?;
            profile.target.validate()?;
            if profile.user_id.is_empty() || profile.email.is_empty() {
                bail!("Profile '{name}' is missing account identity");
            }
        }
        Ok(config)
    }

    pub(crate) fn credentials(&self) -> Result<BTreeMap<String, Session>> {
        let path = self.path("credentials", "json");
        if !path.try_exists()? {
            return Ok(BTreeMap::new());
        }
        serde_json::from_str(&fs::read_to_string(&path)?)
            .context("Invalid profile credentials file")
    }

    pub fn session(&self, name: &str) -> Result<Option<Session>> {
        Ok(self.credentials()?.remove(name))
    }

    pub fn clear_session(&self, name: &str, expected: &Session) -> Result<bool> {
        let _lock = self.lock()?;
        let mut credentials = self.credentials()?;
        if credentials.get(name) != Some(expected) {
            return Ok(false);
        }
        credentials.remove(name);
        self.write_credentials(&credentials)?;
        Ok(true)
    }

    fn lock(&self) -> Result<File> {
        fs::create_dir_all(&self.directory)?;
        let file = private_options()
            .create(true)
            .truncate(false)
            .open(self.path("profiles", "lock"))?;
        file.lock_exclusive()?;
        Ok(file)
    }

    pub fn save(&self, name: &str, mut profile: Profile, session: Session) -> Result<()> {
        validate_name(name)?;
        profile.target.validate()?;
        if normalize_url(&session.api_base_url)? != profile.target.url {
            bail!("Credentials belong to a different installation");
        }
        if profile.user_id.is_empty() || profile.email.is_empty() {
            bail!("Profile is missing account identity");
        }
        let _lock = self.lock()?;
        let mut config = self.load()?;
        if let Some(existing) = config.profiles.get(name) {
            if existing.target != profile.target || existing.user_id != profile.user_id {
                bail!(
                    "Profile '{name}' belongs to a different installation, organization, or account. Choose another profile name."
                );
            }
        }
        let mut credentials = self.credentials()?;
        credentials.insert(name.to_owned(), session);
        self.write_credentials(&credentials)?;
        config.profiles.insert(name.to_owned(), profile);
        if config.current_profile.is_none() {
            config.current_profile = Some(name.to_owned());
        }
        self.write_config(&config)
    }

    fn write_credentials(&self, credentials: &BTreeMap<String, Session>) -> Result<()> {
        write_private(
            &self.credentials_path(),
            serde_json::to_string_pretty(credentials)?.as_bytes(),
        )
    }

    pub fn credentials_path(&self) -> PathBuf {
        self.path("credentials", "json")
    }

    fn write_config(&self, config: &Config) -> Result<()> {
        write_private(
            &self.path("config", "yaml"),
            serde_yaml::to_string(config)?.as_bytes(),
        )
    }

    pub fn use_profile(&self, name: &str) -> Result<()> {
        let _lock = self.lock()?;
        let mut config = self.load()?;
        if !config.profiles.contains_key(name) {
            bail!("Unknown profile '{name}'");
        }
        config.current_profile = Some(name.to_owned());
        self.write_config(&config)
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        let _lock = self.lock()?;
        let mut config = self.load()?;
        if !config.profiles.contains_key(name) {
            bail!("Unknown profile '{name}'");
        }
        let mut credentials = self.credentials()?;
        credentials.remove(name);
        self.write_credentials(&credentials)?;
        config.profiles.remove(name);
        if config.current_profile.as_deref() == Some(name) {
            config.current_profile = None;
        }
        self.write_config(&config)?;
        Ok(())
    }

    pub fn wipe(&self) -> Result<()> {
        let _lock = self.lock()?;
        for path in [
            self.path("config", "yaml"),
            self.path("credentials", "json"),
        ] {
            if path.try_exists()? {
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }

    pub fn legacy_session(&self) -> Result<Option<Session>> {
        match LegacySessionStore::at(&self.directory).load_session() {
            Ok(session) => Ok(Some(session)),
            Err(error) if crate::state::is_no_active_session_error(&error) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub async fn migrate_legacy(&self) -> Result<()> {
        if self.path("config", "yaml").try_exists()? {
            return Ok(());
        }
        let session = match LegacySessionStore::at(&self.directory).load_session() {
            Ok(session) => session,
            Err(error) if crate::state::is_no_active_session_error(&error) => return Ok(()),
            Err(error) => return Err(error),
        };
        let me = ApiClient::from_session(&session)?.get_me().await?;
        self.save(
            "default",
            Profile::from_identity(&session.api_base_url, &me)?,
            session,
        )?;
        LegacySessionStore::at(&self.directory).clear_session()?;
        Ok(())
    }
}

impl Profile {
    pub fn from_identity(url: &str, me: &crate::api::MeResponse) -> Result<Self> {
        if me.organization_id.is_empty() || me.user_id.is_empty() {
            bail!(
                "The server did not return organization and user IDs. Update the server before using profiles."
            );
        }
        let mut target = Target {
            url: url.to_owned(),
            organization_id: me.organization_id.clone(),
        };
        target.validate()?;
        Ok(Self {
            target,
            user_id: me.user_id.clone(),
            email: me.email.clone(),
            organization_name: me.organization_name.clone(),
        })
    }
}

pub fn explicit_profile(flag: Option<&str>) -> Option<String> {
    flag.map(str::to_owned)
        .or_else(|| std::env::var("EVERR_PROFILE").ok())
}

pub async fn client(profile: Option<&str>, allow_api_key: bool) -> Result<ApiClient> {
    let store = ProfileStore::user()?;
    let project = Project::discover(&std::env::current_dir()?)?;
    let explicit = explicit_profile(profile);
    if allow_api_key {
        if let Some(token) = std::env::var("EVERR_API_KEY")
            .ok()
            .filter(|t| !t.is_empty())
            .or_else(|| {
                std::env::var("EVERR_API_TOKEN")
                    .ok()
                    .filter(|t| !t.is_empty())
            })
        {
            let url = std::env::var("EVERR_API_URL")
                .ok()
                .filter(|url| !url.is_empty());
            let selected = if url.is_some() && explicit.is_none() && project.target.is_none() {
                None
            } else {
                store.load()?.select(explicit.as_deref(), &project)?
            };
            let target = selected
                .as_ref()
                .map(|(_, p)| &p.target)
                .or(project.target.as_ref());
            if let (Some(url), Some(target)) = (&url, target) {
                if normalize_url(url)? != target.url {
                    bail!("EVERR_API_URL conflicts with the selected target");
                }
            }
            let url = url.or_else(|| target.map(|t| t.url.clone())).context("EVERR_API_KEY is set but no target URL is configured; set EVERR_API_URL or configure the project")?;
            let client = ApiClient::from_token(&normalize_url(&url)?, &token)?;
            return match target {
                Some(t) => client.for_organization(&t.organization_id),
                None => Ok(client),
            };
        }
    }
    store.migrate_legacy().await?;
    let (name, selected) = store
        .load()?
        .select(explicit.as_deref(), &project)?
        .context("No authenticated profile for this target. Run `everr login`.")?;
    let session = store.session(&name)?.with_context(|| {
        format!("Profile '{name}' is logged out. Run `everr login --profile {name}`.")
    })?;
    let source = if explicit.is_some() {
        "explicit profile"
    } else if project.target.is_some() {
        "project configuration"
    } else {
        "global default"
    };
    Ok(selected
        .target
        .client(&session)?
        .with_profile(&name, source))
}

pub fn validate_name(name: &str) -> Result<()> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        bail!("Profile names may contain letters, numbers, dots, underscores, and hyphens");
    }
    Ok(())
}

fn private_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
}

fn write_private(path: &Path, contents: &[u8]) -> Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    file.write_all(contents)?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(organization: &str) -> Profile {
        Profile {
            target: Target {
                url: "https://example.test".into(),
                organization_id: organization.into(),
            },
            user_id: "alice".into(),
            email: "alice@example.test".into(),
            organization_name: organization.into(),
        }
    }

    #[test]
    fn concurrent_profile_writes_preserve_both_sessions_and_keep_credentials_private() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProfileStore::at(directory.path());
        std::thread::scope(|scope| {
            for name in ["one", "two"] {
                let store = store.clone();
                scope.spawn(move || {
                    store
                        .save(
                            name,
                            profile(name),
                            Session {
                                api_base_url: "https://example.test".into(),
                                token: format!("token-{name}"),
                            },
                        )
                        .unwrap()
                });
            }
        });
        assert_eq!(store.load().unwrap().profiles.len(), 2);
        assert_eq!(store.session("one").unwrap().unwrap().token, "token-one");
        assert_eq!(store.session("two").unwrap().unwrap().token, "token-two");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(store.path("credentials", "json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn replacing_a_profile_cannot_retarget_its_existing_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProfileStore::at(directory.path());
        let session = Session {
            api_base_url: "https://example.test".into(),
            token: "original-token".into(),
        };
        store
            .save("work", profile("org-one"), session.clone())
            .unwrap();
        assert!(
            store
                .save(
                    "work",
                    profile("org-two"),
                    Session {
                        token: "replacement".into(),
                        ..session.clone()
                    }
                )
                .is_err()
        );
        assert_eq!(store.session("work").unwrap(), Some(session));
        assert_eq!(
            store.load().unwrap().profiles["work"]
                .target
                .organization_id,
            "org-one"
        );
    }

    #[test]
    fn logout_preserves_a_newer_login_to_the_same_profile() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProfileStore::at(directory.path());
        let old = Session {
            api_base_url: "https://example.test".into(),
            token: "old-token".into(),
        };
        let new = Session {
            token: "new-token".into(),
            ..old.clone()
        };
        store
            .save("work", profile("org-work"), old.clone())
            .unwrap();
        store
            .save("work", profile("org-work"), new.clone())
            .unwrap();
        assert!(!store.clear_session("work", &old).unwrap());
        assert_eq!(store.session("work").unwrap(), Some(new.clone()));
        assert!(store.clear_session("work", &new).unwrap());
        assert!(store.session("work").unwrap().is_none());
        assert!(store.load().unwrap().profiles.contains_key("work"));
    }

    #[test]
    fn project_discovery_stops_at_the_nearest_repository_and_supports_worktree_git_files() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join(".git")).unwrap();
        fs::create_dir(directory.path().join(".everr")).unwrap();
        fs::write(
            directory.path().join(".everr/config.yaml"),
            "version: 1\nurl: https://parent.example.test\norganizationId: parent\n",
        )
        .unwrap();
        let worktree = directory.path().join("nested");
        fs::create_dir(&worktree).unwrap();
        fs::write(worktree.join(".git"), "gitdir: /unused/test-worktree").unwrap();
        let nested = worktree.join("service");
        fs::create_dir(&nested).unwrap();
        let project = Project::discover(&nested).unwrap();
        assert_eq!(project.root, Some(worktree.canonicalize().unwrap()));
        assert!(project.target.is_none());
    }
}
