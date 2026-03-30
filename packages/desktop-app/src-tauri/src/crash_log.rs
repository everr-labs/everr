use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const LOG_FILE_NAME: &str = "crash.log";
const MAX_LOG_SIZE: u64 = 512 * 1024;

static LOG_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

fn log_dir() -> Option<&'static PathBuf> {
    LOG_DIR
        .get_or_init(|| dirs::config_dir().map(|dir| dir.join(everr_core::build::session_namespace())))
        .as_ref()
}

pub(crate) fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };

        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        write_log(&format!("PANIC at {location}: {message}"));
        default_hook(info);
    }));
}

pub(crate) fn log_error(context: &str, error: &anyhow::Error) {
    let message = format!("ERROR [{context}]: {error:#}");
    eprintln!("[everr-app] {message}");
    write_log(&message);
}

fn write_log(message: &str) {
    let Some(dir) = log_dir() else {
        return;
    };

    let log_path = dir.join(LOG_FILE_NAME);

    if let Ok(metadata) = fs::metadata(&log_path) {
        if metadata.len() > MAX_LOG_SIZE {
            let _ = fs::remove_file(&log_path);
        }
    }

    let timestamp = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "???".to_string());

    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) else {
        return;
    };

    let _ = writeln!(file, "[{timestamp}] {message}");
}
