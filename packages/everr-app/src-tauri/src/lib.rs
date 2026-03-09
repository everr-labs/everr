use std::collections::VecDeque;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use arboard::Clipboard;
use everr_core::api::{ApiClient, FailureNotification, TrayStatusResponse};
use everr_core::assistant::{self, AssistantKind, AssistantStatus};
use everr_core::auth::{
    is_no_active_session_error, login_with_prompt, AuthConfig, Session, SessionStore,
};
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
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

const POLL_INTERVAL_SECONDS: u64 = 45;
const AUTH_CHANGED_EVENT: &str = "everr://auth-changed";
const NOTIFICATION_CHANGED_EVENT: &str = "everr://notification-changed";
const NOTIFICATION_WINDOW_LABEL: &str = "notification";
const NOTIFICATION_WINDOW_WIDTH: f64 = 420.0;
const NOTIFICATION_WINDOW_HEIGHT: f64 = 124.0;
const NOTIFICATION_WINDOW_MARGIN: f64 = 16.0;
const TRAY_ICON_ID: &str = "everr-app";
const TRAY_MENU_RUNNING_STATUS_ID: &str = "tray_running_status";
const TRAY_MENU_FAILED_STATUS_ID: &str = "tray_failed_status";
const TRAY_MENU_OPEN_FAILED_RUNS_ID: &str = "tray_open_failed_runs";
const TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID: &str = "tray_copy_auto_fix_prompt";
const TRAY_MENU_INSERTION_INDEX: usize = 2;
const SETTINGS_MENU_ID: &str = "settings";
const QUIT_MENU_ID: &str = "quit";

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
    #[serde(default)]
    selected_assistants: Vec<AssistantKind>,
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
struct SetupStatusResponse {
    auth_status: AuthStatusResponse,
    cli_status: CliInstallStatusResponse,
    wizard_state: WizardState,
    assistant_statuses: Vec<AssistantStatus>,
    launch_at_login_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct TestNotificationResponse {
    status: &'static str,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
enum OptionalSetupStep {
    Assistants,
    LaunchAtLogin,
}

#[derive(Debug, Default)]
struct NotifierState {
    tracker: FailureTracker,
    queue: NotificationQueue,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct TraySnapshot {
    running_count: usize,
    unresolved_failures: Vec<FailureNotification>,
    failed_runs_dashboard_url: Option<String>,
    auto_fix_prompt: Option<String>,
}

impl TraySnapshot {
    fn failed_count(&self) -> usize {
        self.unresolved_failures.len()
    }
}

impl From<TrayStatusResponse> for TraySnapshot {
    fn from(response: TrayStatusResponse) -> Self {
        Self {
            running_count: response.running_count,
            unresolved_failures: response.unresolved_failures,
            failed_runs_dashboard_url: option_string(response.failed_runs_dashboard_url),
            auto_fix_prompt: option_string(response.auto_fix_prompt),
        }
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
    running_status: MenuItem<tauri::Wry>,
    failed_status: MenuItem<tauri::Wry>,
    open_failed_runs: MenuItem<tauri::Wry>,
    copy_auto_fix_prompt: MenuItem<tauri::Wry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrayMenuModel {
    running_status_label: String,
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
fn get_auth_status(state: State<'_, RuntimeState>) -> Result<AuthStatusResponse, String> {
    auth_status_response(state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_cli_install_status(app: AppHandle) -> Result<CliInstallStatusResponse, String> {
    cli_install_status_response(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_setup_status(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<SetupStatusResponse, String> {
    build_setup_status(&app, state.inner()).map_err(|error| error.to_string())
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
    sign_in_inner(app, state.inner().clone())
        .await
        .map_err(|error| error.to_string())?;
    get_auth_status(state)
}

#[tauri::command]
fn sign_out(app: AppHandle, state: State<'_, RuntimeState>) -> Result<AuthStatusResponse, String> {
    state
        .session_store
        .clear_session()
        .map_err(|error| error.to_string())?;
    clear_tray_snapshot(&app, state.inner()).map_err(|error| error.to_string())?;
    emit_auth_changed(&app);
    get_auth_status(state)
}

#[tauri::command]
fn install_cli(app: AppHandle) -> Result<CliInstallStatusResponse, String> {
    install_cli_bundle(&app).map_err(|error| error.to_string())?;
    get_cli_install_status(app)
}

#[tauri::command]
fn configure_assistants(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    assistants: Vec<AssistantKind>,
) -> Result<SetupStatusResponse, String> {
    assistant::sync_assistants(&assistants, build::command_name())
        .map_err(|error| error.to_string())?;
    update_settings(state.inner(), |settings| {
        settings.wizard_state.selected_assistants = assistants;
        settings.wizard_state.assistant_step_seen = true;
    })
    .map_err(|error| error.to_string())?;
    emit_settings_changed(&app);
    build_setup_status(&app, state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
fn mark_optional_setup_step_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    step: OptionalSetupStep,
) -> Result<SetupStatusResponse, String> {
    update_settings(state.inner(), |settings| match step {
        OptionalSetupStep::Assistants => settings.wizard_state.assistant_step_seen = true,
        OptionalSetupStep::LaunchAtLogin => settings.wizard_state.launch_at_login_step_seen = true,
    })
    .map_err(|error| error.to_string())?;
    emit_settings_changed(&app);
    build_setup_status(&app, state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_launch_at_login(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    enabled: bool,
) -> Result<SetupStatusResponse, String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|error| error.to_string())?;
    } else {
        autostart.disable().map_err(|error| error.to_string())?;
    }

    update_settings(state.inner(), |settings| {
        settings.wizard_state.launch_at_login_step_seen = true;
    })
    .map_err(|error| error.to_string())?;
    emit_settings_changed(&app);
    build_setup_status(&app, state.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
fn complete_setup_wizard(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<SetupStatusResponse, String> {
    if !state
        .session_store
        .has_active_session_for_api_base_url(build::default_api_base_url())
        .map_err(|error| error.to_string())?
    {
        return Err("Sign in before finishing setup.".to_string());
    }

    if !cli_install_path()
        .map_err(|error| error.to_string())?
        .exists()
    {
        return Err("Install the CLI before finishing setup.".to_string());
    }

    update_settings(state.inner(), |settings| {
        settings.completed_base_url = Some(build::default_api_base_url().to_string());
        settings.wizard_state.wizard_completed = true;
        settings.wizard_state.assistant_step_seen = true;
        settings.wizard_state.launch_at_login_step_seen = true;
    })
    .map_err(|error| error.to_string())?;
    emit_settings_changed(&app);
    build_setup_status(&app, state.inner()).map_err(|error| error.to_string())
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
fn copy_notification_auto_fix_prompt(app: AppHandle) -> Result<(), String> {
    copy_tray_auto_fix_prompt(&app).map_err(|error| error.to_string())
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

            app.handle().plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                None::<Vec<&str>>,
            ))?;

            let session_store = SessionStore::for_namespace(build::session_namespace());
            let _ = session_store.clear_mismatched_session(build::default_api_base_url())?;
            let settings = load_app_settings(&session_store)?;
            if let Err(error) = sync_installed_cli(app.handle()) {
                eprintln!("[everr-app] failed to sync installed CLI: {error}");
            }
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_status,
            get_setup_status,
            get_active_notification,
            start_sign_in,
            sign_out,
            install_cli,
            get_cli_install_status,
            configure_assistants,
            mark_optional_setup_step_seen,
            set_launch_at_login,
            complete_setup_wizard,
            dismiss_active_notification,
            open_notification_target,
            copy_notification_auto_fix_prompt,
            trigger_test_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
            builder = builder.icon_as_template(true);
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
    if let Err(error) = refresh_tray_status(&app, &state).await {
        eprintln!("[everr-app] failed to refresh tray status after sign-in: {error}");
    }
    emit_auth_changed(&app);
    Ok(())
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

fn build_setup_status(app: &AppHandle, state: &RuntimeState) -> Result<SetupStatusResponse> {
    let assistant_statuses = assistant::assistant_statuses()?;
    let launch_at_login_enabled = app.autolaunch().is_enabled()?;
    let settings = current_settings(state)?;

    Ok(SetupStatusResponse {
        auth_status: auth_status_response(state)?,
        cli_status: cli_install_status_response(app)?,
        wizard_state: settings.wizard_state,
        assistant_statuses,
        launch_at_login_enabled,
    })
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
        let _ = window.emit("everr://settings-changed", ());
    }
}

fn emit_auth_changed(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(AUTH_CHANGED_EVENT, ());
    }
}

fn build_tray_menu(app: &AppHandle) -> Result<TrayMenu> {
    let running_status = MenuItem::with_id(
        app,
        TRAY_MENU_RUNNING_STATUS_ID,
        "Running pipelines: 0",
        false,
        None::<&str>,
    )?;
    let failed_status = MenuItem::with_id(
        app,
        TRAY_MENU_FAILED_STATUS_ID,
        "Unresolved failed pipelines: 0",
        false,
        None::<&str>,
    )?;
    let open_failed_runs = MenuItem::with_id(
        app,
        TRAY_MENU_OPEN_FAILED_RUNS_ID,
        "Open failed runs",
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
    let settings = MenuItem::with_id(app, SETTINGS_MENU_ID, "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &running_status,
            &failed_status,
            &separator,
            &settings,
            &quit,
        ],
    )?;

    Ok(TrayMenu {
        menu,
        running_status,
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
    menu.running_status.set_text(&model.running_status_label)?;
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
        running_status_label: format!("Running pipelines: {}", snapshot.running_count),
        failed_status_label: format!("Unresolved failed pipelines: {}", snapshot.failed_count()),
        show_failed_actions: snapshot.failed_count() > 0,
    }
}

fn format_tray_title(snapshot: &TraySnapshot) -> String {
    format!("R{} F{}", snapshot.running_count, snapshot.failed_count())
}

fn format_tray_tooltip(snapshot: &TraySnapshot) -> String {
    format!(
        "Everr App | Running pipelines: {} | Unresolved failed pipelines: {}",
        snapshot.running_count,
        snapshot.failed_count()
    )
}

fn tray_failed_runs_target(snapshot: &TraySnapshot) -> Option<&str> {
    if snapshot.failed_count() == 0 {
        return None;
    }

    snapshot.failed_runs_dashboard_url.as_deref()
}

fn tray_auto_fix_prompt(snapshot: &TraySnapshot) -> Option<&str> {
    if snapshot.failed_count() == 0 {
        return None;
    }

    snapshot.auto_fix_prompt.as_deref()
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

async fn refresh_tray_status(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let session = state
        .session_store
        .load_session_for_api_base_url(build::default_api_base_url())?;
    refresh_tray_status_with_session(app, state, &session).await
}

async fn refresh_tray_status_with_session(
    app: &AppHandle,
    state: &RuntimeState,
    session: &Session,
) -> Result<()> {
    let client = ApiClient::from_session(session)?;
    let response = client.get_tray_status().await?;
    update_tray_snapshot(app, state, TraySnapshot::from(response))
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
        "{}/dashboard/runs/{trace_id}/jobs/{job_id}/steps/1",
        current_base_url().trim_end_matches('/')
    );

    Ok(FailureNotification {
        dedupe_key: format!("dev-settings-test-{nonce}"),
        trace_id,
        repo,
        branch,
        workflow_name: "Test notification".to_string(),
        failure_time: timestamp,
        details_url,
        job_name: Some("Developer settings".to_string()),
        step_number: Some("1".to_string()),
        step_name: Some("Preview desktop notification".to_string()),
    })
}

async fn poll_and_notify(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let session = match state
        .session_store
        .load_session_for_api_base_url(build::default_api_base_url())
    {
        Ok(session) => session,
        Err(error) if is_no_active_session_error(&error) => {
            clear_tray_snapshot(app, state)?;
            return Ok(());
        }
        Err(error) => return Err(error),
    };

    if let Err(error) = refresh_tray_status_with_session(app, state, &session).await {
        eprintln!("[everr-app] tray status poll failed: {error}");
    }

    let current_dir = std::env::current_dir().context("failed to resolve cwd")?;
    let git = resolve_git_context(&current_dir);
    let git_email = match git.email.as_deref() {
        Some(value) => value,
        None => return Ok(()),
    };

    let client = ApiClient::from_session(&session)?;
    let response = client
        .get_owned_failures(git_email, git.repo.as_deref(), git.branch.as_deref())
        .await?;
    if !response.verified_match {
        return Ok(());
    }

    let fresh = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.tracker.retain_new(response.failures)
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

fn current_base_url() -> &'static str {
    build::default_api_base_url()
}

fn option_string(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
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
                || object.contains_key("selected_assistants")
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
    use serde_json::json;
    use tempfile::tempdir;

    use super::{
        apply_runtime_settings, apply_wizard_migration, build_tray_menu_model, current_base_url,
        format_tray_title, format_tray_tooltip, migrate_completed_base_url,
        sync_installed_cli_from_paths, tray_auto_fix_prompt, tray_failed_runs_target,
        value_has_wizard_metadata, AppSettings, NotificationQueue, TraySnapshot, TrayState,
        WizardState,
    };

    fn failure(dedupe_key: &str) -> FailureNotification {
        FailureNotification {
            dedupe_key: dedupe_key.to_string(),
            trace_id: format!("trace-{dedupe_key}"),
            repo: "everr-labs/everr".to_string(),
            branch: "main".to_string(),
            workflow_name: "CI".to_string(),
            failure_time: "2026-03-07T10:00:00Z".to_string(),
            details_url: format!("https://example.com/{dedupe_key}"),
            job_name: Some("test".to_string()),
            step_number: Some("2".to_string()),
            step_name: Some("Run suite".to_string()),
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
        TraySnapshot {
            running_count: 3,
            unresolved_failures: vec![failure("one"), failure("two")],
            failed_runs_dashboard_url: Some(
                "https://example.com/dashboard/runs?conclusion=failure".to_string(),
            ),
            auto_fix_prompt: Some("Investigate and fix the pipelines.".to_string()),
        }
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
    fn tray_title_and_tooltip_include_running_and_failed_counts() {
        let snapshot = tray_snapshot_with_failures();

        assert_eq!(format_tray_title(&snapshot), "R3 F2");
        assert_eq!(
            format_tray_tooltip(&snapshot),
            "Everr App | Running pipelines: 3 | Unresolved failed pipelines: 2"
        );
    }

    #[test]
    fn tray_menu_model_shows_failed_actions_when_failures_exist() {
        let snapshot = tray_snapshot_with_failures();
        let model = build_tray_menu_model(&snapshot);

        assert_eq!(model.running_status_label, "Running pipelines: 3");
        assert_eq!(model.failed_status_label, "Unresolved failed pipelines: 2");
        assert!(model.show_failed_actions);
    }

    #[test]
    fn tray_menu_model_hides_failed_actions_when_failures_are_empty() {
        let model = build_tray_menu_model(&TraySnapshot::default());

        assert_eq!(model.running_status_label, "Running pipelines: 0");
        assert_eq!(model.failed_status_label, "Unresolved failed pipelines: 0");
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
            running_count: 1,
            unresolved_failures: vec![failure("one")],
            failed_runs_dashboard_url: None,
            auto_fix_prompt: None,
        };

        assert_eq!(tray_failed_runs_target(&snapshot), None);
        assert_eq!(tray_auto_fix_prompt(&snapshot), None);
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
                selected_assistants: Vec::new(),
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
                selected_assistants: Vec::new(),
            },
        };

        apply_runtime_settings(&mut settings);
        assert!(!settings.wizard_state.wizard_completed);
    }

    #[test]
    fn legacy_base_url_field_is_ignored_during_deserialization() {
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
            settings.wizard_state.selected_assistants,
            vec![super::AssistantKind::Codex]
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
