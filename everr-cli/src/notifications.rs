use anyhow::Result;

#[cfg(target_os = "macos")]
use mac_notification_sys::{
    get_bundle_identifier, get_bundle_identifier_or_default, send_notification, set_application,
};

pub fn send(title: &str, subtitle: &str, message: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let bundle_id = get_bundle_identifier("Script Editor")
            .or_else(|| get_bundle_identifier("Terminal"))
            .or_else(|| get_bundle_identifier("iTerm"))
            .unwrap_or_else(|| get_bundle_identifier_or_default("Finder"));
        let _ = set_application(&bundle_id);

        send_notification(title, Some(subtitle), message, None)?;
    }

    Ok(())
}
