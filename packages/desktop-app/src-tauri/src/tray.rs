use anyhow::{Context, Result};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::settings::open_settings_window;
use crate::{current_app_name, QUIT_MENU_ID, RESTART_UPDATE_MENU_ID, SETTINGS_MENU_ID, TRAY_ICON_ID};

const OPEN_MENU_ID: &str = "open";

/// Dedicated tray icon asset (transparent background). The tray must not reuse
/// the app/Dock icon: on macOS the tray renders it as a template (alpha-only),
/// so the Dock icon's opaque background would fill the whole menu-bar slot.
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray.png");

/// Decodes the embedded transparent tray icon. Returns `None` (and logs) on the
/// theoretically-impossible decode failure so a broken asset can't crash the app.
fn tray_base_icon() -> Option<Image<'static>> {
    match Image::from_bytes(TRAY_ICON_BYTES) {
        Ok(icon) => Some(icon),
        Err(error) => {
            crate::crash_log::log_error("decode tray icon", &anyhow::Error::from(error));
            None
        }
    }
}

/// User-facing tray label for the staged-update item.
pub(crate) fn update_menu_label(version: &str) -> String {
    format!("Restart to update (v{version})")
}

/// Builds the tray menu. When `pending_version` is set, the menu includes the
/// "Restart to update" item above Settings.
fn build_tray_menu(app: &AppHandle, pending_version: Option<&str>) -> Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, OPEN_MENU_ID, "Open", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, SETTINGS_MENU_ID, "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)?;

    if let Some(version) = pending_version {
        let restart = MenuItem::with_id(
            app,
            RESTART_UPDATE_MENU_ID,
            update_menu_label(version),
            true,
            None::<&str>,
        )?;
        let update_separator = PredefinedMenuItem::separator(app)?;
        Ok(Menu::with_items(
            app,
            &[&open, &separator, &restart, &update_separator, &settings, &quit],
        )?)
    } else {
        Ok(Menu::with_items(app, &[&open, &separator, &settings, &quit])?)
    }
}

/// Rebuilds and swaps the tray menu to reflect the staged-update state. Tauri v2
/// has no in-place menu mutation, so the whole menu is rebuilt; the tray icon's
/// existing `on_menu_event` handler keeps routing items by id. Best-effort — a
/// missing tray must never crash the app.
pub(crate) fn refresh_update_menu_item(app: &AppHandle, pending_version: Option<&str>) {
    let result = build_tray_menu(app, pending_version).and_then(|menu| {
        app.tray_by_id(TRAY_ICON_ID)
            .context("tray icon not found")?
            .set_menu(Some(menu))
            .context("failed to set tray menu")?;
        Ok(())
    });
    if let Err(error) = result {
        crate::crash_log::log_error("refresh tray update item", &error);
    }
}

/// On Linux the tray backend (`libappindicator-sys`) `dlopen`s the appindicator
/// library when the tray is built and **panics** if it is missing. Probe for it
/// first so a missing library degrades into a recoverable error instead of
/// aborting the process (the main window is shown on launch as a fallback). The
/// candidate sonames mirror the ones the backend itself tries.
#[cfg(target_os = "linux")]
fn appindicator_available() -> bool {
    const CANDIDATES: [&str; 4] = [
        "libayatana-appindicator3.so.1",
        "libappindicator3.so.1",
        "libayatana-appindicator3.so",
        "libappindicator3.so",
    ];

    CANDIDATES
        .iter()
        .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
}

/// A tray icon (StatusNotifierItem) is only *rendered* when a StatusNotifier
/// host/watcher is registered on the session bus. KDE Plasma provides one
/// natively; stock GNOME does not (it needs the AppIndicator extension), so the
/// icon would be invisible even though the library loads. Returns whether a
/// watcher is present so callers can decide to show the window instead.
#[cfg(target_os = "linux")]
pub(crate) fn status_notifier_host_available() -> bool {
    use zbus::blocking::{fdo::DBusProxy, Connection};
    use zbus::names::BusName;

    let Ok(connection) = Connection::session() else {
        return false;
    };
    let Ok(dbus) = DBusProxy::new(&connection) else {
        return false;
    };
    let Ok(name) = BusName::try_from("org.kde.StatusNotifierWatcher") else {
        return false;
    };
    dbus.name_has_owner(name).unwrap_or(false)
}

pub(crate) fn build_tray(app: &AppHandle) -> Result<()> {
    #[cfg(target_os = "linux")]
    if !appindicator_available() {
        anyhow::bail!(
            "system tray unavailable: libayatana-appindicator3 / libappindicator3 is not installed"
        );
    }

    let menu = build_tray_menu(app, None)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .menu(&menu)
        .tooltip(current_app_name());
    if let Some(icon) = tray_base_icon() {
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
            RESTART_UPDATE_MENU_ID => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = crate::update::apply_pending_update(app, "tray").await {
                        crate::crash_log::log_error("apply update from tray", &error);
                    }
                });
            }
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub(crate) fn open_main_window(app: &AppHandle) -> Result<()> {
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
