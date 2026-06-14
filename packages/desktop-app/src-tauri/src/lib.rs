use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use everr_core::api::FailureNotification;
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
pub mod otel;
mod settings;
mod startup;
pub mod telemetry;
mod tray;

#[cfg(test)]
mod tests;

use commands::{
    copy_notification_auto_fix_prompt, copy_run_auto_fix_prompt, dismiss_active_notification,
    get_active_notification, get_auth_status, get_build_info, get_collector_status,
    get_notification_emails, get_org, get_pending_sign_in, get_runs_list, get_user_profile,
    get_wizard_status, open_notification_target, open_run_in_browser, open_sign_in_browser,
    poll_sign_in, reset_dev_onboarding, restart_collector, set_notification_emails, sign_out,
    start_sign_in, trigger_test_notification,
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
const NOTIFICATION_EXIT_EVENT: &str = "everr://notification-exit";
const NOTIFICATION_WINDOW_LABEL: &str = "notification";
const NOTIFICATION_WINDOW_WIDTH: f64 = 420.0;
const NOTIFICATION_WINDOW_HEIGHT: f64 = 124.0;
const NOTIFICATION_WINDOW_MARGIN: f64 = 38.0;
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
    let (telemetry_guard, relay_state, telemetry_context) =
        otel::init_telemetry().expect("telemetry init failed");
    let startup_telemetry_context = telemetry_context.clone();
    let shutdown_telemetry_context = telemetry_context.clone();

    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    // Single-instance must be the first plugin registered. On Linux it doubles
    // as the recovery path when the tray is missing/invisible: re-launching the
    // app focuses the existing window instead of spawning a second instance.
    #[cfg(target_os = "linux")]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = tray::open_main_window(app);
        }));
    }

    builder
        .manage(relay_state)
        .manage(telemetry_context.clone())
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

                    #[cfg(target_os = "macos")]
                    let _ = window
                        .app_handle()
                        .set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
        })
        .setup(move |app| {
            otel::log_app_started(&startup_telemetry_context);

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
            let mut autostart =
                tauri_plugin_autostart::Builder::new().app_name(current_app_name());
            #[cfg(target_os = "macos")]
            {
                autostart = autostart.macos_launcher(MacosLauncher::LaunchAgent);
            }
            app.handle().plugin(autostart.build())?;

            let store = current_state_store();
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
            let collector_state = sidecar.state();
            app.manage(sidecar);
            telemetry::sidecar::start_collector_state_event_loop(
                app.handle().clone(),
                collector_state,
            );

            // A missing/unsupported tray must never take down the app, so any
            // failure building it is logged and recovered from.
            #[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
            let tray_built = match build_tray(app.handle()) {
                Ok(()) => true,
                Err(err) => {
                    tracing::warn!(
                        target: "everr.app",
                        error = %err,
                        "system tray unavailable",
                    );
                    false
                }
            };

            if wizard_incomplete(&runtime)? {
                open_settings_window(app.handle())?;
            } else {
                // On Linux the tray can be absent (no appindicator library) or
                // present-but-invisible (e.g. stock GNOME with no StatusNotifier
                // host). When no tray icon will actually be shown, surface the
                // main window on launch so users can tell the app is running.
                #[cfg(target_os = "linux")]
                if !(tray_built && tray::status_notifier_host_available()) {
                    if let Err(err) = tray::open_main_window(app.handle()) {
                        tracing::warn!(
                            target: "everr.app",
                            error = %err,
                            "failed to show main window on launch",
                        );
                    }
                }
            }
            start_notifier_loop(app.handle().clone(), runtime.clone());
            start_state_change_loop(app.handle().clone(), runtime);
            start_update_check_loop(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_status,
            get_wizard_status,
            get_active_notification,
            start_sign_in,
            get_pending_sign_in,
            poll_sign_in,
            open_sign_in_browser,
            sign_out,
            reset_dev_onboarding,
            dismiss_active_notification,
            open_notification_target,
            copy_notification_auto_fix_prompt,
            trigger_test_notification,
            get_notification_emails,
            set_notification_emails,
            get_build_info,
            get_collector_status,
            restart_collector,
            get_user_profile,
            get_org,
            get_runs_list,
            open_run_in_browser,
            copy_run_auto_fix_prompt,
            otel::get_telemetry_context,
            otel::relay_telemetry,
            telemetry::query::telemetry_sql_query
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(sidecar) = app.try_state::<telemetry::sidecar::Sidecar>() {
                    tauri::async_runtime::block_on(sidecar.shutdown());
                }
                otel::log_app_stopped(&shutdown_telemetry_context);
            }
        });

    drop(telemetry_guard);
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
