use anyhow::{Context, Result};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::settings::open_settings_window;
use crate::{current_app_name, QUIT_MENU_ID, SETTINGS_MENU_ID, TRAY_ICON_ID};

const OPEN_MENU_ID: &str = "open";

pub(crate) fn build_tray(app: &AppHandle) -> Result<()> {
    let open = MenuItem::with_id(app, OPEN_MENU_ID, "Open", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, SETTINGS_MENU_ID, "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &separator, &settings, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .menu(&menu)
        .tooltip(current_app_name());
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
            OPEN_MENU_ID => {
                let _ = open_main_window(app);
            }
            SETTINGS_MENU_ID => {
                let _ = open_settings_window(app);
            }
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn open_main_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

        window.show().context("failed to show main window")?;
        window.set_focus().context("failed to focus main window")?;
    } else {
        open_settings_window(app)?;
    }
    Ok(())
}
