use std::path::Path;

use anyhow::{Context, Result};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A resource document discovered on disk: its repo-relative POSIX path and
/// parsed JSON contents.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceDocument {
    pub path: String,
    pub document: Value,
}

const MANIFEST_FILES: [&str; 2] = ["everr.yaml", "everr.yml"];

fn is_manifest_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| MANIFEST_FILES.contains(&n))
        .unwrap_or(false)
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

/// Recursively load every `.yaml`/`.yml`/`.json` resource under `dir`,
/// returning each with its POSIX path relative to `dir`. Errors name the file.
///
/// The walk honors `.gitignore`/`.ignore` files within the tree and skips
/// hidden entries (including `.git`), so generated, vendored, or scratch
/// YAML/JSON under the apply dir isn't mistaken for desired state. Because the
/// returned set IS the desired state and apply prunes anything missing, the
/// ignore scope is deliberately narrow and local: `require_git(false)` so a
/// `.gitignore` is respected even outside a repo, but `git_global(false)` so a
/// destructive reconcile never depends on the machine's global excludes.
pub fn load_resource_documents(dir: &Path) -> Result<Vec<ResourceDocument>> {
    let mut out = Vec::new();
    // Propagate walk errors instead of dropping them: apply treats this set as
    // the complete desired state and prunes anything missing, so a silently
    // truncated walk (unreadable dir, traversal error) would delete dashboards.
    let walker = WalkBuilder::new(dir)
        .require_git(false)
        .git_global(false)
        .build();
    for entry in walker {
        let entry = entry
            .with_context(|| format!("failed to read directory tree under {}", dir.display()))?;
        let path = entry.path();
        // The walker yields directories too; only regular files are resources.
        if !entry.file_type().is_some_and(|ft| ft.is_file())
            || is_manifest_file(path)
            || !is_dashboard_file(path)
        {
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
        out.push(ResourceDocument {
            path: rel,
            document,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
struct ApplyManifest {
    #[serde(default)]
    projects: Vec<String>,
}

/// Read the required `everr.yaml`/`everr.yml` manifest at the apply root and
/// return its declared project list (the reconcile scope). Errors if no
/// manifest is present — apply only operates on a directory that explicitly
/// opts in.
pub fn load_apply_manifest(dir: &Path) -> Result<Vec<String>> {
    for name in MANIFEST_FILES {
        let path = dir.join(name);
        if path.is_file() {
            let contents = std::fs::read_to_string(&path)
                .with_context(|| format!("{name}: failed to read file"))?;
            let manifest: ApplyManifest = serde_yaml::from_str(&contents)
                .with_context(|| format!("{name}: failed to parse"))?;
            return Ok(manifest.projects);
        }
    }
    anyhow::bail!(
        "no everr.yaml found in {} — create one listing the projects this directory \
         manages, e.g.\nprojects:\n  - default",
        dir.display()
    )
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyRequest {
    pub projects: Vec<String>,
    pub documents: Vec<ResourceDocument>,
    #[serde(rename = "dryRun", skip_serializing_if = "std::ops::Not::not")]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct KindResult {
    pub kind: String,
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub deleted: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ApplyOrganization {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ApplySummary {
    #[serde(rename = "dryRun")]
    pub dry_run: bool,
    pub results: Vec<KindResult>,
    pub organization: ApplyOrganization,
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

        let mut docs = load_resource_documents(dir.path()).unwrap();
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
        let docs = load_resource_documents(dir.path()).unwrap();
        assert!(docs.is_empty());
    }

    const DASH: &str =
        "kind: Dashboard\nmetadata:\n  name: d\nspec:\n  panels: {}\n  layouts: []\n";

    #[test]
    fn respects_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".gitignore"), "generated/\nscratch.yaml\n").unwrap();
        fs::write(dir.path().join("cpu.yaml"), DASH).unwrap();
        fs::write(dir.path().join("scratch.yaml"), DASH).unwrap();
        fs::create_dir_all(dir.path().join("generated")).unwrap();
        fs::write(dir.path().join("generated/old.yaml"), DASH).unwrap();

        let docs = load_resource_documents(dir.path()).unwrap();

        let paths: Vec<&str> = docs.iter().map(|d| d.path.as_str()).collect();
        assert_eq!(paths, vec!["cpu.yaml"], "gitignored files must be excluded");
    }

    #[test]
    fn skips_hidden_files_and_dirs() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("cpu.yaml"), DASH).unwrap();
        fs::write(dir.path().join(".hidden.yaml"), DASH).unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/config.yaml"), DASH).unwrap();

        let docs = load_resource_documents(dir.path()).unwrap();

        let paths: Vec<&str> = docs.iter().map(|d| d.path.as_str()).collect();
        assert_eq!(paths, vec!["cpu.yaml"], "hidden files/dirs must be skipped");
    }

    #[test]
    fn errors_with_filename_on_invalid_yaml() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("broken.yaml"), "key: : :\n  - bad").unwrap();
        let err = load_resource_documents(dir.path()).unwrap_err();
        assert!(err.to_string().contains("broken.yaml"), "error was: {err}");
    }

    #[test]
    fn apply_request_omits_dry_run_when_false() {
        let req = ApplyRequest {
            projects: vec![],
            documents: vec![ResourceDocument {
                path: "cpu.yaml".into(),
                document: serde_json::json!({"kind": "Dashboard"}),
            }],
            dry_run: false,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert!(v.get("source").is_none(), "source must no longer be sent");
        assert!(
            v.get("dryRun").is_none(),
            "dryRun should be omitted when false"
        );
    }

    #[test]
    fn apply_request_includes_dry_run_when_true() {
        let req = ApplyRequest {
            projects: vec![],
            documents: vec![],
            dry_run: true,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["dryRun"], true);
    }

    #[test]
    fn load_apply_manifest_reads_projects() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("everr.yaml"),
            "projects:\n  - default\n  - platform\n",
        )
        .unwrap();
        let projects = load_apply_manifest(dir.path()).unwrap();
        assert_eq!(
            projects,
            vec!["default".to_string(), "platform".to_string()]
        );
    }

    #[test]
    fn load_apply_manifest_allows_empty_projects() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("everr.yaml"), "projects: []\n").unwrap();
        assert_eq!(
            load_apply_manifest(dir.path()).unwrap(),
            Vec::<String>::new()
        );
    }

    #[test]
    fn load_apply_manifest_errors_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let err = load_apply_manifest(dir.path()).unwrap_err();
        assert!(err.to_string().contains("everr.yaml"), "got: {err}");
    }

    #[test]
    fn load_resource_documents_excludes_the_manifest() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("everr.yaml"), "projects: [default]\n").unwrap();
        fs::write(
            dir.path().join("cpu.yaml"),
            "kind: Dashboard\nmetadata:\n  name: cpu\nspec:\n  panels: {}\n  layouts: []\n",
        )
        .unwrap();
        let docs = load_resource_documents(dir.path()).unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].path, "cpu.yaml");
    }

    #[test]
    fn apply_request_serializes_projects() {
        let req = ApplyRequest {
            projects: vec!["default".into()],
            documents: vec![],
            dry_run: false,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["projects"], serde_json::json!(["default"]));
    }

    #[test]
    fn apply_summary_deserializes_per_kind_with_org() {
        let s: ApplySummary = serde_json::from_value(serde_json::json!({
            "dryRun": true,
            "results": [
                {"kind": "Dashboard", "created": ["a"], "updated": [], "deleted": ["b"]}
            ],
            "organization": {"id": "org-1", "name": "Acme"}
        }))
        .unwrap();
        assert!(s.dry_run);
        assert_eq!(s.results.len(), 1);
        assert_eq!(s.results[0].kind, "Dashboard");
        assert_eq!(s.results[0].created, vec!["a".to_string()]);
        assert_eq!(s.results[0].deleted, vec!["b".to_string()]);
        assert_eq!(s.organization.name, "Acme");
    }
}
