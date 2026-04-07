use anyhow::{anyhow, bail, Context, Result};
use everr_core::api::ApiClient;
use everr_core::auth::{
    build_auth_http_client, poll_device_authorization, session_from_device_token,
    start_device_authorization, DevicePollStatus,
};
use everr_core::git::resolve_git_context;
use everr_core::state::UserProfile;
use tauri::AppHandle;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::settings::{
    emit_auth_changed, emit_settings_changed, has_active_session_for_current_base_url,
    update_persisted_state,
};
use crate::{
    current_auth_config, AuthStatusResponse, PendingAuthResponse, PendingAuthState, RuntimeState,
    SignInResponse,
};

pub(crate) async fn start_sign_in_inner(state: RuntimeState) -> Result<SignInResponse> {
    let auth_config = current_auth_config();
    let client = build_auth_http_client()?;
    let authorization = start_device_authorization(&client, &auth_config).await?;
    let expires_at =
        OffsetDateTime::now_utc() + time::Duration::seconds(authorization.expires_in as i64);

    {
        let mut pending = state
            .pending_auth
            .lock()
            .map_err(|_| anyhow!("failed to lock pending auth state"))?;
        *pending = Some(PendingAuthState {
            authorization,
            expires_at,
        });
    }

    Ok(pending_auth_response(&state)?
        .ok_or_else(|| anyhow!("pending auth missing after set"))?
        .into())
}

pub(crate) async fn poll_sign_in_inner(
    app: AppHandle,
    state: RuntimeState,
) -> Result<SignInResponse> {
    let Some(pending) = current_pending_auth(&state)? else {
        return Ok(SignInResponse::Expired);
    };
    if pending.expires_at <= OffsetDateTime::now_utc() {
        clear_pending_auth(&state)?;
        return Ok(SignInResponse::Expired);
    }

    let client = build_auth_http_client()?;
    let auth_config = current_auth_config();
    match poll_device_authorization(&client, &auth_config, &pending.authorization).await? {
        DevicePollStatus::Authorized(token) => {
            let session = session_from_device_token(&auth_config, token)?;
            let user_profile = fetch_user_profile(&session).await;
            let notification_emails = reset_notification_emails(
                user_profile.as_ref().map(|profile| profile.email.as_str()),
                detect_git_email(),
            );
            update_persisted_state(&state, |persisted| {
                persisted.session = Some(session);
                persisted.settings.user_profile = user_profile;
                persisted.settings.notification_emails = notification_emails;
            })?;
            clear_pending_auth(&state)?;
            on_sign_in_completed(&app);
            Ok(SignInResponse::SignedIn {
                session_path: state.store.session_file_path()?.display().to_string(),
            })
        }
        DevicePollStatus::Pending | DevicePollStatus::SlowDown => {
            Ok(pending_auth_response(&state)?
                .ok_or_else(|| anyhow!("no pending sign-in"))?
                .into())
        }
        DevicePollStatus::Denied => {
            clear_pending_auth(&state)?;
            Ok(SignInResponse::Denied)
        }
        DevicePollStatus::Expired => {
            clear_pending_auth(&state)?;
            Ok(SignInResponse::Expired)
        }
    }
}

fn on_sign_in_completed(app: &AppHandle) {
    emit_auth_changed(app);
    emit_settings_changed(app);
}

pub(crate) fn auth_status_response(state: &RuntimeState) -> Result<AuthStatusResponse> {
    let session_path = state.store.session_file_path()?;
    let status = if has_active_session_for_current_base_url(state)? {
        "signed_in"
    } else {
        "signed_out"
    };

    Ok(AuthStatusResponse {
        status,
        session_path: session_path.display().to_string(),
    })
}

pub(crate) fn pending_auth_response(state: &RuntimeState) -> Result<Option<PendingAuthResponse>> {
    let Some(pending) = current_pending_auth(state)? else {
        return Ok(None);
    };
    Ok(Some(PendingAuthResponse {
        status: "pending",
        user_code: pending.authorization.user_code.clone(),
        verification_url: pending.authorization.verification_url.clone(),
        expires_at: pending.expires_at.format(&Rfc3339)?,
        poll_interval_seconds: pending.authorization.interval,
    }))
}

fn current_pending_auth(state: &RuntimeState) -> Result<Option<PendingAuthState>> {
    Ok(state
        .pending_auth
        .lock()
        .map_err(|_| anyhow!("failed to lock pending auth state"))?
        .clone())
}

pub(crate) fn clear_pending_auth(state: &RuntimeState) -> Result<()> {
    let mut pending = state
        .pending_auth
        .lock()
        .map_err(|_| anyhow!("failed to lock pending auth state"))?;
    *pending = None;
    Ok(())
}

pub(crate) fn open_sign_in_browser_inner(state: &RuntimeState) -> Result<()> {
    let Some(pending) = current_pending_auth(state)? else {
        bail!("device authentication expired");
    };
    if pending.expires_at <= OffsetDateTime::now_utc() {
        clear_pending_auth(state)?;
        bail!("device authentication expired");
    }

    webbrowser::open(&pending.authorization.verification_url).with_context(|| {
        format!(
            "failed to open sign-in URL {}",
            pending.authorization.verification_url
        )
    })?;
    Ok(())
}

async fn fetch_user_profile(session: &everr_core::state::Session) -> Option<UserProfile> {
    let client = ApiClient::from_session(session).ok()?;
    let me = client.get_me().await.ok()?;

    Some(UserProfile {
        email: me.email,
        name: me.name,
        profile_url: me.profile_url,
    })
}

fn detect_git_email() -> Option<String> {
    let cwd = std::env::current_dir().ok()?;
    resolve_git_context(&cwd).email
}

fn reset_notification_emails(
    profile_email: Option<&str>,
    git_email: Option<String>,
) -> Vec<String> {
    let mut emails = Vec::new();

    for email in profile_email
        .into_iter()
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(ToOwned::to_owned)
        .chain(
            git_email
                .into_iter()
                .map(|email| email.trim().to_string())
                .filter(|email| !email.is_empty()),
        )
    {
        if !emails.contains(&email) {
            emails.push(email);
        }
    }

    emails
}

#[cfg(test)]
mod tests {
    use super::reset_notification_emails;

    #[test]
    fn reset_notification_emails_prefers_profile_then_git_and_dedupes() {
        assert_eq!(
            reset_notification_emails(
                Some("user@example.com"),
                Some("git@example.com".to_string())
            ),
            vec!["user@example.com".to_string(), "git@example.com".to_string()]
        );
    }

    #[test]
    fn reset_notification_emails_dedupes_matching_addresses() {
        assert_eq!(
            reset_notification_emails(
                Some("user@example.com"),
                Some("user@example.com".to_string())
            ),
            vec!["user@example.com".to_string()]
        );
    }

    #[test]
    fn reset_notification_emails_clears_stale_values_when_sources_are_missing() {
        assert!(reset_notification_emails(None, None).is_empty());
    }
}
