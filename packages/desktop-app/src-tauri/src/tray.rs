use anyhow::{anyhow, Context, Result};
use arboard::Clipboard;
use everr_core::api::FailureNotification;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use url::Url;

use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::settings::open_settings_window;
use crate::{
    current_app_name, current_base_url, RuntimeState, TrayMenu, TrayMenuModel, TraySnapshot,
    QUIT_MENU_ID, SETTINGS_MENU_ID, TRAY_FAILURES_WINDOW_MINUTES, TRAY_ICON_ID,
    TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID, TRAY_MENU_DEV_ID, TRAY_MENU_FAILED_STATUS_ID,
    TRAY_MENU_INSERTION_INDEX, TRAY_MENU_OPEN_FAILED_RUNS_ID,
};

pub(crate) fn build_tray(app: &AppHandle) -> Result<TrayMenu> {
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

pub(crate) fn update_tray_snapshot(
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

pub(crate) fn clear_tray_snapshot(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    {
        let mut tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        tray.clear_snapshot();
    }
    sync_tray_ui(app, state)
}

pub(crate) fn sync_tray_ui(app: &AppHandle, state: &RuntimeState) -> Result<()> {
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

pub(crate) fn build_tray_menu_model(snapshot: &TraySnapshot) -> TrayMenuModel {
    TrayMenuModel {
        failed_status_label: format!("Recent failed pipelines (5m): {}", snapshot.failed_count()),
        show_failed_actions: snapshot.failed_count() > 0,
    }
}

pub(crate) fn format_tray_title(snapshot: &TraySnapshot) -> String {
    if snapshot.failed_count() == 0 {
        return String::new();
    }

    format!("F{}", snapshot.failed_count())
}

pub(crate) fn format_tray_tooltip(snapshot: &TraySnapshot) -> String {
    format!(
        "{} | Recent failed pipelines (5m): {}",
        current_app_name(),
        snapshot.failed_count()
    )
}

pub(crate) fn tray_failed_runs_target(snapshot: &TraySnapshot) -> Option<&str> {
    if snapshot.failed_count() == 0 {
        return None;
    }

    snapshot.dashboard_url.as_deref()
}

pub(crate) fn tray_auto_fix_prompt(snapshot: &TraySnapshot) -> Option<String> {
    if snapshot.failed_count() == 0 {
        return None;
    }

    snapshot
        .failures
        .first()
        .map(build_notification_auto_fix_prompt)
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
        tray_auto_fix_prompt(&tray.snapshot)
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

pub(crate) fn build_tray_snapshot(
    failures: &[FailureNotification],
    repo: Option<&str>,
    branch: Option<&str>,
) -> TraySnapshot {
    TraySnapshot {
        failures: failures.to_vec(),
        dashboard_url: build_tray_failed_runs_url(repo, branch),
    }
}

pub(crate) fn build_tray_failed_runs_url(
    repo: Option<&str>,
    branch: Option<&str>,
) -> Option<String> {
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
