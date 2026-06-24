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

/// Status-dot color, emerald-500 — matches the in-app "update available" accent.
const BADGE_RGB: (u8, u8, u8) = (16, 185, 129);

/// Whether the *unbadged* base tray icon should render as a macOS template
/// (system-tinted monochrome). Off-macOS and in dev this is false. The single
/// definition of the rule, shared by `build_tray` and `refresh_tray_icon`.
fn base_icon_is_template() -> bool {
    cfg!(target_os = "macos") && !tauri::is_dev()
}

/// Returns a copy of `base` with a green status dot composited onto its
/// bottom-right corner. The dot is sized relative to the icon (so it scales with
/// @2x assets), anti-aliased, and alpha-blended over the icon so it reads cleanly
/// at menu-bar sizes.
pub(crate) fn badge_icon(base: &Image) -> Image<'static> {
    let width = base.width();
    let height = base.height();
    let mut rgba = base.rgba().to_vec();

    let min_dim = (width.min(height)) as f32;
    let radius = (min_dim * 0.22).max(3.0);
    // Smaller horizontal margin pushes the dot closer to the right edge.
    let margin_x = min_dim * 0.01;
    let margin_y = min_dim * 0.05;
    let cx = width as f32 - radius - margin_x;
    let cy = height as f32 - radius - margin_y;

    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            // Full coverage inside the radius, fading over a 1px anti-aliased edge.
            let coverage = (radius + 0.5 - dist).clamp(0.0, 1.0);
            if coverage <= 0.0 {
                continue;
            }
            let idx = ((y * width + x) * 4) as usize;
            let blend = |src: u8, dst: u8| {
                (src as f32 * coverage + dst as f32 * (1.0 - coverage)).round() as u8
            };
            rgba[idx] = blend(BADGE_RGB.0, rgba[idx]);
            rgba[idx + 1] = blend(BADGE_RGB.1, rgba[idx + 1]);
            rgba[idx + 2] = blend(BADGE_RGB.2, rgba[idx + 2]);
            // Make the dot opaque even over fully-transparent icon pixels.
            let dst_a = rgba[idx + 3] as f32 / 255.0;
            rgba[idx + 3] = ((coverage + dst_a * (1.0 - coverage)) * 255.0).round() as u8;
        }
    }

    Image::new_owned(rgba, width, height)
}

/// Reflects the staged-update state on the tray *icon* by overlaying a green
/// status dot. Paired with [`refresh_update_menu_item`], which updates the menu.
/// Best-effort — a missing tray must never crash the app.
pub(crate) fn refresh_tray_icon(app: &AppHandle, has_update: bool) {
    let Some(base) = tray_base_icon() else {
        return;
    };

    // The base icon is a macOS template (monochrome) in release builds; a colored
    // badge can't show through a template, so the badged icon is set non-template.
    let (icon, is_template) = if has_update {
        (badge_icon(&base), false)
    } else {
        (base, base_icon_is_template())
    };

    let result = app
        .tray_by_id(TRAY_ICON_ID)
        .context("tray icon not found")
        .and_then(|tray| {
            tray.set_icon_with_as_template(Some(icon), is_template)
                .context("failed to set tray icon")
        });
    if let Err(error) = result {
        crate::crash_log::log_error("refresh tray icon", &error);
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
        builder = builder.icon(icon).icon_as_template(base_icon_is_template());
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
