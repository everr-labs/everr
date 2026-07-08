use std::fs;
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
        let mut document =
            parse_document(path, &contents).with_context(|| format!("{rel}: failed to parse"))?;
        inline_runbook_markdown(dir, &rel, &mut document)?;
        out.push(ResourceDocument {
            path: rel,
            document,
        });
    }
    Ok(out)
}

/// `Notebook` is the legacy alias for `Runbook` (ADR 0002); both kinds are
/// accepted in config and treated identically.
fn is_runbook_kind(kind: Option<&str>) -> bool {
    matches!(kind, Some("Runbook") | Some("Notebook"))
}

/// Resolve `markdown: { file: ... }` pointers in a Runbook document to
/// `markdown: { inline: ... }`, reading files relative to the document's own
/// location under the apply root. The server only accepts the inline form, so
/// this is the authoring convenience that keeps `.md` files first-class on
/// disk. Non-Runbook documents are untouched.
fn inline_runbook_markdown(root: &Path, doc_rel_path: &str, document: &mut Value) -> Result<()> {
    if !is_runbook_kind(document.get("kind").and_then(Value::as_str)) {
        return Ok(());
    }
    let doc_dir = Path::new(doc_rel_path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    // Canonicalize the apply root once per runbook; every page's markdown file
    // is checked against this same trust boundary, so there's no need to redo
    // the syscall per page.
    let canonical_root = root
        .canonicalize()
        .with_context(|| format!("failed to resolve apply directory {}", root.display()))?;
    if let Some(spec) = document.get_mut("spec") {
        inline_markdown_node(root, &canonical_root, &doc_dir, doc_rel_path, spec)?;
    }
    Ok(())
}

/// Walk one node carrying an optional `markdown` and optional recursive
/// `pages`, inlining as we go (the spec root and every page share this shape).
fn inline_markdown_node(
    root: &Path,
    canonical_root: &Path,
    doc_dir: &Path,
    doc_path: &str,
    node: &mut Value,
) -> Result<()> {
    if let Some(markdown) = node.get_mut("markdown") {
        inline_markdown_source(root, canonical_root, doc_dir, doc_path, markdown)?;
    }
    if let Some(pages) = node.get_mut("pages").and_then(Value::as_array_mut) {
        for page in pages {
            inline_markdown_node(root, canonical_root, doc_dir, doc_path, page)?;
        }
    }
    Ok(())
}

fn inline_markdown_source(
    root: &Path,
    canonical_root: &Path,
    doc_dir: &Path,
    doc_path: &str,
    markdown: &mut Value,
) -> Result<()> {
    let Some(file) = markdown.get("file").and_then(Value::as_str) else {
        return Ok(());
    };
    let resolved = root.join(doc_dir).join(file);
    // Canonicalize to keep reads inside the apply tree: the desired-state dir
    // is the trust boundary; a `../../` pointer silently uploading arbitrary
    // files would be surprising.
    let canonical = resolved
        .canonicalize()
        .with_context(|| format!("{doc_path}: failed to read markdown file {file}"))?;
    if !canonical.starts_with(canonical_root) {
        anyhow::bail!("{doc_path}: markdown file {file} is outside the apply directory");
    }
    let contents = fs::read_to_string(&canonical)
        .with_context(|| format!("{doc_path}: failed to read markdown file {file}"))?;
    // Keep the original `file:` path alongside the inlined contents so the
    // webapp viewer can resolve relative markdown links between pages back to
    // their authored source files.
    *markdown = serde_json::json!({ "inline": contents, "file": file });
    Ok(())
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct ApplyManifest {
    repoid: String,
}

/// Read the optional manifest at the apply root and return its `repoid`
/// (the stable repository identifier and apply ownership boundary), or None
/// when no manifest exists. `everr.yaml` is the canonical name; `everr.yml`
/// is also accepted. Both are excluded from resource loading so they are
/// never parsed as documents.
pub fn load_apply_manifest(dir: &Path) -> Result<Option<String>> {
    let path = if dir.join("everr.yaml").is_file() {
        dir.join("everr.yaml")
    } else if dir.join("everr.yml").is_file() {
        dir.join("everr.yml")
    } else {
        return Ok(None);
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
    Ok(Some(repoid.to_string()))
}

/// Resolve the repoid (ownership and prune boundary) for an apply. An
/// `everr.yaml` manifest always wins when present; otherwise the identity is
/// inferred from `remote` (the already-detected `origin` remote, see
/// `detect_git_source`) as the normalized `host/owner/repo` slug. The
/// manifest stays as the escape hatch for local-only repositories and
/// non-git directories, and as an explicit pin against remote renames.
pub fn resolve_repoid(dir: &Path, remote: Option<&str>) -> Result<String> {
    if let Some(repoid) = load_apply_manifest(dir)? {
        return Ok(repoid);
    }
    if let Some(slug) = remote.and_then(crate::git::normalize_remote_slug) {
        return Ok(slug);
    }
    anyhow::bail!(
        "cannot determine the repository identity of {}: no `origin` git remote to infer it from and no everr.yaml manifest.\nEither add an `origin` remote, or create everr.yaml with a stable repository id, e.g.\nrepoid: \"2f8e3f90-9d1c-5d5f-a0f9-2d8e7f4a25d1\"",
        dir.display()
    )
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
    pub runbooks: Vec<ResourceEntry>,
    pub alerts: Vec<ResourceEntry>,
}

/// classify_documents output before wire conversion (keeps ResourceDocument
/// equality for tests).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ApplyStateDocs {
    pub dashboards: Vec<ResourceDocument>,
    pub runbooks: Vec<ResourceDocument>,
    pub alerts: Vec<ResourceDocument>,
}

impl ApplyStateDocs {
    pub fn into_wire(self) -> ApplyState {
        ApplyState {
            dashboards: self.dashboards.into_iter().map(Into::into).collect(),
            runbooks: self.runbooks.into_iter().map(Into::into).collect(),
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
    let mut runbooks = Vec::new();
    let mut alerts = Vec::new();
    for doc in docs {
        match doc.document.get("kind").and_then(|k| k.as_str()) {
            Some("Dashboard") => dashboards.push(doc),
            // `Notebook` is the legacy alias for `Runbook` (ADR 0002).
            Some("Runbook") | Some("Notebook") => runbooks.push(doc),
            Some("AlertRule") => alerts.push(doc),
            Some(other) => anyhow::bail!(
                "{}: unsupported kind \"{other}\" (supported: Dashboard, Runbook, AlertRule)",
                doc.path
            ),
            None => anyhow::bail!("{}: document is missing a string \"kind\"", doc.path),
        }
    }
    Ok(ApplyStateDocs {
        dashboards,
        runbooks,
        alerts,
    })
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

/// The `origin` remote URL of `dir`, when set. Cheaper than
/// `detect_git_source` for callers that only need the remote (one git
/// invocation instead of three).
pub fn origin_remote(dir: &Path) -> Option<String> {
    git_output(dir, &["remote", "get-url", "origin"])
}

pub fn detect_git_source(dir: &Path) -> Option<ApplySource> {
    let branch = git_output(dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let commit_sha = git_output(dir, &["rev-parse", "HEAD"]);
    let remote = origin_remote(dir);
    if branch.is_none() && commit_sha.is_none() && remote.is_none() {
        return None;
    }
    Some(ApplySource {
        branch,
        commit_sha,
        remote,
    })
}

/// Resolve the preview name for `--preview [NAME]`: an explicit non-empty
/// NAME wins; otherwise the current branch. Detached HEAD and non-git
/// directories are errors — pass an explicit name there (e.g. in CI).
pub fn resolve_preview_name(dir: &Path, flag: &str) -> Result<String> {
    let explicit = flag.trim();
    if !explicit.is_empty() {
        return Ok(explicit.to_string());
    }
    // `symbolic-ref` (rather than `rev-parse --abbrev-ref`) also resolves on
    // an unborn branch (a freshly-initialized repo with no commits yet),
    // where `rev-parse HEAD` has no object to resolve.
    match git_output(dir, &["symbolic-ref", "--short", "-q", "HEAD"]) {
        Some(branch) => Ok(branch),
        None if git_output(dir, &["rev-parse", "HEAD"]).is_some() => {
            anyhow::bail!("HEAD is detached; pass an explicit preview name: --preview <name>")
        }
        None => anyhow::bail!(
            "{} is not a git repository; pass an explicit preview name: --preview <name>",
            dir.display()
        ),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyRequest {
    pub repoid: String,
    pub state: ApplyState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<ApplySource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(rename = "dryRun")]
    pub dry_run: bool,
    /// Take over live resources owned by another repo instead of failing on the
    /// cross-repo ownership conflict.
    pub adopt: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct KindResult {
    pub kind: String,
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub deleted: Vec<String>,
    /// Live resources taken over from another owning repo (only with `--adopt`).
    #[serde(default)]
    pub adopted: Vec<String>,
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
        assert_eq!(load_apply_manifest(dir.path()).unwrap().unwrap(), "abc-123");
    }

    #[test]
    fn manifest_accepts_everr_yml() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "everr.yml", "repoid: \"abc\"\n");
        assert_eq!(load_apply_manifest(dir.path()).unwrap().unwrap(), "abc");
    }

    #[test]
    fn manifest_prefers_everr_yaml_over_everr_yml() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "everr.yaml", "repoid: \"canonical\"\n");
        write(dir.path(), "everr.yml", "repoid: \"legacy\"\n");
        assert_eq!(
            load_apply_manifest(dir.path()).unwrap().unwrap(),
            "canonical"
        );
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
    fn manifest_missing_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_apply_manifest(dir.path()).unwrap(), None);
    }

    #[test]
    fn resolve_repoid_prefers_manifest_over_remote() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "everr.yaml", "repoid: \"pinned\"\n");
        assert_eq!(
            resolve_repoid(dir.path(), Some("git@github.com:acme/api.git")).unwrap(),
            "pinned"
        );
    }

    #[test]
    fn resolve_repoid_infers_slug_without_manifest() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve_repoid(dir.path(), Some("git@github.com:Acme/API.git")).unwrap(),
            "github.com/acme/api"
        );
    }

    #[test]
    fn resolve_repoid_errors_without_manifest_or_remote() {
        let dir = tempfile::tempdir().unwrap();
        let err = resolve_repoid(dir.path(), None).unwrap_err().to_string();
        assert!(err.contains("everr.yaml"), "error was: {err}");
        assert!(err.contains("origin"), "error was: {err}");
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
    fn classify_splits_dashboards_runbooks_and_alerts_and_rejects_unknown_kinds() {
        let dash = ResourceDocument {
            path: "d.yaml".into(),
            document: serde_json::json!({"kind": "Dashboard"}),
        };
        let runbook = ResourceDocument {
            path: "n.yaml".into(),
            document: serde_json::json!({"kind": "Runbook"}),
        };
        let alert = ResourceDocument {
            path: "a.yaml".into(),
            document: serde_json::json!({"kind": "AlertRule"}),
        };
        let state = classify_documents(vec![dash.clone(), runbook.clone(), alert.clone()]).unwrap();
        assert_eq!(state.dashboards, vec![dash]);
        assert_eq!(state.runbooks, vec![runbook]);
        assert_eq!(state.alerts, vec![alert]);

        let settings = ResourceDocument {
            path: "s.yaml".into(),
            document: serde_json::json!({"kind": "AlertSettings"}),
        };
        let err = classify_documents(vec![settings]).unwrap_err().to_string();
        assert!(err.contains("AlertSettings"), "got: {err}");
    }

    #[test]
    fn classify_accepts_runbook_and_notebook_alias() {
        let runbook = ResourceDocument {
            path: "a.yaml".into(),
            document: serde_json::json!({"kind": "Runbook"}),
        };
        let legacy = ResourceDocument {
            path: "b.yaml".into(),
            document: serde_json::json!({"kind": "Notebook"}),
        };
        let state = classify_documents(vec![runbook.clone(), legacy.clone()]).unwrap();
        assert_eq!(state.runbooks, vec![runbook, legacy]);
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
                runbooks: vec![ResourceEntry {
                    path: "runbooks/triage.yaml".into(),
                    resource: serde_json::json!({"kind": "Runbook"}),
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
            preview: None,
            dry_run: false,
            adopt: false,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["repoid"], "repo-1");
        assert_eq!(v["dryRun"], false);
        assert_eq!(v["adopt"], false);
        assert_eq!(v["state"]["dashboards"][0]["path"], "cpu.yaml");
        assert_eq!(
            v["state"]["dashboards"][0]["resource"],
            serde_json::json!({"kind": "Dashboard"})
        );
        assert_eq!(v["state"]["runbooks"][0]["path"], "runbooks/triage.yaml");
        assert_eq!(v["state"]["alerts"][0]["path"], "alerts/error-rate.yaml");
        assert_eq!(v["source"]["commitSha"], "abc");
    }

    #[test]
    fn apply_request_serializes_preview_only_when_set() {
        let mut req = ApplyRequest {
            repoid: "repo-1".into(),
            state: ApplyState::default(),
            source: None,
            preview: None,
            dry_run: true,
            adopt: false,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert!(v.get("preview").is_none());
        req.preview = Some("gio/x".into());
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["preview"], "gio/x");
    }

    #[test]
    fn resolve_preview_name_prefers_explicit_name() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve_preview_name(dir.path(), " gio/x ").unwrap(),
            "gio/x"
        );
    }

    #[test]
    fn resolve_preview_name_errors_outside_git_without_a_name() {
        let dir = tempfile::tempdir().unwrap();
        let err = resolve_preview_name(dir.path(), "").unwrap_err();
        assert!(err.to_string().contains("--preview"), "got: {err}");
    }

    #[test]
    fn resolve_preview_name_uses_the_current_branch() {
        let dir = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            assert!(
                std::process::Command::new("git")
                    .arg("-C")
                    .arg(dir.path())
                    .args(args)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        };
        git(&["init", "-q", "-b", "gio/preview-test"]);
        assert_eq!(
            resolve_preview_name(dir.path(), "").unwrap(),
            "gio/preview-test"
        );
    }

    #[test]
    fn inlines_runbook_markdown_files_recursively() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("runbooks/triage")).unwrap();
        fs::write(dir.path().join("runbooks/index.md"), "# Index\n").unwrap();
        fs::write(dir.path().join("runbooks/triage/net.md"), "# Net\n").unwrap();
        fs::write(
            dir.path().join("runbooks/rb.yaml"),
            concat!(
                "kind: Runbook\n",
                "metadata:\n  name: rb\n",
                "spec:\n",
                "  markdown:\n    file: ./index.md\n",
                "  pages:\n",
                "    - name: triage\n",
                "      markdown:\n        inline: already inline\n",
                "      pages:\n",
                "        - name: net\n",
                "          markdown:\n            file: ./triage/net.md\n",
            ),
        )
        .unwrap();

        let docs = load_resource_documents(dir.path()).unwrap();

        assert_eq!(docs.len(), 1);
        let spec = &docs[0].document["spec"];
        assert_eq!(
            spec["markdown"],
            serde_json::json!({"inline": "# Index\n", "file": "./index.md"})
        );
        assert_eq!(
            spec["pages"][0]["markdown"],
            serde_json::json!({"inline": "already inline"})
        );
        assert_eq!(
            spec["pages"][0]["pages"][0]["markdown"],
            serde_json::json!({"inline": "# Net\n", "file": "./triage/net.md"})
        );
    }

    #[test]
    fn runbook_markdown_missing_file_errors_with_both_paths() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("rb.yaml"),
            "kind: Notebook\nmetadata:\n  name: rb\nspec:\n  markdown:\n    file: ./missing.md\n",
        )
        .unwrap();
        let err = load_resource_documents(dir.path()).unwrap_err();
        let msg = format!("{err:#}");
        assert!(msg.contains("rb.yaml"), "error was: {msg}");
        assert!(msg.contains("missing.md"), "error was: {msg}");
    }

    #[test]
    fn runbook_markdown_outside_apply_dir_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "secret").unwrap();
        fs::write(
            dir.path().join("rb.yaml"),
            format!(
                "kind: Notebook\nmetadata:\n  name: rb\nspec:\n  markdown:\n    file: {}\n",
                outside.path().join("secret.md").display()
            ),
        )
        .unwrap();
        let err = load_resource_documents(dir.path()).unwrap_err();
        assert!(format!("{err:#}").contains("outside"), "error was: {err:#}");
    }

    #[test]
    fn non_runbook_documents_are_untouched_by_inlining() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("d.yaml"),
            "kind: Dashboard\nmetadata:\n  name: d\nspec:\n  panels: {}\n  layouts: []\n  markdown:\n    file: ./nope.md\n",
        )
        .unwrap();
        // A Dashboard with a stray markdown key must not trigger file resolution.
        let docs = load_resource_documents(dir.path()).unwrap();
        assert_eq!(docs[0].document["spec"]["markdown"]["file"], "./nope.md");
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
