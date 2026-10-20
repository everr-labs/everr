use crate::api::ApiClient;
use crate::build;
use crate::cli::{CloudStatusArgs, LoginArgs};
use crate::device_auth::{AuthConfig, authorize_with_prompt};
use crate::state::{Session, SessionStore};
use anyhow::{Context, Result, anyhow, bail};

const API_BASE_URL_OVERRIDE_ENV: &str = "EVERR_API_BASE_URL_FOR_TESTS";

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

pub fn require_session() -> Result<Session> {
    SessionStore::user()?
        .load_session()?
        .context("No active session. Run `everr cloud login`.")
}

pub fn client(allow_api_key: bool) -> Result<ApiClient> {
    if allow_api_key {
        if let Some(token) = std::env::var("EVERR_API_KEY")
            .ok()
            .filter(|token| !token.is_empty())
            .or_else(|| {
                std::env::var("EVERR_API_TOKEN")
                    .ok()
                    .filter(|token| !token.is_empty())
            })
        {
            let url = match std::env::var("EVERR_API_URL").ok().filter(|url| !url.is_empty()) {
                Some(url) => url,
                None => SessionStore::user()?.load_session()?.map(|session| session.api_base_url)
                    .context("EVERR_API_KEY is set but no target URL is configured; set EVERR_API_URL or run `everr cloud login`.")?,
            };
            return ApiClient::from_token(&normalize_url(&url)?, &token);
        }
    }
    ApiClient::from_session(&require_session()?)
}

pub async fn login(args: LoginArgs) -> Result<()> {
    let store = SessionStore::user()?;
    let url = match args.url {
        Some(url) => url,
        None => match store.load_session()? {
            Some(session) => session.api_base_url,
            None => current_api_base_url()?,
        },
    };
    let config = AuthConfig {
        api_base_url: normalize_url(&url)?,
    };
    println!("Authenticating with {}", config.api_base_url);
    let session = authorize_with_prompt(&config, |url, code| async move {
        if args.no_open {
            println!("Open {url} and confirm code {code}");
        } else {
            open_browser_immediately(url.to_string(), code).await;
        }
    })
    .await?;
    let client = ApiClient::from_session(&session)?;
    let identity = client.get_me().await?;
    store.save_session(&session)?;
    println!("Logged in as {}", identity.email);
    println!("Using organization: {}", identity.organization_name);
    Ok(())
}

pub async fn logout() -> Result<()> {
    let store = SessionStore::user()?;
    let Some(session) = store.load_session()? else {
        println!("No active session.");
        return Ok(());
    };
    ApiClient::from_session(&session)?.logout().await?;
    if store.clear_session(&session)? {
        println!("Logged out.");
    } else {
        println!("Revoked the previous session. A newer login was preserved.");
    }
    Ok(())
}

pub async fn status(args: CloudStatusArgs) -> Result<()> {
    let client = client(false)?;
    let me = client.get_me().await?;
    if args.json {
        #[derive(serde::Serialize)]
        struct ConnectionInfo<'a> {
            url: &'a str,
            #[serde(flatten)]
            identity: crate::api::MeResponse,
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&ConnectionInfo {
                url: client.base_url(),
                identity: me
            })?
        );
        return Ok(());
    }
    println!("Name: {}", me.name);
    println!("Email: {}", me.email);
    println!("Organization: {}", me.organization_name);
    println!("Installation: {}", client.base_url());
    println!(
        "Ingestion endpoint: {}",
        me.ingest_endpoint
            .as_deref()
            .unwrap_or("not configured or unavailable on this server")
    );
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

fn current_api_base_url() -> Result<String> {
    if let Ok(value) = std::env::var(API_BASE_URL_OVERRIDE_ENV) {
        let trimmed = trimmed_non_empty(&value)
            .ok_or_else(|| anyhow!("missing CLI API base URL override"))?;
        return Ok(trimmed.to_owned());
    }

    Ok(build::default_api_base_url().to_string())
}
