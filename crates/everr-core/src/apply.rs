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
#[serde(deny_unknown_fields)]
struct ApplyManifest {
    repoid: String,
}

/// Read the required manifest at the apply root and return its `repoid`
/// (the stable repository identifier and apply ownership boundary).
/// `everr.yaml` is the canonical name; `everr.yml` is also accepted.
/// Both are excluded from resource loading so they are never parsed as documents.
pub fn load_apply_manifest(dir: &Path) -> Result<String> {
    let path = if dir.join("everr.yaml").is_file() {
        dir.join("everr.yaml")
    } else if dir.join("everr.yml").is_file() {
        dir.join("everr.yml")
    } else {
        anyhow::bail!(
            "no everr.yaml found in {} — create one with the stable repository id, e.g.\nrepoid: \"2f8e3f90-9d1c-5d5f-a0f9-2d8e7f4a25d1\"",
            dir.display()
        );
    };
    let name = path
        .file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy();
    let contents =
        std::fs::read_to_string(&path).with_context(|| format!("{name}: failed to read file"))?;
    let manifest: ApplyManifest = serde_yaml::from_str(&contents)
        .with_context(|| format!("{name}: failed to parse (it must contain only `repoid`)"))?;
    let repoid = manifest.repoid.trim();
    if repoid.is_empty() {
        anyhow::bail!("{name}: repoid must be a non-empty string");
    }
    Ok(repoid.to_string())
}

/// One resource entry on the wire: `{ "path": ..., "resource": ... }`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceEntry {
    pub path: String,
    pub resource: Value,
}

impl From<ResourceDocument> for ResourceEntry {
    fn from(d: ResourceDocument) -> Self {
        ResourceEntry {
            path: d.path,
            resource: d.document,
        }
    }
}

/// The complete desired state for one repo, grouped by resource kind.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct ApplyState {
    pub dashboards: Vec<ResourceEntry>,
    pub alerts: Vec<ResourceEntry>,
}

/// classify_documents output before wire conversion (keeps ResourceDocument
/// equality for tests).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ApplyStateDocs {
    pub dashboards: Vec<ResourceDocument>,
    pub alerts: Vec<ResourceDocument>,
}

impl ApplyStateDocs {
    pub fn into_wire(self) -> ApplyState {
        ApplyState {
            dashboards: self.dashboards.into_iter().map(Into::into).collect(),
            alerts: self.alerts.into_iter().map(Into::into).collect(),
        }
    }
}

/// Split discovered documents by `kind`. Unknown kinds (including
/// `AlertSettings`, which is web-UI-only state) are a hard CLI-side error.
/// Keep the kinds in sync with the server reconciler REGISTRY in
/// packages/app/src/data/as-code/registry.ts.
pub fn classify_documents(docs: Vec<ResourceDocument>) -> Result<ApplyStateDocs> {
    let mut dashboards = Vec::new();
    let mut alerts = Vec::new();
    for doc in docs {
        match doc.document.get("kind").and_then(|k| k.as_str()) {
            Some("Dashboard") => dashboards.push(doc),
            Some("AlertRule") => alerts.push(doc),
            Some(other) => anyhow::bail!(
                "{}: unsupported kind \"{other}\" (supported: Dashboard, AlertRule)",
                doc.path
            ),
            None => anyhow::bail!("{}: document is missing a string \"kind\"", doc.path),
        }
    }
    Ok(ApplyStateDocs { dashboards, alerts })
}

/// Git-derived source metadata, best-effort: any git failure yields None.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplySource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<String>,
}

fn git_output(dir: &Path, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

pub fn detect_git_source(dir: &Path) -> Option<ApplySource> {
    let branch = git_output(dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let commit_sha = git_output(dir, &["rev-parse", "HEAD"]);
    let remote = git_output(dir, &["remote", "get-url", "origin"]);
    if branch.is_none() && commit_sha.is_none() && remote.is_none() {
        return None;
    }
    Some(ApplySource {
        branch,
        commit_sha,
        remote,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyRequest {
    pub repoid: String,
    pub state: ApplyState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<ApplySource>,
    #[serde(rename = "dryRun")]
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

    fn write(dir: &std::path::Path, name: &str, contents: &str) {
        fs::write(dir.join(name), contents).unwrap();
    }

    #[test]
    fn manifest_returns_repoid() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "everr.yaml", "repoid: \" abc-123 \"\n");
        assert_eq!(load_apply_manifest(dir.path()).unwrap(), "abc-123");
    }

    #[test]
    fn manifest_accepts_everr_yml() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "everr.yml", "repoid: \"abc\"\n");
        assert_eq!(load_apply_manifest(dir.path()).unwrap(), "abc");
    }

    #[test]
    fn manifest_prefers_everr_yaml_over_everr_yml() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "everr.yaml", "repoid: \"canonical\"\n");
        write(dir.path(), "everr.yml", "repoid: \"legacy\"\n");
        assert_eq!(load_apply_manifest(dir.path()).unwrap(), "canonical");
    }

    #[test]
    fn manifest_rejects_empty_repoid_and_extra_keys() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "everr.yaml", "repoid: \"\"\n");
        assert!(load_apply_manifest(dir.path()).is_err());
        write(dir.path(), "everr.yaml", "repoid: \"x\"\nprojects: [a]\n");
        assert!(load_apply_manifest(dir.path()).is_err());
    }

    #[test]
    fn manifest_missing_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_apply_manifest(dir.path()).is_err());
    }

    #[test]
    fn load_resource_documents_excludes_the_manifest() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "everr.yaml", "repoid: abc\n");
        write(dir.path(), "everr.yml", "repoid: legacy\n");
        write(
            dir.path(),
            "cpu.yaml",
            "kind: Dashboard\nmetadata:\n  name: cpu\nspec:\n  panels: {}\n  layouts: []\n",
        );
        let docs = load_resource_documents(dir.path()).unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].path, "cpu.yaml");
    }

    #[test]
    fn classify_splits_dashboards_and_alerts_and_rejects_unknown_kinds() {
        let dash = ResourceDocument {
            path: "d.yaml".into(),
            document: serde_json::json!({"kind": "Dashboard"}),
        };
        let alert = ResourceDocument {
            path: "a.yaml".into(),
            document: serde_json::json!({"kind": "AlertRule"}),
        };
        let state = classify_documents(vec![dash.clone(), alert.clone()]).unwrap();
        assert_eq!(state.dashboards, vec![dash]);
        assert_eq!(state.alerts, vec![alert]);

        let settings = ResourceDocument {
            path: "s.yaml".into(),
            document: serde_json::json!({"kind": "AlertSettings"}),
        };
        let err = classify_documents(vec![settings]).unwrap_err().to_string();
        assert!(err.contains("AlertSettings"), "got: {err}");
    }

    #[test]
    fn apply_request_serializes_repo_scoped_state() {
        let req = ApplyRequest {
            repoid: "repo-1".into(),
            state: ApplyState {
                dashboards: vec![ResourceEntry {
                    path: "cpu.yaml".into(),
                    resource: serde_json::json!({"kind": "Dashboard"}),
                }],
                alerts: vec![ResourceEntry {
                    path: "alerts/error-rate.yaml".into(),
                    resource: serde_json::json!({"kind": "AlertRule"}),
                }],
            },
            source: Some(ApplySource {
                branch: Some("main".into()),
                commit_sha: Some("abc".into()),
                remote: Some("git@example.com:acme/repo.git".into()),
            }),
            dry_run: false,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["repoid"], "repo-1");
        assert_eq!(v["dryRun"], false);
        assert_eq!(v["state"]["dashboards"][0]["path"], "cpu.yaml");
        assert_eq!(
            v["state"]["dashboards"][0]["resource"],
            serde_json::json!({"kind": "Dashboard"})
        );
        assert_eq!(v["state"]["alerts"][0]["path"], "alerts/error-rate.yaml");
        assert_eq!(v["source"]["commitSha"], "abc");
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
