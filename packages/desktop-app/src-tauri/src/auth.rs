use anyhow::{anyhow, bail, Context, Result};
use everr_core::auth::{
    build_auth_http_client, poll_device_authorization, session_from_device_token,
    start_device_authorization, DevicePollStatus,
};
use tauri::AppHandle;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::notifications::load_owned_failures_for_current_repo;
use crate::settings::{
    emit_auth_changed, has_active_session_for_current_base_url, update_persisted_state,
};
use crate::tray::{build_tray_snapshot, clear_tray_snapshot, update_tray_snapshot};
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
            update_persisted_state(&state, |persisted| {
                persisted.session = Some(session);
            })?;
            clear_pending_auth(&state)?;
            on_sign_in_completed(&app, &state).await;
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

async fn on_sign_in_completed(app: &AppHandle, state: &RuntimeState) {
    match load_owned_failures_for_current_repo(state).await {
        Ok(Some((failures, repo, branch))) => {
            if let Err(error) = update_tray_snapshot(
                app,
                state,
                build_tray_snapshot(&failures, repo.as_deref(), branch.as_deref()),
            ) {
                crate::crash_log::log_error("refresh tray after sign-in", &error);
            }
        }
        Ok(None) => {
            if let Err(error) = clear_tray_snapshot(app, state) {
                crate::crash_log::log_error("clear tray after sign-in", &error);
            }
        }
        Err(error) => {
            crate::crash_log::log_error("refresh tray after sign-in", &error);
        }
    }

    emit_auth_changed(app);
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
