use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use everr_core::api::FailureNotification;
use everr_core::assistant::AssistantStatus;
use everr_core::auth::{AuthConfig, DeviceAuthorization};
use everr_core::build;
use everr_core::notifier::FailureTracker;
use everr_core::state::{AppState, AppStateStore};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
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
mod settings;
mod startup;
mod tray;

#[cfg(test)]
mod tests;

use commands::{
    complete_setup_wizard, configure_assistants, copy_notification_auto_fix_prompt,
    dismiss_active_notification, get_active_notification, get_assistant_setup, get_auth_status,
    get_notification_emails, get_pending_sign_in, get_user_profile, get_wizard_status,
    open_notification_target, open_sign_in_browser, poll_sign_in, reset_dev_onboarding,
    set_notification_emails, sign_out, start_sign_in, trigger_test_notification,
};
use notifications::{dismiss_active_notification_inner, start_notifier_loop};
use settings::{open_settings_window, wizard_incomplete};
use startup::{run_local_startup_maintenance, start_session_poll_loop, start_update_check_loop};
use tray::{build_tray, sync_tray_ui};

const UPDATE_CHECK_INTERVAL_SECONDS: u64 = 15 * 60;
const AUTH_CHANGED_EVENT: &str = "everr://auth-changed";
const SETTINGS_CHANGED_EVENT: &str = "everr://settings-changed";
const NOTIFICATION_CHANGED_EVENT: &str = "everr://notification-changed";
const NOTIFICATION_HOVER_EVENT: &str = "everr://notification-hover";
const NOTIFICATION_WINDOW_LABEL: &str = "notification";
const NOTIFICATION_WINDOW_WIDTH: f64 = 420.0;
const NOTIFICATION_WINDOW_HEIGHT: f64 = 124.0;
const NOTIFICATION_WINDOW_MARGIN: f64 = 56.0;
const NOTIFICATION_WINDOW_INSET: f64 = 12.0;
const TRAY_ICON_ID: &str = "everr-app";
const TRAY_MENU_FAILED_STATUS_ID: &str = "tray_failed_status";
const TRAY_MENU_OPEN_FAILED_RUNS_ID: &str = "tray_open_failed_runs";
const TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID: &str = "tray_copy_auto_fix_prompt";
const TRAY_MENU_DEV_ID: &str = "tray_dev";
const TRAY_MENU_INSERTION_INDEX: usize = 1;
const SETTINGS_MENU_ID: &str = "settings";
const QUIT_MENU_ID: &str = "quit";
const APP_NAME: &str = "Everr";
const DEV_APP_NAME: &str = "Everr_Dev";
const TRAY_FAILURES_WINDOW_MINUTES: u64 = 30;

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
    persisted: Arc<Mutex<AppState>>,
    notifier: Arc<Mutex<NotifierState>>,
    tray: Arc<Mutex<TrayState>>,
    pending_auth: Arc<Mutex<Option<PendingAuthState>>>,
    session_changed: Arc<Notify>,
    emails_changed: Arc<Notify>,
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TraySnapshot {
    failures: Vec<FailureNotification>,
    dashboard_url: Option<String>,
}

impl TraySnapshot {
    fn failed_count(&self) -> usize {
        self.failures.len()
    }
}

struct TrayState {
    snapshot: TraySnapshot,
    menu: Option<TrayMenu>,
}

impl Default for TrayState {
    fn default() -> Self {
        Self {
            snapshot: TraySnapshot::default(),
            menu: None,
        }
    }
}

impl TrayState {
    fn replace_snapshot(&mut self, snapshot: TraySnapshot) {
        self.snapshot = snapshot;
    }

    fn clear_snapshot(&mut self) {
        self.snapshot = TraySnapshot::default();
    }
}

#[derive(Clone)]
struct TrayMenu {
    menu: Menu<tauri::Wry>,
    failed_status: MenuItem<tauri::Wry>,
    open_failed_runs: MenuItem<tauri::Wry>,
    copy_auto_fix_prompt: MenuItem<tauri::Wry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrayMenuModel {
    failed_status_label: String,
    show_failed_actions: bool,
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
            let mut persisted = store.load_state()?;
            persisted
                .settings
                .apply_runtime_base_url(build::default_api_base_url());
            run_local_startup_maintenance(app.handle());
            let runtime = RuntimeState {
                store,
                persisted: Arc::new(Mutex::new(persisted)),
                notifier: Arc::new(Mutex::new(NotifierState::default())),
                tray: Arc::new(Mutex::new(TrayState::default())),
                pending_auth: Arc::new(Mutex::new(None)),
                session_changed: Arc::new(Notify::new()),
                emails_changed: Arc::new(Notify::new()),
            };

            app.manage(runtime.clone());
            let tray_menu = build_tray(app.handle())?;
            {
                let mut tray = runtime
                    .tray
                    .lock()
                    .map_err(|_| anyhow::anyhow!("failed to lock tray state"))?;
                tray.menu = Some(tray_menu);
            }
            sync_tray_ui(app.handle(), &runtime)?;
            if wizard_incomplete(&runtime)? {
                open_settings_window(app.handle())?;
            }
            start_notifier_loop(app.handle().clone(), runtime.clone());
            start_session_poll_loop(app.handle().clone(), runtime);
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
            complete_setup_wizard,
            dismiss_active_notification,
            open_notification_target,
            copy_notification_auto_fix_prompt,
            trigger_test_notification,
            get_notification_emails,
            set_notification_emails,
            get_user_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
