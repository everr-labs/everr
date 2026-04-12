use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use everr_core::api::FailureNotification;
use everr_core::assistant::AssistantStatus;
use everr_core::auth::{AuthConfig, DeviceAuthorization};
use everr_core::build;
use everr_core::notifier::FailureTracker;
use everr_core::state::AppStateStore;
use everr_core::state_watcher::StateWatcher;
use serde::Serialize;
use tauri::{Manager, WindowEvent};
use time::OffsetDateTime;

#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

mod auth;
mod auto_fix_prompt;
mod cli;
mod commands;
mod crash_log;
mod notifications;
mod seen_runs;
mod settings;
mod startup;
pub mod telemetry;
mod tray;

#[cfg(test)]
mod tests;

use commands::{
    configure_assistants, copy_notification_auto_fix_prompt, copy_run_auto_fix_prompt,
    dismiss_active_notification, get_active_notification, get_assistant_setup, get_auth_status,
    get_notification_emails, get_pending_sign_in, get_runs_list, get_unseen_trace_ids,
    get_user_profile, get_wizard_status, mark_all_runs_seen, mark_run_seen,
    open_notification_target, open_run_in_browser, open_sign_in_browser, poll_sign_in,
    reset_dev_onboarding, set_notification_emails, sign_out, start_sign_in,
    trigger_test_notification,
};
use notifications::{dismiss_active_notification_inner, start_notifier_loop};
use settings::{open_settings_window, wizard_incomplete};
use startup::{run_local_startup_maintenance, start_state_change_loop, start_update_check_loop};
use tray::build_tray;

const UPDATE_CHECK_INTERVAL_SECONDS: u64 = 15 * 60;
const AUTH_CHANGED_EVENT: &str = "everr://auth-changed";
const SETTINGS_CHANGED_EVENT: &str = "everr://settings-changed";
const NOTIFICATION_CHANGED_EVENT: &str = "everr://notification-changed";
const NOTIFICATION_HOVER_EVENT: &str = "everr://notification-hover";
const SEEN_RUNS_CHANGED_EVENT: &str = "everr://seen-runs-changed";
const NOTIFICATION_EXIT_EVENT: &str = "everr://notification-exit";
const NOTIFICATION_WINDOW_LABEL: &str = "notification";
const NOTIFICATION_WINDOW_WIDTH: f64 = 420.0;
const NOTIFICATION_WINDOW_HEIGHT: f64 = 124.0;
const NOTIFICATION_WINDOW_MARGIN: f64 = 16.0;
const NOTIFICATION_WINDOW_INSET: f64 = 12.0;
const TRAY_ICON_ID: &str = "everr-app";
const SETTINGS_MENU_ID: &str = "settings";
const QUIT_MENU_ID: &str = "quit";
const APP_NAME: &str = "Everr";
const DEV_APP_NAME: &str = "Everr_Dev";

type CommandResult<T> = std::result::Result<T, String>;

trait IntoCommandResult<T> {
    fn into_command_result(self) -> CommandResult<T>;
}

impl<T> IntoCommandResult<T> for anyhow::Result<T> {
    fn into_command_result(self) -> CommandResult<T> {
        self.map_err(|error| error.to_string())
    }
}

#[derive(Clone)]
struct RuntimeState {
    store: AppStateStore,
    watcher: Arc<StateWatcher>,
    notifier: Arc<Mutex<NotifierState>>,
    pending_auth: Arc<Mutex<Option<PendingAuthState>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct AuthStatusResponse {
    status: &'static str,
    session_path: String,
}

#[derive(Debug, Clone)]
struct PendingAuthState {
    authorization: DeviceAuthorization,
    expires_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct PendingAuthResponse {
    status: &'static str,
    user_code: String,
    verification_url: String,
    expires_at: String,
    poll_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum SignInResponse {
    SignedIn {
        session_path: String,
    },
    Pending {
        user_code: String,
        verification_url: String,
        expires_at: String,
        poll_interval_seconds: u64,
    },
    Denied,
    Expired,
}

impl From<PendingAuthResponse> for SignInResponse {
    fn from(value: PendingAuthResponse) -> Self {
        Self::Pending {
            user_code: value.user_code,
            verification_url: value.verification_url,
            expires_at: value.expires_at,
            poll_interval_seconds: value.poll_interval_seconds,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct AssistantSetupResponse {
    assistant_statuses: Vec<AssistantStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct WizardStatusResponse {
    wizard_completed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct DevResetResponse {
    auth_status: AuthStatusResponse,
    wizard_status: WizardStatusResponse,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct TestNotificationResponse {
    status: &'static str,
}

#[derive(Debug, Default)]
struct NotifierState {
    tracker: FailureTracker,
    queue: NotificationQueue,
}

#[derive(Debug, Default)]
struct NotificationQueue {
    active: Option<FailureNotification>,
    pending: VecDeque<FailureNotification>,
}

impl NotificationQueue {
    fn enqueue(&mut self, notification: FailureNotification) -> bool {
        if self.active.is_none() {
            self.active = Some(notification);
            true
        } else {
            self.pending.push_back(notification);
            false
        }
    }

    fn active(&self) -> Option<&FailureNotification> {
        self.active.as_ref()
    }

    fn advance(&mut self) -> bool {
        if self.active.is_none() {
            return false;
        }

        self.active = self.pending.pop_front();
        true
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crash_log::install_panic_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() == NOTIFICATION_WINDOW_LABEL {
                    if let Some(runtime) = window.app_handle().try_state::<RuntimeState>() {
                        let _ = dismiss_active_notification_inner(
                            &window.app_handle(),
                            runtime.inner(),
                        );
                    } else {
                        let _ = window.hide();
                    }
                } else {
                    let _ = window.hide();

                    let _ = window
                        .app_handle()
                        .set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let mut autostart = tauri_plugin_autostart::Builder::new().app_name(current_app_name());
            #[cfg(target_os = "macos")]
            {
                autostart = autostart.macos_launcher(MacosLauncher::LaunchAgent);
            }
            app.handle().plugin(autostart.build())?;

            let store = current_state_store();
            let _ = store.clear_mismatched_session(build::default_api_base_url())?;
            store.update_state(|state| {
                state
                    .settings
                    .apply_runtime_base_url(build::default_api_base_url());
            })?;
            run_local_startup_maintenance(app.handle());
            let watcher =
                StateWatcher::start(store.clone()).expect("failed to start state watcher");
            let runtime = RuntimeState {
                store,
                watcher: Arc::new(watcher),
                notifier: Arc::new(Mutex::new(NotifierState::default())),
                pending_auth: Arc::new(Mutex::new(None)),
            };

            app.manage(runtime.clone());

            let sidecar =
                tauri::async_runtime::block_on(telemetry::sidecar::Sidecar::start(app.handle()));
            app.manage(sidecar);

            let bridge_handle =
                telemetry::bridge::install(app.state::<telemetry::sidecar::Sidecar>().state());
            app.manage(std::sync::Mutex::new(Some(bridge_handle)));

            build_tray(app.handle())?;
            if wizard_incomplete(&runtime)? {
                open_settings_window(app.handle())?;
            }
            start_notifier_loop(app.handle().clone(), runtime.clone());
            start_state_change_loop(app.handle().clone(), runtime);
            start_update_check_loop(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_status,
            get_assistant_setup,
            get_wizard_status,
            get_active_notification,
            start_sign_in,
            get_pending_sign_in,
            poll_sign_in,
            open_sign_in_browser,
            sign_out,
            reset_dev_onboarding,
            configure_assistants,
            dismiss_active_notification,
            open_notification_target,
            copy_notification_auto_fix_prompt,
            trigger_test_notification,
            get_notification_emails,
            set_notification_emails,
            get_user_profile,
            get_runs_list,
            get_unseen_trace_ids,
            mark_run_seen,
            mark_all_runs_seen,
            open_run_in_browser,
            copy_run_auto_fix_prompt
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Order matters: bridge first (flushes span + log batches),
                // sidecar second (drains the collector).
                if let Some(handle_slot) = app_handle
                    .try_state::<std::sync::Mutex<Option<telemetry::bridge::BridgeHandle>>>()
                {
                    let handle = handle_slot.inner().lock().unwrap().take();
                    if let Some(h) = handle {
                        tauri::async_runtime::block_on(h.shutdown());
                    }
                }
                if let Some(sidecar) = app_handle.try_state::<telemetry::sidecar::Sidecar>() {
                    tauri::async_runtime::block_on(async move {
                        sidecar.inner().shutdown().await;
                    });
                }
            }
        });
}

fn current_auth_config() -> AuthConfig {
    AuthConfig {
        api_base_url: current_base_url().to_string(),
    }
}

fn current_app_name() -> &'static str {
    if tauri::is_dev() {
        DEV_APP_NAME
    } else {
        APP_NAME
    }
}

fn current_state_store() -> AppStateStore {
    AppStateStore::for_namespace(build::session_namespace())
}

fn current_base_url() -> &'static str {
    build::default_api_base_url()
}

fn should_check_for_updates() -> bool {
    !tauri::is_dev()
}
