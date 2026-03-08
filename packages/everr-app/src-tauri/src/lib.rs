use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use everr_core::api::{ApiClient, FailureNotification};
use everr_core::assistant::{self, AssistantKind, AssistantStatus};
use everr_core::auth::{login_with_prompt, AuthConfig, SessionStore};
use everr_core::git::resolve_git_context;
use everr_core::notifier::FailureTracker;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

const APP_NAMESPACE: &str = "everr";
const CLI_COMMAND_NAME: &str = "everr";
const POLL_INTERVAL_SECONDS: u64 = 45;
const API_BASE_URL: &str = "http://localhost:5173";
const NOTIFICATION_CHANGED_EVENT: &str = "everr://notification-changed";
const NOTIFICATION_WINDOW_LABEL: &str = "notification";
const NOTIFICATION_WINDOW_WIDTH: f64 = 420.0;
const NOTIFICATION_WINDOW_HEIGHT: f64 = 124.0;
const NOTIFICATION_WINDOW_MARGIN: f64 = 16.0;

#[derive(Clone)]
struct RuntimeState {
    session_store: SessionStore,
    settings: Arc<Mutex<AppSettings>>,
    notifier: Arc<Mutex<NotifierState>>,
    tray: TrayHandles,
}

#[derive(Clone)]
struct TrayHandles {
    auth_status: MenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    sign_in: MenuItem<tauri::Wry>,
    sign_out: MenuItem<tauri::Wry>,
    cli_status: MenuItem<tauri::Wry>,
    install_cli: MenuItem<tauri::Wry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
struct AppSettings {
    base_url: String,
    #[serde(flatten)]
    wizard_state: WizardState,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            base_url: API_BASE_URL.to_string(),
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
struct SettingsResponse {
    base_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct SetupStatusResponse {
    auth_status: AuthStatusResponse,
    cli_status: CliInstallStatusResponse,
    settings: SettingsResponse,
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
fn get_cli_install_status() -> Result<CliInstallStatusResponse, String> {
    cli_install_status_response().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_settings(state: State<'_, RuntimeState>) -> Result<SettingsResponse, String> {
    settings_response(state.inner()).map_err(|error| error.to_string())
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
fn update_base_url(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    base_url: String,
) -> Result<SettingsResponse, String> {
    let trimmed = base_url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Base URL must start with http:// or https://".to_string());
    }

    update_settings(state.inner(), |settings| {
        settings.base_url = trimmed.to_string();
    })
    .map_err(|error| error.to_string())?;

    refresh_tray_status(state.inner()).map_err(|error| error.to_string())?;
    emit_settings_changed(&app);

    get_settings(state)
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
fn sign_out(state: State<'_, RuntimeState>) -> Result<AuthStatusResponse, String> {
    state
        .session_store
        .clear_session()
        .map_err(|error| error.to_string())?;
    refresh_tray_status(state.inner()).map_err(|error| error.to_string())?;
    get_auth_status(state)
}

#[tauri::command]
fn install_cli(state: State<'_, RuntimeState>) -> Result<CliInstallStatusResponse, String> {
    install_cli_bundle(&state.tray.auth_status.app_handle()).map_err(|error| error.to_string())?;
    refresh_tray_status(state.inner()).map_err(|error| error.to_string())?;
    get_cli_install_status()
}

#[tauri::command]
fn configure_assistants(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    assistants: Vec<AssistantKind>,
) -> Result<SetupStatusResponse, String> {
    assistant::sync_assistants(&assistants, CLI_COMMAND_NAME).map_err(|error| error.to_string())?;
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
        .has_active_session()
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
fn trigger_test_notification(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<TestNotificationResponse, String> {
    let notification = build_test_notification(state.inner()).map_err(|error| error.to_string())?;
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

            let session_store = SessionStore::for_namespace(APP_NAMESPACE);
            let settings = load_app_settings(&session_store)?;
            let tray = build_tray(app.handle())?;
            let runtime = RuntimeState {
                session_store,
                settings: Arc::new(Mutex::new(settings)),
                notifier: Arc::new(Mutex::new(NotifierState::default())),
                tray,
            };

            refresh_tray_status(&runtime)?;
            app.manage(runtime.clone());
            if wizard_incomplete(&runtime)? {
                open_settings_window(app.handle())?;
            }
            start_notifier_loop(app.handle().clone(), runtime);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_status,
            get_setup_status,
            get_settings,
            get_active_notification,
            update_base_url,
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
            trigger_test_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_tray(app: &AppHandle) -> Result<TrayHandles> {
    let auth_status =
        MenuItem::with_id(app, "auth_status", "Auth: checking...", false, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let sign_in = MenuItem::with_id(app, "sign_in", "Sign in", true, None::<&str>)?;
    let sign_out = MenuItem::with_id(app, "sign_out", "Sign out", true, None::<&str>)?;
    let cli_status = MenuItem::with_id(app, "cli_status", "CLI: checking...", false, None::<&str>)?;
    let install_cli = MenuItem::with_id(app, "install_cli", "Install CLI", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &auth_status,
            &settings,
            &sign_in,
            &sign_out,
            &cli_status,
            &install_cli,
            &separator,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("everr-app")
        .menu(&menu)
        .tooltip("Everr App");
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
        #[cfg(target_os = "macos")]
        {
            builder = builder.icon_as_template(true);
        }
    }

    builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "settings" => {
                let _ = open_settings_window(app);
            }
            "sign_in" => {
                if let Some(runtime) = app.try_state::<RuntimeState>() {
                    let app = app.clone();
                    let runtime = runtime.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = sign_in_inner(app, runtime).await;
                    });
                }
            }
            "sign_out" => {
                if let Some(runtime) = app.try_state::<RuntimeState>() {
                    let _ = runtime.session_store.clear_session();
                    let _ = refresh_tray_status(runtime.inner());
                }
            }
            "install_cli" => {
                let _ = install_cli_bundle(app);
                if let Some(runtime) = app.try_state::<RuntimeState>() {
                    let _ = refresh_tray_status(runtime.inner());
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(TrayHandles {
        auth_status,
        settings,
        sign_in,
        sign_out,
        cli_status,
        install_cli,
    })
}

async fn sign_in_inner(app: AppHandle, state: RuntimeState) -> Result<()> {
    let auth_config = current_auth_config(&state)?;

    login_with_prompt(&auth_config, &state.session_store, |verification_url, _| {
        let _ = webbrowser::open(&verification_url);
    })
    .await?;
    refresh_tray_status(&state)?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("everr://auth-changed", ());
    }
    Ok(())
}

fn refresh_tray_status(state: &RuntimeState) -> Result<()> {
    let is_signed_in = state.session_store.has_active_session()?;
    let cli_installed = cli_install_path()?.exists();
    let auth_available = !current_base_url(state)?.is_empty();

    state.tray.auth_status.set_text(if !auth_available {
        "Auth: unavailable"
    } else if is_signed_in {
        "Auth: signed in"
    } else {
        "Auth: signed out"
    })?;
    state.tray.settings.set_enabled(true)?;
    state
        .tray
        .sign_in
        .set_enabled(auth_available && !is_signed_in)?;
    state
        .tray
        .sign_out
        .set_enabled(auth_available && is_signed_in)?;
    state.tray.cli_status.set_text(if cli_installed {
        "CLI: installed"
    } else {
        "CLI: not installed"
    })?;
    state.tray.install_cli.set_enabled(!cli_installed)?;
    Ok(())
}

fn install_cli_bundle(app: &AppHandle) -> Result<()> {
    let bundled_cli_path = bundled_cli_path(app)?;
    let install_path = cli_install_path()?;
    if let Some(parent) = install_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    fs::copy(&bundled_cli_path, &install_path).with_context(|| {
        format!(
            "failed to copy bundled CLI from {} to {}",
            bundled_cli_path.display(),
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

    let preserved_source_path = resource_dir
        .join("_up_")
        .join("_up_")
        .join("docs")
        .join("public")
        .join("everr");
    if preserved_source_path.exists() {
        return Ok(preserved_source_path);
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
    let status = if state.session_store.has_active_session()? {
        "signed_in"
    } else {
        "signed_out"
    };

    Ok(AuthStatusResponse {
        status,
        session_path: session_path.display().to_string(),
    })
}

fn cli_install_status_response() -> Result<CliInstallStatusResponse> {
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

fn settings_response(state: &RuntimeState) -> Result<SettingsResponse> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| anyhow!("failed to lock settings"))?;

    Ok(SettingsResponse {
        base_url: settings.base_url.clone(),
    })
}

fn build_setup_status(app: &AppHandle, state: &RuntimeState) -> Result<SetupStatusResponse> {
    let assistant_statuses = assistant::assistant_statuses()?;
    let launch_at_login_enabled = app.autolaunch().is_enabled()?;
    let settings = current_settings(state)?;
    let wizard_state = response_wizard_state(&settings.wizard_state, &assistant_statuses);

    Ok(SetupStatusResponse {
        auth_status: auth_status_response(state)?,
        cli_status: cli_install_status_response()?,
        settings: SettingsResponse {
            base_url: settings.base_url,
        },
        wizard_state,
        assistant_statuses,
        launch_at_login_enabled,
    })
}

fn current_settings(state: &RuntimeState) -> Result<AppSettings> {
    state
        .settings
        .lock()
        .map_err(|_| anyhow!("failed to lock settings"))
        .map(|settings| settings.clone())
}

fn response_wizard_state(
    stored: &WizardState,
    assistant_statuses: &[AssistantStatus],
) -> WizardState {
    let mut response = stored.clone();
    if response.selected_assistants.is_empty() {
        response.selected_assistants = assistant_statuses
            .iter()
            .filter(|status| status.configured)
            .map(|status| status.assistant)
            .collect();
    }
    response
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

fn wizard_incomplete(state: &RuntimeState) -> Result<bool> {
    Ok(!current_settings(state)?.wizard_state.wizard_completed)
}

fn build_test_notification(state: &RuntimeState) -> Result<FailureNotification> {
    let now = OffsetDateTime::now_utc();
    let timestamp = now
        .format(&Rfc3339)
        .context("failed to format test notification timestamp")?;
    let nonce = now.unix_timestamp_nanos();
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
        "{}/dashboard",
        current_base_url(state)?.trim_end_matches('/')
    );

    Ok(FailureNotification {
        dedupe_key: format!("dev-settings-test-{nonce}"),
        trace_id: format!("trace-dev-settings-test-{nonce}"),
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
    let session = match state.session_store.load_session() {
        Ok(session) => session,
        Err(_) => return Ok(()),
    };

    let current_dir = std::env::current_dir().context("failed to resolve cwd")?;
    let git = resolve_git_context(&current_dir);
    let git_email = match git.email.as_deref() {
        Some(value) => value,
        None => return Ok(()),
    };

    let mut session = session;
    session.api_base_url = current_base_url(state)?;
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

fn current_auth_config(state: &RuntimeState) -> Result<AuthConfig> {
    Ok(AuthConfig {
        api_base_url: current_base_url(state)?,
    })
}

fn current_base_url(state: &RuntimeState) -> Result<String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| anyhow!("failed to lock settings"))?;
    Ok(settings.base_url.clone())
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

    if migrated || should_persist && settings.wizard_state.wizard_completed {
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

#[cfg(test)]
mod tests {
    use everr_core::api::FailureNotification;
    use everr_core::assistant::{AssistantKind, AssistantStatus};
    use serde_json::json;

    use super::{
        apply_wizard_migration, response_wizard_state, value_has_wizard_metadata, AppSettings,
        NotificationQueue, WizardState,
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
    fn legacy_settings_are_marked_complete_during_migration() {
        let mut settings = AppSettings {
            base_url: "http://localhost:5173".to_string(),
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
    fn response_wizard_state_falls_back_to_configured_assistants() {
        let wizard_state = WizardState::default();
        let statuses = vec![
            AssistantStatus {
                assistant: AssistantKind::Codex,
                detected: true,
                configured: true,
                path: "/tmp/.codex/AGENTS.md".to_string(),
            },
            AssistantStatus {
                assistant: AssistantKind::Claude,
                detected: false,
                configured: false,
                path: "/tmp/.claude/CLAUDE.md".to_string(),
            },
        ];

        let response = response_wizard_state(&wizard_state, &statuses);

        assert_eq!(response.selected_assistants, vec![AssistantKind::Codex]);
    }
}
