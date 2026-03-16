use std::collections::VecDeque;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use arboard::Clipboard;
use everr_core::api::{ApiClient, FailureNotification};
use everr_core::assistant::{self, AssistantKind, AssistantStatus};
use everr_core::auth::{is_no_active_session_error, login_with_prompt, AuthConfig, SessionStore};
use everr_core::build;
use everr_core::git::resolve_git_context;
use everr_core::notifier::FailureTracker;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Emitter;
use tauri::{
    AppHandle, LogicalPosition, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use url::Url;

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

const POLL_INTERVAL_SECONDS: u64 = 30;
const AUTH_CHANGED_EVENT: &str = "everr://auth-changed";
const SETTINGS_CHANGED_EVENT: &str = "everr://settings-changed";
const NOTIFICATION_CHANGED_EVENT: &str = "everr://notification-changed";
const NOTIFICATION_WINDOW_LABEL: &str = "notification";
const NOTIFICATION_WINDOW_WIDTH: f64 = 420.0;
const NOTIFICATION_WINDOW_HEIGHT: f64 = 124.0;
const NOTIFICATION_WINDOW_MARGIN: f64 = 16.0;
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
const TRAY_FAILURES_WINDOW_MINUTES: u64 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartupUpdateAction {
    Skip,
    Continue,
    Restart,
}

#[derive(Clone)]
struct RuntimeState {
    session_store: SessionStore,
    settings: Arc<Mutex<AppSettings>>,
    notifier: Arc<Mutex<NotifierState>>,
    tray: Arc<Mutex<TrayState>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
struct AppSettings {
    #[serde(default)]
    completed_base_url: Option<String>,
    #[serde(flatten)]
    wizard_state: WizardState,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            completed_base_url: None,
            wizard_state: WizardState::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
struct WizardState {
    #[serde(default)]
    wizard_completed: bool,
    #[serde(default)]
    assistant_step_seen: bool,
    #[serde(default)]
    launch_at_login_step_seen: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct AuthStatusResponse {
    status: &'static str,
    session_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct CliInstallStatusResponse {
    status: &'static str,
    install_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct AssistantSetupResponse {
    assistant_statuses: Vec<AssistantStatus>,
    assistant_step_seen: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct LaunchAtLoginStatusResponse {
    launch_at_login_enabled: bool,
    launch_at_login_step_seen: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct WizardStatusResponse {
    wizard_completed: bool,
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
    auto_fix_prompt: Option<String>,
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

#[tauri::command]
async fn get_auth_status(state: State<'_, RuntimeState>) -> Result<AuthStatusResponse, String> {
    let state = state.inner().clone();
    run_blocking_command(move || auth_status_response(&state)).await
}

#[tauri::command]
async fn get_cli_install_status(app: AppHandle) -> Result<CliInstallStatusResponse, String> {
    run_blocking_command(move || cli_install_status_response(&app)).await
}

#[tauri::command]
async fn get_assistant_setup(
    state: State<'_, RuntimeState>,
) -> Result<AssistantSetupResponse, String> {
    let state = state.inner().clone();
    run_blocking_command(move || assistant_setup_response(&state)).await
}

#[tauri::command]
async fn get_launch_at_login_status(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<LaunchAtLoginStatusResponse, String> {
    let state = state.inner().clone();
    run_blocking_command(move || launch_at_login_status_response(&app, &state)).await
}

#[tauri::command]
async fn get_wizard_status(state: State<'_, RuntimeState>) -> Result<WizardStatusResponse, String> {
    let state = state.inner().clone();
    run_blocking_command(move || wizard_status_response(&state)).await
}

#[tauri::command]
fn get_active_notification(
    state: State<'_, RuntimeState>,
) -> Result<Option<FailureNotification>, String> {
    let notifier = state
        .notifier
        .lock()
        .map_err(|_| "failed to lock notifier state".to_string())?;
    Ok(notifier.queue.active().cloned())
}

#[tauri::command]
async fn start_sign_in(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<AuthStatusResponse, String> {
    let state = state.inner().clone();

    sign_in_inner(app, state.clone())
        .await
        .map_err(|error| error.to_string())?;

    run_blocking_command(move || auth_status_response(&state)).await
}

#[tauri::command]
async fn sign_out(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<AuthStatusResponse, String> {
    let runtime = state.inner().clone();
    let response = run_blocking_command(move || {
        runtime.session_store.clear_session()?;
        auth_status_response(&runtime)
    })
    .await?;

    clear_tray_snapshot(&app, state.inner()).map_err(|error| error.to_string())?;
    emit_auth_changed(&app);

    Ok(response)
}

#[tauri::command]
async fn install_cli(app: AppHandle) -> Result<CliInstallStatusResponse, String> {
    run_blocking_command(move || {
        install_cli_bundle(&app)?;
        cli_install_status_response(&app)
    })
    .await
}

#[tauri::command]
async fn configure_assistants(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    assistants: Vec<AssistantKind>,
) -> Result<AssistantSetupResponse, String> {
    let runtime = state.inner().clone();
    let response = run_blocking_command(move || {
        assistant::sync_assistants(&assistants, build::command_name())?;
        update_settings(&runtime, mark_assistant_step_seen_in_settings)?;

        assistant_setup_response(&runtime)
    })
    .await?;

    emit_settings_changed(&app);

    Ok(response)
}

#[tauri::command]
async fn mark_assistant_step_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<AssistantSetupResponse, String> {
    let runtime = state.inner().clone();
    let response = run_blocking_command(move || {
        update_settings(&runtime, mark_assistant_step_seen_in_settings)?;
        assistant_setup_response(&runtime)
    })
    .await?;

    emit_settings_changed(&app);

    Ok(response)
}

#[tauri::command]
async fn set_launch_at_login(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    enabled: bool,
) -> Result<LaunchAtLoginStatusResponse, String> {
    let response_app = app.clone();
    let runtime = state.inner().clone();
    let response = run_blocking_command(move || {
        let autostart = response_app.autolaunch();
        if enabled {
            autostart.enable()?;
        } else {
            autostart.disable()?;
        }

        update_settings(&runtime, mark_launch_at_login_step_seen_in_settings)?;
        launch_at_login_status_response(&response_app, &runtime)
    })
    .await?;

    emit_settings_changed(&app);

    Ok(response)
}

#[tauri::command]
async fn mark_launch_at_login_step_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<LaunchAtLoginStatusResponse, String> {
    let response_app = app.clone();
    let runtime = state.inner().clone();
    let response = run_blocking_command(move || {
        update_settings(&runtime, mark_launch_at_login_step_seen_in_settings)?;
        launch_at_login_status_response(&response_app, &runtime)
    })
    .await?;

    emit_settings_changed(&app);

    Ok(response)
}

#[tauri::command]
async fn complete_setup_wizard(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<WizardStatusResponse, String> {
    let runtime = state.inner().clone();
    let response = run_blocking_command(move || {
        if !runtime
            .session_store
            .has_active_session_for_api_base_url(build::default_api_base_url())?
        {
            return Err(anyhow!("Sign in before finishing setup."));
        }

        if !cli_install_path()?.exists() {
            return Err(anyhow!("Install the CLI before finishing setup."));
        }

        update_settings(&runtime, mark_setup_complete_in_settings)?;
        wizard_status_response(&runtime)
    })
    .await?;

    emit_settings_changed(&app);

    Ok(response)
}

#[tauri::command]
fn dismiss_active_notification(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    dismiss_active_notification_inner(&app, state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_notification_target(app: AppHandle, state: State<'_, RuntimeState>) -> Result<(), String> {
    open_notification_target_inner(&app, state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
fn copy_notification_auto_fix_prompt(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<(), String> {
    let _ = app;
    copy_notification_auto_fix_prompt_inner(state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
fn trigger_test_notification(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<TestNotificationResponse, String> {
    let notification = build_test_notification().map_err(|error| error.to_string())?;
    let shown = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| "failed to lock notifier state".to_string())?;
        notifier.queue.enqueue(notification)
    };

    if shown {
        sync_notification_window(&app, state.inner()).map_err(|error| error.to_string())?;
    }

    Ok(TestNotificationResponse {
        status: if shown { "shown" } else { "queued" },
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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

            let session_store = current_session_store();
            let _ = session_store.clear_mismatched_session(build::default_api_base_url())?;
            let settings = load_app_settings(&session_store)?;
            run_local_startup_maintenance(app.handle());
            let runtime = RuntimeState {
                session_store,
                settings: Arc::new(Mutex::new(settings)),
                notifier: Arc::new(Mutex::new(NotifierState::default())),
                tray: Arc::new(Mutex::new(TrayState::default())),
            };

            app.manage(runtime.clone());
            let tray_menu = build_tray(app.handle())?;
            {
                let mut tray = runtime
                    .tray
                    .lock()
                    .map_err(|_| anyhow!("failed to lock tray state"))?;
                tray.menu = Some(tray_menu);
            }
            sync_tray_ui(app.handle(), &runtime)?;
            if wizard_incomplete(&runtime)? {
                open_settings_window(app.handle())?;
            }
            start_notifier_loop(app.handle().clone(), runtime);
            start_startup_update_check(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_status,
            get_assistant_setup,
            get_launch_at_login_status,
            get_wizard_status,
            get_active_notification,
            start_sign_in,
            sign_out,
            install_cli,
            get_cli_install_status,
            configure_assistants,
            mark_assistant_step_seen,
            set_launch_at_login,
            mark_launch_at_login_step_seen,
            complete_setup_wizard,
            dismiss_active_notification,
            open_notification_target,
            copy_notification_auto_fix_prompt,
            trigger_test_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn run_local_startup_maintenance(app: &AppHandle) {
    if let Err(error) = sync_installed_cli(app) {
        eprintln!("[everr-app] failed to sync installed CLI: {error}");
    }

    if let Err(error) = assistant::refresh_existing_managed_prompts(build::command_name()) {
        eprintln!("[everr-app] failed to refresh assistant instructions: {error}");
    }
}

fn start_startup_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let update_installed = match install_startup_update_if_available(&app).await {
            Ok(update_installed) => update_installed,
            Err(error) => {
                eprintln!("[everr-app] updater startup check failed: {error}");
                false
            }
        };

        if startup_update_action(tauri::is_dev(), update_installed) == StartupUpdateAction::Restart
        {
            app.request_restart();
        }
    });
}

async fn install_startup_update_if_available(app: &AppHandle) -> Result<bool> {
    if !should_check_for_updates() {
        return Ok(false);
    }

    let updater = app.updater()?;

    let Some(update) = updater.check().await? else {
        return Ok(false);
    };

    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(true)
}

fn build_tray(app: &AppHandle) -> Result<TrayMenu> {
    let tray_menu = build_tray_menu(app)?;
    let initial_snapshot = TraySnapshot::default();

    let mut builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .menu(&tray_menu.menu)
        .title(format_tray_title(&initial_snapshot))
        .tooltip(format_tray_tooltip(&initial_snapshot));
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
        #[cfg(target_os = "macos")]
        {
            if !tauri::is_dev() {
                builder = builder.icon_as_template(true);
            }
        }
    }

    builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            SETTINGS_MENU_ID => {
                let _ = open_settings_window(app);
            }
            TRAY_MENU_OPEN_FAILED_RUNS_ID => {
                let _ = open_tray_failed_runs(app);
            }
            TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID => {
                let _ = copy_tray_auto_fix_prompt(app);
            }
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(tray_menu)
}

async fn sign_in_inner(app: AppHandle, state: RuntimeState) -> Result<()> {
    let auth_config = current_auth_config();

    login_with_prompt(&auth_config, &state.session_store, |verification_url, _| {
        let _ = webbrowser::open(&verification_url);
    })
    .await?;

    match load_owned_failures_for_current_repo(&state).await {
        Ok(Some((failures, repo, branch))) => {
            if let Err(error) = update_tray_snapshot(
                &app,
                &state,
                build_tray_snapshot(&failures, repo.as_deref(), branch.as_deref()),
            ) {
                eprintln!("[everr-app] failed to refresh tray after sign-in: {error}");
            }
        }
        Ok(None) => {
            if let Err(error) = clear_tray_snapshot(&app, &state) {
                eprintln!("[everr-app] failed to clear tray after sign-in: {error}");
            }
        }
        Err(error) => {
            eprintln!("[everr-app] failed to refresh tray after sign-in: {error}");
        }
    }

    emit_auth_changed(&app);
    Ok(())
}

async fn run_blocking_command<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn install_cli_bundle(app: &AppHandle) -> Result<()> {
    let bundled_cli_path = bundled_cli_path(app)?;
    let install_path = cli_install_path()?;
    install_cli_from_path(&bundled_cli_path, &install_path)
}

fn install_cli_from_path(source_path: &Path, install_path: &Path) -> Result<()> {
    if let Some(parent) = install_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    fs::copy(source_path, install_path).with_context(|| {
        format!(
            "failed to copy bundled CLI from {} to {}",
            source_path.display(),
            install_path.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let metadata = fs::metadata(&install_path)
            .with_context(|| format!("failed to read {}", install_path.display()))?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&install_path, permissions)
            .with_context(|| format!("failed to chmod {}", install_path.display()))?;
    }

    Ok(())
}

fn sync_installed_cli(app: &AppHandle) -> Result<bool> {
    let install_path = cli_install_path()?;
    if !install_path.exists() {
        return Ok(false);
    }

    let bundled_cli_path = bundled_cli_path(app)?;
    sync_installed_cli_from_paths(&bundled_cli_path, &install_path)
}

fn sync_installed_cli_from_paths(bundled_cli_path: &Path, install_path: &Path) -> Result<bool> {
    if !install_path.exists() {
        return Ok(false);
    }

    if cli_sha256(bundled_cli_path)? == cli_sha256(install_path)? {
        return Ok(false);
    }

    install_cli_from_path(bundled_cli_path, install_path)?;
    Ok(true)
}

fn cli_sha256(path: &Path) -> Result<[u8; 32]> {
    let mut file =
        fs::File::open(path).with_context(|| format!("failed to open {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("failed to read {}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hasher.finalize().into())
}

fn cli_install_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("failed to resolve home directory")?;
    Ok(home.join(".local").join("bin").join("everr"))
}

fn bundled_cli_path(app: &AppHandle) -> Result<PathBuf> {
    let resource_dir = app
        .path()
        .resource_dir()
        .context("failed to resolve app resource directory")?;
    let direct = resource_dir.join("everr");
    if direct.exists() {
        return Ok(direct);
    }

    Err(anyhow!(
        "bundled CLI resource not found in {}",
        resource_dir.display()
    ))
}

fn start_notifier_loop(app: AppHandle, state: RuntimeState) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = poll_and_notify(&app, &state).await {
                eprintln!("[everr-app] notifier poll failed: {error}");
            }
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)).await;
        }
    });
}

fn auth_status_response(state: &RuntimeState) -> Result<AuthStatusResponse> {
    let session_path = state.session_store.session_file_path()?;
    let status = if state
        .session_store
        .has_active_session_for_api_base_url(build::default_api_base_url())?
    {
        "signed_in"
    } else {
        "signed_out"
    };

    Ok(AuthStatusResponse {
        status,
        session_path: session_path.display().to_string(),
    })
}

fn cli_install_status_response(app: &AppHandle) -> Result<CliInstallStatusResponse> {
    if let Err(error) = sync_installed_cli(app) {
        eprintln!("[everr-app] failed to sync installed CLI: {error}");
    }

    let install_path = cli_install_path()?;
    let status = if install_path.exists() {
        "installed"
    } else {
        "not_installed"
    };

    Ok(CliInstallStatusResponse {
        status,
        install_path: install_path.display().to_string(),
    })
}

fn assistant_setup_response(state: &RuntimeState) -> Result<AssistantSetupResponse> {
    let wizard_state = current_settings(state)?.wizard_state;

    Ok(build_assistant_setup_response(
        assistant::assistant_statuses()?,
        wizard_state,
    ))
}

fn build_assistant_setup_response(
    assistant_statuses: Vec<AssistantStatus>,
    wizard_state: WizardState,
) -> AssistantSetupResponse {
    AssistantSetupResponse {
        assistant_statuses,
        assistant_step_seen: wizard_state.assistant_step_seen,
    }
}

fn launch_at_login_status_response(
    app: &AppHandle,
    state: &RuntimeState,
) -> Result<LaunchAtLoginStatusResponse> {
    let wizard_state = current_settings(state)?.wizard_state;

    Ok(build_launch_at_login_status_response(
        app.autolaunch().is_enabled()?,
        wizard_state,
    ))
}

fn build_launch_at_login_status_response(
    launch_at_login_enabled: bool,
    wizard_state: WizardState,
) -> LaunchAtLoginStatusResponse {
    LaunchAtLoginStatusResponse {
        launch_at_login_enabled,
        launch_at_login_step_seen: wizard_state.launch_at_login_step_seen,
    }
}

fn wizard_status_response(state: &RuntimeState) -> Result<WizardStatusResponse> {
    let wizard_state = current_settings(state)?.wizard_state;

    Ok(build_wizard_status_response(wizard_state))
}

fn build_wizard_status_response(wizard_state: WizardState) -> WizardStatusResponse {
    WizardStatusResponse {
        wizard_completed: wizard_state.wizard_completed,
    }
}

fn mark_assistant_step_seen_in_settings(settings: &mut AppSettings) {
    settings.wizard_state.assistant_step_seen = true;
}

fn mark_launch_at_login_step_seen_in_settings(settings: &mut AppSettings) {
    settings.wizard_state.launch_at_login_step_seen = true;
}

fn mark_setup_complete_in_settings(settings: &mut AppSettings) {
    settings.completed_base_url = Some(build::default_api_base_url().to_string());
    settings.wizard_state.wizard_completed = true;
    settings.wizard_state.assistant_step_seen = true;
    settings.wizard_state.launch_at_login_step_seen = true;
}

fn current_settings(state: &RuntimeState) -> Result<AppSettings> {
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| anyhow!("failed to lock settings"))
        .map(|settings| settings.clone())?;
    apply_runtime_settings(&mut settings);
    Ok(settings)
}

fn update_settings<F>(state: &RuntimeState, mutate: F) -> Result<()>
where
    F: FnOnce(&mut AppSettings),
{
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| anyhow!("failed to lock settings"))?;
    mutate(&mut settings);
    save_app_settings(&state.session_store, &settings)
}

fn emit_settings_changed(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(SETTINGS_CHANGED_EVENT, ());
    }
}

fn emit_auth_changed(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(AUTH_CHANGED_EVENT, ());
    }
}

fn build_tray_menu(app: &AppHandle) -> Result<TrayMenu> {
    let failed_status = MenuItem::with_id(
        app,
        TRAY_MENU_FAILED_STATUS_ID,
        "Recent failed pipelines (5m): 0",
        false,
        None::<&str>,
    )?;
    let open_failed_runs = MenuItem::with_id(
        app,
        TRAY_MENU_OPEN_FAILED_RUNS_ID,
        "Open recent failed runs",
        true,
        None::<&str>,
    )?;
    let copy_auto_fix_prompt = MenuItem::with_id(
        app,
        TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID,
        "Copy auto-fix prompt",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let dev = MenuItem::with_id(app, TRAY_MENU_DEV_ID, "DEV", false, None::<&str>)?;
    let settings = MenuItem::with_id(app, SETTINGS_MENU_ID, "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)?;
    let menu = if tauri::is_dev() {
        Menu::with_items(app, &[&failed_status, &separator, &dev, &settings, &quit])?
    } else {
        Menu::with_items(app, &[&failed_status, &separator, &settings, &quit])?
    };

    Ok(TrayMenu {
        menu,
        failed_status,
        open_failed_runs,
        copy_auto_fix_prompt,
    })
}

fn update_tray_snapshot(
    app: &AppHandle,
    state: &RuntimeState,
    snapshot: TraySnapshot,
) -> Result<()> {
    {
        let mut tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        tray.replace_snapshot(snapshot);
    }
    sync_tray_ui(app, state)
}

fn clear_tray_snapshot(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    {
        let mut tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        tray.clear_snapshot();
    }
    sync_tray_ui(app, state)
}

fn sync_tray_ui(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let (title, tooltip, menu_model, menu) = {
        let tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        (
            format_tray_title(&tray.snapshot),
            format_tray_tooltip(&tray.snapshot),
            build_tray_menu_model(&tray.snapshot),
            tray.menu.clone(),
        )
    };

    if let Some(tray_icon) = app.tray_by_id(TRAY_ICON_ID) {
        tray_icon.set_title(Some(title))?;
        tray_icon.set_tooltip(Some(tooltip))?;
    }

    if let Some(menu) = menu {
        sync_tray_menu(&menu, &menu_model)?;
    }

    Ok(())
}

fn sync_tray_menu(menu: &TrayMenu, model: &TrayMenuModel) -> Result<()> {
    menu.failed_status.set_text(&model.failed_status_label)?;

    let has_open_action = menu.menu.get(TRAY_MENU_OPEN_FAILED_RUNS_ID).is_some();
    if model.show_failed_actions {
        if !has_open_action {
            menu.menu
                .insert(&menu.open_failed_runs, TRAY_MENU_INSERTION_INDEX)?;
        }

        if menu.menu.get(TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID).is_none() {
            menu.menu
                .insert(&menu.copy_auto_fix_prompt, TRAY_MENU_INSERTION_INDEX + 1)?;
        }
    } else {
        if has_open_action {
            menu.menu.remove(&menu.open_failed_runs)?;
        }

        if menu.menu.get(TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID).is_some() {
            menu.menu.remove(&menu.copy_auto_fix_prompt)?;
        }
    }

    Ok(())
}

fn build_tray_menu_model(snapshot: &TraySnapshot) -> TrayMenuModel {
    TrayMenuModel {
        failed_status_label: format!("Recent failed pipelines (5m): {}", snapshot.failed_count()),
        show_failed_actions: snapshot.failed_count() > 0,
    }
}

fn format_tray_title(snapshot: &TraySnapshot) -> String {
    if snapshot.failed_count() == 0 {
        return String::new();
    }

    format!("F{}", snapshot.failed_count())
}

fn format_tray_tooltip(snapshot: &TraySnapshot) -> String {
    format!(
        "{} | Recent failed pipelines (5m): {}",
        current_app_name(),
        snapshot.failed_count()
    )
}

fn tray_failed_runs_target(snapshot: &TraySnapshot) -> Option<&str> {
    if snapshot.failed_count() == 0 {
        return None;
    }

    snapshot.dashboard_url.as_deref()
}

fn tray_auto_fix_prompt(snapshot: &TraySnapshot) -> Option<&str> {
    if snapshot.failed_count() == 0 {
        return None;
    }

    snapshot.auto_fix_prompt.as_deref()
}

fn active_notification_auto_fix_prompt(queue: &NotificationQueue) -> Option<&str> {
    queue
        .active()
        .and_then(|notification| notification.auto_fix_prompt.as_deref())
}

fn open_tray_failed_runs(app: &AppHandle) -> Result<()> {
    let Some(state) = app.try_state::<RuntimeState>() else {
        return Ok(());
    };
    let target = {
        let tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        tray_failed_runs_target(&tray.snapshot).map(str::to_owned)
    };

    let Some(target) = target else {
        return Ok(());
    };

    webbrowser::open(&target).with_context(|| format!("failed to open tray target {target}"))?;
    Ok(())
}

fn copy_tray_auto_fix_prompt(app: &AppHandle) -> Result<()> {
    let Some(state) = app.try_state::<RuntimeState>() else {
        return Ok(());
    };
    let prompt = {
        let tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        tray_auto_fix_prompt(&tray.snapshot).map(str::to_owned)
    };

    let Some(prompt) = prompt else {
        return Ok(());
    };

    let mut clipboard = Clipboard::new().context("failed to access clipboard")?;
    clipboard
        .set_text(prompt)
        .context("failed to copy tray auto-fix prompt")?;
    Ok(())
}

fn copy_notification_auto_fix_prompt_inner(state: &RuntimeState) -> Result<()> {
    let notification_prompt = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        active_notification_auto_fix_prompt(&notifier.queue).map(str::to_owned)
    };

    let prompt = if let Some(prompt) = notification_prompt {
        Some(prompt)
    } else {
        let tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        tray_auto_fix_prompt(&tray.snapshot).map(str::to_owned)
    };

    let Some(prompt) = prompt else {
        return Ok(());
    };

    let mut clipboard = Clipboard::new().context("failed to access clipboard")?;
    clipboard
        .set_text(prompt)
        .context("failed to copy notification auto-fix prompt")?;
    Ok(())
}

async fn load_owned_failures_for_current_repo(
    state: &RuntimeState,
) -> Result<Option<(Vec<FailureNotification>, Option<String>, Option<String>)>> {
    let session = state
        .session_store
        .load_session_for_api_base_url(build::default_api_base_url());
    let session = match session {
        Ok(session) => session,
        Err(error) if is_no_active_session_error(&error) => return Ok(None),
        Err(error) => return Err(error),
    };

    let current_dir = std::env::current_dir().context("failed to resolve cwd")?;
    let git = resolve_git_context(&current_dir);
    let Some(git_email) = git.email.as_deref() else {
        return Ok(None);
    };

    let client = ApiClient::from_session(&session)?;
    let failures = client
        .get_owned_failures(git_email, git.repo.as_deref(), git.branch.as_deref())
        .await?;

    Ok(Some((failures, git.repo, git.branch)))
}

fn build_tray_snapshot(
    failures: &[FailureNotification],
    repo: Option<&str>,
    branch: Option<&str>,
) -> TraySnapshot {
    TraySnapshot {
        failures: failures.to_vec(),
        dashboard_url: build_tray_failed_runs_url(repo, branch),
        auto_fix_prompt: build_tray_auto_fix_prompt(failures),
    }
}

fn build_tray_failed_runs_url(repo: Option<&str>, branch: Option<&str>) -> Option<String> {
    let mut url = Url::parse(current_base_url()).ok()?;
    url.set_path("/runs");
    url.set_query(None);

    let from = format!("now-{}m", TRAY_FAILURES_WINDOW_MINUTES);
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("conclusion", "failure");
        query.append_pair("from", &from);
        query.append_pair("to", "now");
        if let Some(repo) = repo {
            query.append_pair("repo", repo);
        }
        if let Some(branch) = branch {
            query.append_pair("branch", branch);
        }
    }

    Some(url.into())
}

fn build_tray_auto_fix_prompt(failures: &[FailureNotification]) -> Option<String> {
    if failures.is_empty() {
        return None;
    }

    let mut failures_by_repo: Vec<(&str, Vec<&FailureNotification>)> = Vec::new();
    for failure in failures {
        if let Some((_, repo_failures)) = failures_by_repo
            .iter_mut()
            .find(|(repo, _)| *repo == failure.repo.as_str())
        {
            repo_failures.push(failure);
        } else {
            failures_by_repo.push((failure.repo.as_str(), vec![failure]));
        }
    }

    let mut sections = vec![
        "Investigate and fix these recent CI pipeline failures.".to_string(),
        "Use Everr CLI from the current project directory before guessing.".to_string(),
        String::new(),
        "Required workflow:".to_string(),
        "- Start by pulling logs with the exact `everr runs logs` command listed for each failure below.".to_string(),
        "- Show where the error is, and verify if it is related to the current branch or if it is a general issue with the repo."
        "- If it is a general issue with the repo, say so explicitly, verify if it is flaky using Everr."
        "- If it is a local issue and something trivially fixable like a linting error or a out-to-date test, make the smallest repo-local fix that addresses the root cause.".to_string(),
        "- If it something more complicated, show me the error message and suggest some possible next steps.".to_string(),
        "- Work repo-by-repo. If a repo is not available locally, say so explicitly.".to_string(),
        String::new(),
        "Current recent failures:".to_string(),
    ];

    for (repo, repo_failures) in failures_by_repo {
        sections.push(String::new());
        sections.push(format!("Repo: {repo}"));

        for failure in repo_failures {
            let failing_step = match (failure.job_name.as_deref(), failure.step_number.as_deref()) {
                (Some(job_name), Some(step_number)) => {
                    let step_suffix = failure
                        .step_name
                        .as_deref()
                        .map(|step_name| format!(" ({step_name})"))
                        .unwrap_or_default();
                    format!(" | step {job_name} #{step_number}{step_suffix}")
                }
                _ => String::new(),
            };

            sections.push(format!(
                "- branch {} | workflow {} | trace {} | failed at {}{}",
                failure.branch,
                failure.workflow_name,
                failure.trace_id,
                failure.failed_at,
                failing_step
            ));

            if let Some(logs_command) = build_runs_logs_command(failure) {
                sections.push(format!("  logs: `{logs_command}`"));
            }
        }
    }

    sections.push(String::new());
    sections.push(
        "Return a concise summary with root cause, code changes, verification, and any follow-up risk.".to_string(),
    );

    Some(sections.join("\n"))
}

fn build_runs_logs_command(failure: &FailureNotification) -> Option<String> {
    let job_name = failure.job_name.as_deref()?;
    let step_number = failure.step_number.as_deref()?;
    let escaped_job_name = serde_json::to_string(job_name).ok()?;

    Some(format!(
        "everr runs logs --trace-id {} --job-name {} --step-number {}",
        failure.trace_id, escaped_job_name, step_number
    ))
}

fn wizard_incomplete(state: &RuntimeState) -> Result<bool> {
    Ok(!current_settings(state)?.wizard_state.wizard_completed)
}

fn build_test_notification() -> Result<FailureNotification> {
    let now = OffsetDateTime::now_utc();
    let timestamp = now
        .format(&Rfc3339)
        .context("failed to format test notification timestamp")?;
    let nonce = now.unix_timestamp_nanos();
    let trace_id = format!("trace-dev-settings-test-{nonce}");
    let job_id = format!("job-dev-settings-test-{nonce}");
    let (repo, branch) = match std::env::current_dir()
        .ok()
        .map(|cwd| resolve_git_context(&cwd))
    {
        Some(git) => (
            git.repo.unwrap_or_else(|| "local repository".to_string()),
            git.branch.unwrap_or_else(|| "current branch".to_string()),
        ),
        None => ("local repository".to_string(), "current branch".to_string()),
    };
    let details_url = format!(
        "{}/runs/{trace_id}/jobs/{job_id}/steps/1",
        current_base_url().trim_end_matches('/')
    );

    Ok(FailureNotification {
        dedupe_key: format!("dev-settings-test-{nonce}"),
        trace_id: trace_id.clone(),
        repo,
        branch: branch.clone(),
        workflow_name: "Test notification".to_string(),
        failed_at: timestamp,
        details_url,
        job_name: Some("Developer settings".to_string()),
        step_number: Some("1".to_string()),
        step_name: Some("Preview desktop notification".to_string()),
        auto_fix_prompt: Some(
            format!(
                "Investigate and fix this unresolved CI pipeline failure.\nUse Everr CLI from the current project directory before guessing.\n\nRequired workflow:\n- Start by pulling logs with this exact command:\n  `everr runs logs --trace-id {trace_id} --job-name \"Developer settings\" --step-number 1`\n- Make the smallest repo-local fix that addresses the root cause.\n- Run the narrowest relevant test or check before finishing.\n\nCurrent unresolved failure:\n- branch {branch} | workflow Test notification | trace {trace_id} | step Developer settings #1 (Preview desktop notification)\n\nReturn a concise summary with root cause, code changes, verification, and any follow-up risk."
            ),
        ),
    })
}

async fn poll_and_notify(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let Some((failures, repo, branch)) = load_owned_failures_for_current_repo(state).await? else {
        clear_tray_snapshot(app, state)?;
        return Ok(());
    };

    update_tray_snapshot(
        app,
        state,
        build_tray_snapshot(&failures, repo.as_deref(), branch.as_deref()),
    )?;

    let fresh = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.tracker.retain_new(failures)
    };

    for failure in fresh {
        enqueue_notification(app, state, failure)?;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("everr://notifier-checked", ());
    }
    Ok(())
}

fn enqueue_notification(
    app: &AppHandle,
    state: &RuntimeState,
    notification: FailureNotification,
) -> Result<()> {
    let active_changed = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.enqueue(notification)
    };

    if active_changed {
        sync_notification_window(app, state)?;
    }

    Ok(())
}

fn dismiss_active_notification_inner(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let active_changed = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.advance()
    };

    if active_changed {
        sync_notification_window(app, state)?;
    }

    Ok(())
}

fn open_notification_target_inner(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let target = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier
            .queue
            .active()
            .map(|notification| notification.details_url.clone())
    };

    let Some(target) = target else {
        return Ok(());
    };

    webbrowser::open(&target)
        .with_context(|| format!("failed to open notification target {target}"))?;
    dismiss_active_notification_inner(app, state)
}

fn sync_notification_window(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let has_active_notification = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.active().is_some()
    };

    if has_active_notification {
        show_notification_window(app)?;
    } else {
        hide_notification_window(app)?;
    }

    app.emit(NOTIFICATION_CHANGED_EVENT, ())
        .context("failed to emit notification update")
}

fn show_notification_window(app: &AppHandle) -> Result<()> {
    let window = ensure_notification_window(app)?;
    configure_notification_window_for_fullscreen(&window)?;
    position_notification_window(app, &window)?;
    window
        .show()
        .context("failed to show notification window")?;
    Ok(())
}

fn hide_notification_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
        window
            .hide()
            .context("failed to hide notification window")?;
    }
    Ok(())
}

fn ensure_notification_window(app: &AppHandle) -> Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
        return Ok(window);
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        NOTIFICATION_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Everr Notification")
    .inner_size(NOTIFICATION_WINDOW_WIDTH, NOTIFICATION_WINDOW_HEIGHT)
    .min_inner_size(NOTIFICATION_WINDOW_WIDTH, NOTIFICATION_WINDOW_HEIGHT)
    .max_inner_size(NOTIFICATION_WINDOW_WIDTH, NOTIFICATION_WINDOW_HEIGHT)
    .prevent_overflow()
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .visible(false)
    .focused(false)
    .decorations(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .shadow(true);

    if let Ok((x, y)) = notification_window_position(app) {
        builder = builder.position(x, y);
    }

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon)?;
    }

    builder
        .build()
        .context("failed to build notification window")
}

#[cfg(target_os = "macos")]
fn configure_notification_window_for_fullscreen(window: &WebviewWindow) -> Result<()> {
    let window = window.clone();
    let window_for_main_thread = window.clone();
    window
        .run_on_main_thread(move || {
            let Ok(ns_window) = window_for_main_thread.ns_window() else {
                return;
            };

            let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
            let behavior = ns_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary;
            ns_window.setCollectionBehavior(behavior);
        })
        .context("failed to configure notification window fullscreen behavior")
}

#[cfg(not(target_os = "macos"))]
fn configure_notification_window_for_fullscreen(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

fn position_notification_window(app: &AppHandle, window: &WebviewWindow) -> Result<()> {
    let (x, y) = notification_window_position(app)?;
    window
        .set_position(LogicalPosition::new(x, y))
        .context("failed to position notification window")
}

fn notification_window_position(app: &AppHandle) -> Result<(f64, f64)> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| anyhow!("failed to resolve notification monitor"))?;
    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor();
    let width = (NOTIFICATION_WINDOW_WIDTH * scale_factor).round() as i32;
    let margin = (NOTIFICATION_WINDOW_MARGIN * scale_factor).round() as i32;
    let x = work_area.position.x + work_area.size.width as i32 - width - margin;
    let y = work_area.position.y + margin;

    Ok((x as f64 / scale_factor, y as f64 / scale_factor))
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

fn current_session_store() -> SessionStore {
    SessionStore::for_namespace(build::session_namespace())
}

fn current_base_url() -> &'static str {
    build::default_api_base_url()
}

fn should_check_for_updates() -> bool {
    !tauri::is_dev()
}

fn startup_update_action(is_dev: bool, update_installed: bool) -> StartupUpdateAction {
    if is_dev {
        StartupUpdateAction::Skip
    } else if update_installed {
        StartupUpdateAction::Restart
    } else {
        StartupUpdateAction::Continue
    }
}

fn settings_file_path(session_store: &SessionStore) -> Result<PathBuf> {
    let session_path = session_store.session_file_path()?;
    let parent = session_path
        .parent()
        .ok_or_else(|| anyhow!("failed to resolve settings directory"))?;
    Ok(parent.join("settings.json"))
}

fn load_app_settings(session_store: &SessionStore) -> Result<AppSettings> {
    let path = settings_file_path(session_store)?;
    let (mut settings, has_wizard_metadata, should_persist) = if path.exists() {
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let value = serde_json::from_str::<Value>(&raw)
            .with_context(|| format!("failed to parse {}", path.display()))?;
        let settings = serde_json::from_value::<AppSettings>(value.clone())
            .with_context(|| format!("failed to parse {}", path.display()))?;
        (settings, value_has_wizard_metadata(&value), false)
    } else {
        (AppSettings::default(), false, true)
    };

    let migrated = apply_wizard_migration(
        &mut settings,
        needs_legacy_wizard_migration(session_store, path.exists(), has_wizard_metadata)?,
    );
    let completed_base_url_migrated = migrate_completed_base_url(&mut settings);

    if migrated
        || completed_base_url_migrated
        || should_persist && settings.wizard_state.wizard_completed
    {
        save_app_settings(session_store, &settings)?;
    }

    Ok(settings)
}

fn save_app_settings(session_store: &SessionStore, settings: &AppSettings) -> Result<()> {
    let path = settings_file_path(session_store)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let serialized =
        serde_json::to_string_pretty(settings).context("failed to serialize settings")?;
    fs::write(&path, serialized).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn open_settings_window(app: &AppHandle) -> Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow!("settings window not found"))?;

    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn value_has_wizard_metadata(value: &Value) -> bool {
    value
        .as_object()
        .map(|object| {
            object.contains_key("wizard_completed")
                || object.contains_key("assistant_step_seen")
                || object.contains_key("launch_at_login_step_seen")
        })
        .unwrap_or(false)
}

fn needs_legacy_wizard_migration(
    session_store: &SessionStore,
    settings_exists: bool,
    has_wizard_metadata: bool,
) -> Result<bool> {
    if settings_exists {
        return Ok(!has_wizard_metadata);
    }

    Ok(session_store.session_file_path()?.exists() || cli_install_path()?.exists())
}

fn apply_wizard_migration(settings: &mut AppSettings, should_complete_wizard: bool) -> bool {
    if settings.wizard_state.wizard_completed || !should_complete_wizard {
        return false;
    }

    settings.wizard_state.wizard_completed = true;
    settings.wizard_state.assistant_step_seen = true;
    settings.wizard_state.launch_at_login_step_seen = true;
    true
}

fn migrate_completed_base_url(settings: &mut AppSettings) -> bool {
    if settings.wizard_state.wizard_completed && settings.completed_base_url.is_none() {
        settings.completed_base_url = Some(current_base_url().to_string());
        return true;
    }

    false
}

fn apply_runtime_settings(settings: &mut AppSettings) {
    if settings.wizard_state.wizard_completed
        && settings.completed_base_url.as_deref() != Some(current_base_url())
    {
        settings.wizard_state.wizard_completed = false;
    }
}

#[cfg(test)]
mod tests {
    use everr_core::api::FailureNotification;
    use everr_core::assistant::{AssistantKind, AssistantStatus};
    use serde_json::json;
    use tempfile::tempdir;

    use super::{
        active_notification_auto_fix_prompt, apply_runtime_settings, apply_wizard_migration,
        build_assistant_setup_response, build_launch_at_login_status_response,
        build_tray_auto_fix_prompt, build_tray_failed_runs_url, build_tray_menu_model,
        build_tray_snapshot, build_wizard_status_response, current_app_name, current_base_url,
        current_session_store, format_tray_title, format_tray_tooltip,
        mark_assistant_step_seen_in_settings, mark_launch_at_login_step_seen_in_settings,
        mark_setup_complete_in_settings, migrate_completed_base_url, should_check_for_updates,
        startup_update_action, sync_installed_cli_from_paths, tray_auto_fix_prompt,
        tray_failed_runs_target, value_has_wizard_metadata, AppSettings, NotificationQueue,
        StartupUpdateAction, TraySnapshot, TrayState, WizardState, APP_NAME, DEV_APP_NAME,
        TRAY_FAILURES_WINDOW_MINUTES,
    };

    fn failure(dedupe_key: &str) -> FailureNotification {
        FailureNotification {
            dedupe_key: dedupe_key.to_string(),
            trace_id: format!("trace-{dedupe_key}"),
            repo: "everr-labs/everr".to_string(),
            branch: "main".to_string(),
            workflow_name: "CI".to_string(),
            failed_at: "2026-03-07T10:00:00Z".to_string(),
            details_url: format!("https://example.com/{dedupe_key}"),
            job_name: Some("test".to_string()),
            step_number: Some("2".to_string()),
            step_name: Some("Run suite".to_string()),
            auto_fix_prompt: Some(format!("Investigate and fix trace-{dedupe_key}.")),
        }
    }

    #[test]
    fn enqueue_first_item_sets_active_notification() {
        let mut queue = NotificationQueue::default();

        assert!(queue.enqueue(failure("one")));
        assert_eq!(
            queue
                .active()
                .map(|notification| notification.dedupe_key.as_str()),
            Some("one")
        );
        assert!(queue.pending.is_empty());
    }

    #[test]
    fn enqueue_additional_items_queues_without_replacing_active() {
        let mut queue = NotificationQueue::default();

        assert!(queue.enqueue(failure("one")));
        assert!(!queue.enqueue(failure("two")));

        assert_eq!(
            queue
                .active()
                .map(|notification| notification.dedupe_key.as_str()),
            Some("one")
        );
        assert_eq!(queue.pending.len(), 1);
    }

    fn tray_snapshot_with_failures() -> TraySnapshot {
        let failures = vec![failure("one"), failure("two")];
        build_tray_snapshot(&failures, Some("everr-labs/everr"), Some("main"))
    }

    #[test]
    fn advance_promotes_next_notification() {
        let mut queue = NotificationQueue::default();
        queue.enqueue(failure("one"));
        queue.enqueue(failure("two"));

        assert!(queue.advance());
        assert_eq!(
            queue
                .active()
                .map(|notification| notification.dedupe_key.as_str()),
            Some("two")
        );
        assert!(queue.pending.is_empty());
    }

    #[test]
    fn advance_clears_active_when_queue_is_exhausted() {
        let mut queue = NotificationQueue::default();
        queue.enqueue(failure("one"));

        assert!(queue.advance());
        assert!(queue.active().is_none());
        assert!(queue.pending.is_empty());
    }

    #[test]
    fn advance_is_noop_when_queue_is_empty() {
        let mut queue = NotificationQueue::default();

        assert!(!queue.advance());
        assert!(queue.active().is_none());
        assert!(queue.pending.is_empty());
    }

    #[test]
    fn tray_title_and_tooltip_include_failed_count_only() {
        let snapshot = tray_snapshot_with_failures();

        assert_eq!(format_tray_title(&snapshot), "F2");
        assert_eq!(
            format_tray_tooltip(&snapshot),
            format!("{} | Recent failed pipelines (5m): 2", current_app_name())
        );
        assert_eq!(format_tray_title(&TraySnapshot::default()), "");
    }

    #[test]
    fn tray_snapshot_builds_recent_failures_dashboard_url_for_current_scope() {
        let snapshot = tray_snapshot_with_failures();
        let expected = format!(
            "{}/runs?conclusion=failure&from=now-5m&to=now&repo=everr-labs%2Feverr&branch=main",
            current_base_url().trim_end_matches('/')
        );

        assert_eq!(snapshot.dashboard_url.as_deref(), Some(expected.as_str()));
        assert_eq!(
            build_tray_failed_runs_url(Some("everr-labs/everr"), Some("main")).as_deref(),
            snapshot.dashboard_url.as_deref()
        );
        assert_eq!(TRAY_FAILURES_WINDOW_MINUTES, 5);
    }

    #[test]
    fn tray_prompt_builder_aggregates_recent_failures_with_logs_commands() {
        let failures = vec![failure("one"), failure("two")];
        let prompt = build_tray_auto_fix_prompt(&failures).expect("tray prompt");

        assert!(prompt.contains("Investigate and fix these recent CI pipeline failures."));
        assert!(prompt.contains("Current recent failures:"));
        assert!(prompt.contains("Repo: everr-labs/everr"));
        assert!(prompt
            .contains("everr runs logs --trace-id trace-one --job-name \"test\" --step-number 2"));
    }

    #[test]
    fn current_session_store_uses_current_build_session_file_name() {
        let store = current_session_store();

        assert_eq!(store.namespace(), super::build::session_namespace());
        assert_eq!(
            store.session_file_name(),
            super::build::default_session_file_name()
        );
    }

    #[test]
    fn current_app_name_matches_the_build_mode() {
        assert_eq!(
            current_app_name(),
            if tauri::is_dev() {
                DEV_APP_NAME
            } else {
                APP_NAME
            }
        );
    }

    #[test]
    fn startup_update_checks_are_disabled_in_dev_only() {
        assert_eq!(should_check_for_updates(), !tauri::is_dev());
    }

    #[test]
    fn startup_update_action_restarts_only_after_successful_install() {
        assert_eq!(startup_update_action(true, true), StartupUpdateAction::Skip);
        assert_eq!(
            startup_update_action(false, false),
            StartupUpdateAction::Continue
        );
        assert_eq!(
            startup_update_action(false, true),
            StartupUpdateAction::Restart
        );
    }

    #[test]
    fn assistant_setup_response_returns_detected_and_configured_statuses() {
        let response = build_assistant_setup_response(
            vec![
                AssistantStatus {
                    assistant: AssistantKind::Codex,
                    detected: true,
                    configured: false,
                    path: "/tmp/.codex/AGENTS.md".to_string(),
                },
                AssistantStatus {
                    assistant: AssistantKind::Claude,
                    detected: true,
                    configured: true,
                    path: "/tmp/.claude/CLAUDE.md".to_string(),
                },
            ],
            WizardState {
                wizard_completed: false,
                assistant_step_seen: true,
                launch_at_login_step_seen: false,
            },
        );

        assert!(response.assistant_step_seen);
        assert_eq!(response.assistant_statuses.len(), 2);
        assert_eq!(
            response.assistant_statuses[0].assistant,
            AssistantKind::Codex
        );
        assert!(!response.assistant_statuses[0].configured);
        assert_eq!(
            response.assistant_statuses[1].assistant,
            AssistantKind::Claude
        );
        assert!(response.assistant_statuses[1].configured);
    }

    #[test]
    fn launch_at_login_response_uses_launch_flag_and_step_state() {
        let response = build_launch_at_login_status_response(
            true,
            WizardState {
                wizard_completed: false,
                assistant_step_seen: false,
                launch_at_login_step_seen: true,
            },
        );

        assert!(response.launch_at_login_enabled);
        assert!(response.launch_at_login_step_seen);
    }

    #[test]
    fn wizard_status_response_uses_completion_flag() {
        let response = build_wizard_status_response(WizardState {
            wizard_completed: true,
            assistant_step_seen: false,
            launch_at_login_step_seen: false,
        });

        assert!(response.wizard_completed);
    }

    #[test]
    fn step_marking_helpers_only_update_their_expected_fields() {
        let mut settings = AppSettings::default();

        mark_assistant_step_seen_in_settings(&mut settings);
        assert!(settings.wizard_state.assistant_step_seen);
        assert!(!settings.wizard_state.launch_at_login_step_seen);
        assert!(!settings.wizard_state.wizard_completed);

        mark_launch_at_login_step_seen_in_settings(&mut settings);
        assert!(settings.wizard_state.launch_at_login_step_seen);
        assert!(!settings.wizard_state.wizard_completed);
    }

    #[test]
    fn complete_setup_helper_marks_all_required_wizard_flags() {
        let mut settings = AppSettings::default();

        mark_setup_complete_in_settings(&mut settings);

        assert!(settings.wizard_state.wizard_completed);
        assert!(settings.wizard_state.assistant_step_seen);
        assert!(settings.wizard_state.launch_at_login_step_seen);
        assert_eq!(
            settings.completed_base_url.as_deref(),
            Some(current_base_url())
        );
    }

    #[test]
    fn tray_menu_model_shows_failed_actions_when_failures_exist() {
        let snapshot = tray_snapshot_with_failures();
        let model = build_tray_menu_model(&snapshot);

        assert_eq!(model.failed_status_label, "Recent failed pipelines (5m): 2");
        assert!(model.show_failed_actions);
    }

    #[test]
    fn tray_menu_model_hides_failed_actions_when_failures_are_empty() {
        let model = build_tray_menu_model(&TraySnapshot::default());

        assert_eq!(model.failed_status_label, "Recent failed pipelines (5m): 0");
        assert!(!model.show_failed_actions);
    }

    #[test]
    fn clearing_tray_state_resets_counts_and_cached_actions() {
        let mut tray = TrayState::default();
        tray.replace_snapshot(tray_snapshot_with_failures());

        tray.clear_snapshot();

        assert_eq!(tray.snapshot, TraySnapshot::default());
    }

    #[test]
    fn tray_actions_are_noops_when_cached_targets_are_missing() {
        let snapshot = TraySnapshot {
            failures: vec![failure("one")],
            dashboard_url: None,
            auto_fix_prompt: None,
        };

        assert_eq!(tray_failed_runs_target(&snapshot), None);
        assert_eq!(tray_auto_fix_prompt(&snapshot), None);
    }

    #[test]
    fn active_notification_prompt_prefers_the_active_queue_item() {
        let mut queue = NotificationQueue::default();
        queue.enqueue(failure("one"));

        assert_eq!(
            active_notification_auto_fix_prompt(&queue),
            Some("Investigate and fix trace-one.")
        );
    }

    #[test]
    fn legacy_settings_are_marked_complete_during_migration() {
        let mut settings = AppSettings {
            completed_base_url: None,
            wizard_state: WizardState::default(),
        };

        assert!(apply_wizard_migration(&mut settings, true));
        assert!(settings.wizard_state.wizard_completed);
        assert!(settings.wizard_state.assistant_step_seen);
        assert!(settings.wizard_state.launch_at_login_step_seen);
    }

    #[test]
    fn migration_is_noop_for_true_first_run_state() {
        let mut settings = AppSettings::default();

        assert!(!apply_wizard_migration(&mut settings, false));
        assert!(!settings.wizard_state.wizard_completed);
    }

    #[test]
    fn wizard_metadata_detection_handles_flattened_fields() {
        assert!(value_has_wizard_metadata(&json!({
            "base_url": "http://localhost:5173",
            "wizard_completed": true,
        })));
        assert!(!value_has_wizard_metadata(&json!({
            "selected_assistants": ["codex"],
        })));
        assert!(!value_has_wizard_metadata(&json!({
            "base_url": "http://localhost:5173",
        })));
    }

    #[test]
    fn completed_wizard_gets_current_build_base_url_during_migration() {
        let mut settings = AppSettings {
            completed_base_url: None,
            wizard_state: WizardState {
                wizard_completed: true,
                assistant_step_seen: true,
                launch_at_login_step_seen: true,
            },
        };

        assert!(migrate_completed_base_url(&mut settings));
        assert_eq!(
            settings.completed_base_url.as_deref(),
            Some(current_base_url())
        );
    }

    #[test]
    fn mismatched_completed_base_url_reopens_the_wizard() {
        let mut settings = AppSettings {
            completed_base_url: Some("https://app.everr.dev".to_string()),
            wizard_state: WizardState {
                wizard_completed: true,
                assistant_step_seen: true,
                launch_at_login_step_seen: true,
            },
        };

        apply_runtime_settings(&mut settings);
        assert!(!settings.wizard_state.wizard_completed);
    }

    #[test]
    fn legacy_base_url_and_selected_assistants_fields_are_ignored_during_deserialization() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "base_url": "https://app.everr.dev",
            "wizard_completed": true,
            "assistant_step_seen": true,
            "launch_at_login_step_seen": true,
            "selected_assistants": ["codex"],
        }))
        .expect("parse settings");

        assert_eq!(settings.completed_base_url, None);
        assert!(settings.wizard_state.wizard_completed);
        assert_eq!(
            serde_json::to_value(settings).expect("serialize settings"),
            json!({
                "completed_base_url": null,
                "wizard_completed": true,
                "assistant_step_seen": true,
                "launch_at_login_step_seen": true,
            })
        );
    }

    #[test]
    fn sync_installed_cli_returns_false_when_install_is_missing() {
        let temp = tempdir().expect("tempdir");
        let bundled = temp.path().join("bundled-everr");
        let installed = temp.path().join("installed-everr");

        std::fs::write(&bundled, b"bundled").expect("write bundled cli");

        assert!(!sync_installed_cli_from_paths(&bundled, &installed).expect("sync cli install"));
        assert!(!installed.exists());
    }

    #[test]
    fn sync_installed_cli_returns_false_when_hashes_match() {
        let temp = tempdir().expect("tempdir");
        let bundled = temp.path().join("bundled-everr");
        let installed = temp.path().join("installed-everr");

        std::fs::write(&bundled, b"same").expect("write bundled cli");
        std::fs::write(&installed, b"same").expect("write installed cli");

        assert!(!sync_installed_cli_from_paths(&bundled, &installed).expect("sync cli install"));
        assert_eq!(
            std::fs::read(&installed).expect("read installed cli"),
            b"same"
        );
    }

    #[test]
    fn sync_installed_cli_replaces_outdated_binary() {
        let temp = tempdir().expect("tempdir");
        let bundled = temp.path().join("bundled-everr");
        let installed = temp.path().join("installed-everr");

        std::fs::write(&bundled, b"new-cli").expect("write bundled cli");
        std::fs::write(&installed, b"old-cli").expect("write installed cli");

        assert!(sync_installed_cli_from_paths(&bundled, &installed).expect("sync cli install"));
        assert_eq!(
            std::fs::read(&installed).expect("read installed cli"),
            b"new-cli"
        );
    }
}
