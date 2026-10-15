use crate::api::ApiClient;
use crate::build;
use crate::cli::LoginArgs;
use crate::device_auth::{AuthConfig, authorize_with_prompt};
use crate::profiles::{Profile, ProfileStore, Project, Target, explicit_profile, normalize_url};
use crate::state::{LegacySessionStore, Session};
use anyhow::{Context, Result, anyhow, bail};

const API_BASE_URL_OVERRIDE_ENV: &str = "EVERR_API_BASE_URL_FOR_TESTS";

// Both terminal and local UI device flows use this target and credential store.
// Creating a project file remains an explicit part of the terminal login command.
pub(crate) struct LoginContext {
    pub store: ProfileStore,
    pub project: Project,
    pub config: AuthConfig,
    name: Option<String>,
    expected: Option<Target>,
    user_id: Option<String>,
}

impl LoginContext {
    pub fn user(profile: Option<&str>, url: Option<String>) -> Result<Self> {
        Self::new(
            ProfileStore::user()?,
            Project::discover(&std::env::current_dir()?)?,
            explicit_profile(profile),
            url,
        )
    }

    pub fn new(
        store: ProfileStore,
        project: Project,
        explicit: Option<String>,
        url: Option<String>,
    ) -> Result<Self> {
        if let Some(name) = &explicit {
            crate::profiles::validate_name(name)?;
        }
        let config = store.load()?;
        let selected = if let Some(name) = &explicit {
            config
                .profiles
                .get(name)
                .cloned()
                .map(|profile| (name.clone(), profile))
        } else if url.is_none() {
            store.select(None, &project)?
        } else {
            None
        };
        let expected = selected
            .as_ref()
            .map(|(_, p)| p.target.clone())
            .or_else(|| {
                if explicit.is_none() || url.is_none() {
                    project.target.clone()
                } else {
                    None
                }
            });
        let url = normalize_url(
            &match url.or_else(|| expected.as_ref().map(|t| t.url.clone())) {
                Some(url) => url,
                None => store
                    .legacy_session()?
                    .map(|s| s.api_base_url)
                    .unwrap_or(current_api_base_url()?),
            },
        )?;
        if expected.as_ref().is_some_and(|target| target.url != url) {
            bail!(
                "The login URL differs from the configured target. Choose a new profile with --profile."
            );
        }
        Ok(Self {
            name: explicit.or_else(|| selected.as_ref().map(|(name, _)| name.clone())),
            user_id: selected.map(|(_, p)| p.user_id),
            store,
            project,
            config: AuthConfig { api_base_url: url },
            expected,
        })
    }

    pub fn verification_url(&self, mut url: reqwest::Url) -> reqwest::Url {
        if let Some(target) = &self.expected {
            url.query_pairs_mut()
                .append_pair("organization_id", &target.organization_id);
        }
        url
    }

    pub fn session(&self) -> Result<Option<(String, Profile, Session)>> {
        let config = self.store.load()?;
        let selected = if let Some(name) = &self.name {
            config
                .profiles
                .get(name)
                .map(|profile| (name.clone(), profile.clone()))
        } else {
            let selected = self.store.select(None, &self.project)?;
            if selected
                .as_ref()
                .is_some_and(|(_, p)| p.target.url == self.config.api_base_url)
            {
                selected
            } else {
                let mut matching = config
                    .profiles
                    .into_iter()
                    .filter(|(_, p)| p.target.url == self.config.api_base_url);
                let first = matching.next();
                if matching.next().is_some() {
                    bail!(
                        "Multiple profiles match this installation. Select one with EVERR_PROFILE and restart Everr Local."
                    );
                }
                first
            }
        };
        let Some((name, profile)) = selected else {
            return Ok(None);
        };
        if profile.target.url != self.config.api_base_url {
            return Ok(None);
        }
        if self
            .expected
            .as_ref()
            .is_some_and(|target| target != &profile.target)
            || self
                .user_id
                .as_ref()
                .is_some_and(|user| user != &profile.user_id)
        {
            bail!("The selected profile changed its organization or account. Restart the login.");
        }
        Ok(self
            .store
            .session(&name)?
            .map(|session| (name, profile, session)))
    }

    pub async fn save(&self, session: Session) -> Result<(String, Profile)> {
        let client = ApiClient::from_session(&session)?;
        let identity = Profile::from_identity(&self.config.api_base_url, &client.get_me().await?)?;
        if self
            .expected
            .as_ref()
            .is_some_and(|target| target != &identity.target)
        {
            let _ = client.logout().await;
            bail!(
                "The approved organization differs from the configured target. Select organization '{}' in the browser and retry. Existing configuration was preserved.",
                self.expected.as_ref().unwrap().organization_id
            );
        }
        if self
            .user_id
            .as_ref()
            .is_some_and(|user| user != &identity.user_id)
        {
            let _ = client.logout().await;
            bail!("The approved account differs from this profile. Choose another profile name.");
        }
        let config = self.store.load()?;
        let name = self.name.clone().unwrap_or_else(|| {
            if !config.profiles.contains_key("default") {
                "default".to_owned()
            } else {
                let url = reqwest::Url::parse(&identity.target.url).unwrap();
                let host: String = url
                    .host_str()
                    .unwrap()
                    .chars()
                    .map(|c| {
                        if c.is_ascii_alphanumeric() || c == '.' {
                            c
                        } else {
                            '-'
                        }
                    })
                    .collect();
                format!("{host}-{}", identity.target.organization_id)
            }
        });
        self.store.save(&name, identity.clone(), session)?;
        Ok((name, identity))
    }
}

pub async fn login(args: LoginArgs, profile: Option<&str>) -> Result<()> {
    let login = LoginContext::user(profile, args.url)?;
    println!("Authenticating with {}", login.config.api_base_url);
    if let Some(target) = &login.expected {
        println!("Expected organization: {}", target.organization_id);
    }
    let session = authorize_with_prompt(&login.config, |url, code| {
        let url = login.verification_url(url);
        async move {
            if args.no_open {
                println!("Open {url} and confirm code {code}");
            } else {
                open_browser_immediately(url.to_string(), code).await;
            }
        }
    })
    .await?;
    let (name, identity) = login.save(session).await?;
    login.project.save_if_absent(&identity.target)?;
    println!("Logged in as {}", identity.email);
    println!("Using organization: {}", identity.organization_name);
    println!("Logged in. Profile: {name}");
    Ok(())
}

pub async fn whoami(profile: Option<&str>) -> Result<()> {
    let client = crate::profiles::client(profile, false).await?;
    let identity = client.get_me().await?;
    if let Some(name) = client.profile() {
        println!(
            "Profile: {name} ({})",
            client.selection_source().unwrap_or("selected")
        );
    }
    println!("Installation: {}", client.base_url());
    println!("Account: {} ({})", identity.email, identity.user_id);
    println!(
        "Organization: {} ({})",
        identity.organization_name, identity.organization_id
    );
    Ok(())
}

pub fn profiles(command: crate::cli::ProfilesSubcommand) -> Result<()> {
    use crate::cli::ProfilesSubcommand as P;
    let store = ProfileStore::user()?;
    match command {
        P::List => {
            let config = store.load()?;
            let credentials = store.credentials()?;
            for (name, profile) in &config.profiles {
                let current = if config.current_profile.as_deref() == Some(name) {
                    "*"
                } else {
                    " "
                };
                let state = if credentials.contains_key(name) {
                    "authenticated"
                } else {
                    "logged out"
                };
                println!(
                    "{current} {name}  {}  {} ({})  {}  {state}",
                    profile.target.url,
                    profile.organization_name,
                    profile.target.organization_id,
                    profile.email
                );
            }
        }
        P::Show { name } => {
            let config = store.load()?;
            let profile = config
                .profiles
                .get(&name)
                .with_context(|| format!("Unknown profile '{name}'"))?;
            print!("{}", serde_yaml::to_string(profile)?);
        }
        P::Use { name } => {
            store.use_profile(&name)?;
            println!("Default profile: {name}");
        }
        P::Remove { name } => {
            store.remove(&name)?;
            println!("Removed profile '{name}'");
        }
    }
    Ok(())
}

pub async fn open_browser_immediately(verification_url: String, user_code: String) {
    if let Err(error) = webbrowser::open(&verification_url) {
        eprintln!(
            "Could not open browser automatically.\nOpen this URL manually: {verification_url} ({error})"
        );
    }

    let code_line = format!("  Code: {user_code}");
    let url_line = format!("  URL:  {verification_url}");
    let width = code_line.len().max(url_line.len()) + 2;
    let bar = "─".repeat(width);
    println!("┌{bar}┐");
    println!("│{:width$}│", "  Authenticate", width = width);
    println!("│{:width$}│", "", width = width);
    println!("│{code_line:<width$}│", width = width);
    println!("│{url_line:<width$}│", width = width);
    println!("└{bar}┘");
}

fn trimmed_non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub async fn logout(profile: Option<&str>) -> Result<()> {
    let store = ProfileStore::user()?;
    let project = Project::discover(&std::env::current_dir()?)?;
    let explicit = explicit_profile(profile);
    let Some((name, selected)) = store.select(explicit.as_deref(), &project)? else {
        // Preserve logout support for the session format used before profiles.
        let removed = if project.target.is_none() && store.load()?.profiles.is_empty() {
            LegacySessionStore::user().clear_session()?
        } else {
            false
        };
        println!(
            "{}",
            if removed {
                "Logged out."
            } else {
                "No active session."
            }
        );
        return Ok(());
    };
    if let Some(session) = store.session(&name)? {
        selected.target.client(&session)?.logout().await?;
        if store.clear_session(&name, &session)? {
            println!("Logged out. Profile: {name}");
        } else {
            println!(
                "Revoked the previous session. A newer login for profile '{name}' was preserved."
            );
        }
    } else {
        println!("No active session. Profile: {name}");
    }
    Ok(())
}

fn current_api_base_url() -> Result<String> {
    if let Ok(value) = std::env::var(API_BASE_URL_OVERRIDE_ENV) {
        let trimmed = trimmed_non_empty(&value)
            .ok_or_else(|| anyhow!("missing CLI API base URL override"))?;
        return Ok(trimmed.to_owned());
    }

    Ok(build::default_api_base_url().to_string())
}
