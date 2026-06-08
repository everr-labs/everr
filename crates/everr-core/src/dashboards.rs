use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use walkdir::WalkDir;

/// A dashboard document discovered on disk: its repo-relative POSIX path and
/// parsed JSON contents.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DashboardDocument {
    pub path: String,
    pub document: Value,
}

fn is_dashboard_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("yaml") | Some("yml") | Some("json")
    )
}

fn parse_document(path: &Path, contents: &str) -> Result<Value> {
    let is_json = path.extension().and_then(|e| e.to_str()) == Some("json");
    if is_json {
        serde_json::from_str(contents).map_err(anyhow::Error::from)
    } else {
        serde_yaml::from_str(contents).map_err(anyhow::Error::from)
    }
}

/// Recursively load every `.yaml`/`.yml`/`.json` dashboard under `dir`,
/// returning each with its POSIX path relative to `dir`. Errors name the file.
pub fn load_dashboard_documents(dir: &Path) -> Result<Vec<DashboardDocument>> {
    let mut out = Vec::new();
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_dashboard_file(path) {
            continue;
        }
        let rel = path
            .strip_prefix(dir)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let contents =
            std::fs::read_to_string(path).with_context(|| format!("{rel}: failed to read file"))?;
        let document =
            parse_document(path, &contents).with_context(|| format!("{rel}: failed to parse"))?;
        out.push(DashboardDocument {
            path: rel,
            document,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyDashboardsRequest {
    pub source: String,
    pub documents: Vec<DashboardDocument>,
    #[serde(rename = "dryRun", skip_serializing_if = "std::ops::Not::not")]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ApplyDashboardsSummary {
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub deleted: Vec<String>,
    #[serde(rename = "dryRun")]
    pub dry_run: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn loads_yaml_and_json_with_relative_posix_paths() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("team")).unwrap();
        fs::write(
            dir.path().join("team/cpu.yaml"),
            "kind: Dashboard\nmetadata:\n  name: cpu\nspec:\n  panels: {}\n  layouts: []\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("mem.json"),
            r#"{"kind":"Dashboard","metadata":{"name":"mem"},"spec":{"panels":{},"layouts":[]}}"#,
        )
        .unwrap();

        let mut docs = load_dashboard_documents(dir.path()).unwrap();
        docs.sort_by(|a, b| a.path.cmp(&b.path));

        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].path, "mem.json");
        assert_eq!(docs[1].path, "team/cpu.yaml");
        assert_eq!(docs[1].document["metadata"]["name"], "cpu");
        assert_eq!(docs[1].document["spec"]["layouts"], serde_json::json!([]));
    }

    #[test]
    fn ignores_non_dashboard_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("README.md"), "# not a dashboard").unwrap();
        let docs = load_dashboard_documents(dir.path()).unwrap();
        assert!(docs.is_empty());
    }

    #[test]
    fn errors_with_filename_on_invalid_yaml() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("broken.yaml"), "key: : :\n  - bad").unwrap();
        let err = load_dashboard_documents(dir.path()).unwrap_err();
        assert!(err.to_string().contains("broken.yaml"), "error was: {err}");
    }

    #[test]
    fn apply_request_omits_dry_run_when_false() {
        let req = ApplyDashboardsRequest {
            source: "team".into(),
            documents: vec![DashboardDocument {
                path: "cpu.yaml".into(),
                document: serde_json::json!({"kind": "Dashboard"}),
            }],
            dry_run: false,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["source"], "team");
        assert!(
            v.get("dryRun").is_none(),
            "dryRun should be omitted when false"
        );
    }

    #[test]
    fn apply_request_includes_dry_run_when_true() {
        let req = ApplyDashboardsRequest {
            source: "team".into(),
            documents: vec![],
            dry_run: true,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["dryRun"], true);
    }

    #[test]
    fn apply_summary_deserializes_from_camel_case() {
        let s: ApplyDashboardsSummary = serde_json::from_value(serde_json::json!({
            "created": ["a"], "updated": [], "deleted": ["b"], "dryRun": true
        }))
        .unwrap();
        assert_eq!(s.created, vec!["a".to_string()]);
        assert_eq!(s.deleted, vec!["b".to_string()]);
        assert!(s.dry_run);
    }
}
