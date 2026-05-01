use std::fs;
use std::path::{Path, PathBuf};

use crate::build::{HEALTHCHECK_PORT, OTLP_HTTP_PORT, SQL_HTTP_PORT};

const CONFIG_TEMPLATE: &str = include_str!("../assets/collector.yaml.tmpl");

pub fn render_config(telemetry_dir: &Path) -> String {
    CONFIG_TEMPLATE
        .replace("{OTLP_PORT}", &OTLP_HTTP_PORT.to_string())
        .replace("{HEALTH_PORT}", &HEALTHCHECK_PORT.to_string())
        .replace("{SQL_HTTP_PORT}", &SQL_HTTP_PORT.to_string())
        .replace("{TELEMETRY_DIR}", &telemetry_dir.display().to_string())
}

pub fn write_config(telemetry_dir: &Path) -> std::io::Result<PathBuf> {
    fs::create_dir_all(telemetry_dir)?;
    let config_path = telemetry_dir.join(".collector.yaml");
    fs::write(&config_path, render_config(telemetry_dir))?;
    Ok(config_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_config_substitutes_runtime_values() {
        let rendered = render_config(Path::new("/tmp/everr telemetry"));

        assert!(rendered.contains(&format!("127.0.0.1:{OTLP_HTTP_PORT}")));
        assert!(rendered.contains(&format!("127.0.0.1:{HEALTHCHECK_PORT}")));
        assert!(rendered.contains(&format!("127.0.0.1:{SQL_HTTP_PORT}")));
        assert!(rendered.contains(r#""/tmp/everr telemetry/chdb""#));
        assert!(!rendered.contains("{TELEMETRY_DIR}"));
    }

    #[test]
    fn write_config_creates_telemetry_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let telemetry_dir = dir.path().join("telemetry");

        let path = write_config(&telemetry_dir).expect("write config");

        assert_eq!(path, telemetry_dir.join(".collector.yaml"));
        assert!(path.is_file());
    }
}
