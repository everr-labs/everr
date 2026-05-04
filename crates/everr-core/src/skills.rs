use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use include_dir::{Dir, DirEntry, include_dir};
use serde::Serialize;

static BUNDLED_SKILLS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/assets/skills");

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillProvider {
    Codex,
    ClaudeCode,
    Cursor,
}

impl SkillProvider {
    pub const ALL: [Self; 3] = [Self::Codex, Self::ClaudeCode, Self::Cursor];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claude-code",
            Self::Cursor => "cursor",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::ClaudeCode => "Claude Code",
            Self::Cursor => "Cursor",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SkillScope {
    Project,
    Global,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstallMode {
    Symlink,
    Copy,
}

#[derive(Clone, Debug)]
pub struct SkillOperationOptions {
    pub scope: SkillScope,
    pub cwd: PathBuf,
    pub home_dir: PathBuf,
    pub providers: Vec<SkillProvider>,
    pub skill_names: Vec<String>,
    pub all: bool,
    pub mode: InstallMode,
    pub force: bool,
    pub dry_run: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillPathAction {
    WouldWrite,
    Written,
    Unchanged,
    WouldRemove,
    Removed,
    Missing,
    WouldLink,
    Linked,
    WouldCopy,
    Copied,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SkillPathChange {
    pub skill: String,
    pub provider: Option<SkillProvider>,
    pub path: String,
    pub canonical_path: Option<String>,
    pub action: SkillPathAction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SkillOperationSummary {
    pub skills: Vec<String>,
    pub changes: Vec<SkillPathChange>,
    pub dry_run: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct BundledSkill {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SkillProviderStatus {
    pub provider: SkillProvider,
    pub detected: bool,
    pub path: String,
}

pub fn bundled_skills() -> Result<Vec<BundledSkill>> {
    let mut skills = Vec::new();
    for entry in BUNDLED_SKILLS.entries() {
        let DirEntry::Dir(dir) = entry else {
            continue;
        };
        let skill = bundled_skill_from_dir(dir)?;
        skills.push(skill);
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

pub fn provider_statuses(home_dir: &Path) -> Vec<SkillProviderStatus> {
    SkillProvider::ALL
        .into_iter()
        .map(|provider| {
            let root = match provider {
                SkillProvider::Codex => home_dir.join(".codex"),
                SkillProvider::ClaudeCode => home_dir.join(".claude"),
                SkillProvider::Cursor => home_dir.join(".cursor"),
            };
            let detected = root.exists()
                || (provider == SkillProvider::Codex && Path::new("/etc/codex").exists());
            SkillProviderStatus {
                provider,
                detected,
                path: global_provider_skills_dir(home_dir, provider)
                    .display()
                    .to_string(),
            }
        })
        .collect()
}

pub fn install_bundled_skills(options: &SkillOperationOptions) -> Result<SkillOperationSummary> {
    let skills = resolve_skill_dirs(options)?;
    let providers = normalize_providers(&options.providers);
    let mut changes = Vec::new();

    for (skill_name, dir) in &skills {
        let canonical_dir = canonical_skill_dir(options, skill_name);
        let canonical_changed = sync_bundled_skill_dir(
            dir,
            &canonical_dir,
            options.force,
            options.dry_run,
            skill_name,
            &mut changes,
        )?;

        for provider in &providers {
            let provider_dir = provider_skill_dir(options, *provider, skill_name);
            if same_path(&provider_dir, &canonical_dir) {
                continue;
            }

            match options.mode {
                InstallMode::Symlink => {
                    link_provider_dir(
                        *provider,
                        skill_name,
                        &canonical_dir,
                        &provider_dir,
                        options.force,
                        options.dry_run,
                        &mut changes,
                    )?;
                }
                InstallMode::Copy => {
                    let before = changes.len();
                    sync_bundled_skill_dir(
                        dir,
                        &provider_dir,
                        options.force,
                        options.dry_run,
                        skill_name,
                        &mut changes,
                    )?;
                    for change in &mut changes[before..] {
                        change.provider = Some(*provider);
                        change.canonical_path = Some(canonical_dir.display().to_string());
                        change.action = match change.action {
                            SkillPathAction::Written => SkillPathAction::Copied,
                            SkillPathAction::WouldWrite => SkillPathAction::WouldCopy,
                            ref other => other.clone(),
                        };
                    }
                }
            }
        }

        if canonical_changed {
            continue;
        }
    }

    Ok(SkillOperationSummary {
        skills: skills.keys().cloned().collect(),
        changes,
        dry_run: options.dry_run,
    })
}

pub fn update_bundled_skills(options: &SkillOperationOptions) -> Result<SkillOperationSummary> {
    let mut options = options.clone();
    options.force = true;
    if !options.all && options.skill_names.is_empty() {
        options.skill_names = installed_bundled_skill_names(&options)?;
    }
    install_bundled_skills(&options)
}

pub fn uninstall_bundled_skills(options: &SkillOperationOptions) -> Result<SkillOperationSummary> {
    let skills = resolve_skill_names(options)?;
    let providers = normalize_providers(&options.providers);
    let mut changes = Vec::new();

    for skill_name in &skills {
        let canonical_dir = canonical_skill_dir(options, skill_name);
        for provider in &providers {
            let provider_dir = provider_skill_dir(options, *provider, skill_name);
            if same_path(&provider_dir, &canonical_dir) {
                continue;
            }
            remove_path(
                skill_name,
                Some(*provider),
                &provider_dir,
                Some(&canonical_dir),
                options.dry_run,
                &mut changes,
            )?;
        }
        remove_path(
            skill_name,
            None,
            &canonical_dir,
            None,
            options.dry_run,
            &mut changes,
        )?;
    }

    Ok(SkillOperationSummary {
        skills,
        changes,
        dry_run: options.dry_run,
    })
}

fn bundled_skill_from_dir(dir: &Dir<'_>) -> Result<BundledSkill> {
    let skill_doc_path = dir.path().join("SKILL.md");
    let readme = dir
        .get_file(&skill_doc_path)
        .ok_or_else(|| anyhow!("bundled skill {} is missing SKILL.md", dir.path().display()))?;
    let content = readme
        .contents_utf8()
        .ok_or_else(|| anyhow!("{} is not valid UTF-8", readme.path().display()))?;
    let (name, description) = parse_skill_frontmatter(content)
        .with_context(|| format!("parse {}", readme.path().display()))?;
    let dir_name = dir
        .path()
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("invalid bundled skill directory {}", dir.path().display()))?;
    if name != dir_name {
        bail!("bundled skill directory {dir_name} has frontmatter name {name}");
    }
    Ok(BundledSkill { name, description })
}

fn parse_skill_frontmatter(content: &str) -> Result<(String, String)> {
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        bail!("missing frontmatter");
    }

    let mut fields = BTreeMap::new();
    for line in lines.by_ref() {
        if line.trim() == "---" {
            let name = fields
                .remove("name")
                .ok_or_else(|| anyhow!("missing frontmatter field: name"))?;
            let description = fields
                .remove("description")
                .ok_or_else(|| anyhow!("missing frontmatter field: description"))?;
            return Ok((name, description));
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        fields.insert(key.trim().to_string(), value.trim().to_string());
    }

    bail!("unterminated frontmatter")
}

fn resolve_skill_dirs(
    options: &SkillOperationOptions,
) -> Result<BTreeMap<String, &'static Dir<'static>>> {
    let requested = resolve_skill_names(options)?;
    let mut dirs = BTreeMap::new();
    for name in requested {
        let dir = BUNDLED_SKILLS
            .get_dir(&name)
            .ok_or_else(|| anyhow!("unknown skill {name:?}"))?;
        dirs.insert(name, dir);
    }
    Ok(dirs)
}

fn resolve_skill_names(options: &SkillOperationOptions) -> Result<Vec<String>> {
    let available: BTreeSet<String> = bundled_skills()?.into_iter().map(|s| s.name).collect();
    let names: Vec<String> = if options.all {
        available.iter().cloned().collect()
    } else {
        options
            .skill_names
            .iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect()
    };

    if names.is_empty() {
        bail!("provide at least one skill name or use --all");
    }

    let mut deduped = BTreeSet::new();
    for name in names {
        validate_skill_name(&name)?;
        if !available.contains(&name) {
            bail!("unknown skill {name:?}");
        }
        deduped.insert(name);
    }

    Ok(deduped.into_iter().collect())
}

fn installed_bundled_skill_names(options: &SkillOperationOptions) -> Result<Vec<String>> {
    let available = bundled_skills()?;
    let mut installed = Vec::new();
    for skill in available {
        if canonical_skill_dir(options, &skill.name)
            .join("SKILL.md")
            .is_file()
        {
            installed.push(skill.name);
        }
    }
    Ok(installed)
}

fn validate_skill_name(name: &str) -> Result<()> {
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        bail!("invalid skill name {name:?}");
    }
    Ok(())
}

fn normalize_providers(providers: &[SkillProvider]) -> Vec<SkillProvider> {
    let set: BTreeSet<SkillProvider> = if providers.is_empty() {
        SkillProvider::ALL.into_iter().collect()
    } else {
        providers.iter().copied().collect()
    };
    set.iter().copied().collect()
}

fn canonical_skill_dir(options: &SkillOperationOptions, skill_name: &str) -> PathBuf {
    canonical_skills_dir(options).join(skill_name)
}

fn canonical_skills_dir(options: &SkillOperationOptions) -> PathBuf {
    match options.scope {
        SkillScope::Project => options.cwd.join(".agents").join("skills"),
        SkillScope::Global => options.home_dir.join(".agents").join("skills"),
    }
}

fn provider_skill_dir(
    options: &SkillOperationOptions,
    provider: SkillProvider,
    skill_name: &str,
) -> PathBuf {
    provider_skills_dir(options, provider).join(skill_name)
}

fn provider_skills_dir(options: &SkillOperationOptions, provider: SkillProvider) -> PathBuf {
    match options.scope {
        SkillScope::Project => match provider {
            SkillProvider::Codex | SkillProvider::Cursor => canonical_skills_dir(options),
            SkillProvider::ClaudeCode => options.cwd.join(".claude").join("skills"),
        },
        SkillScope::Global => global_provider_skills_dir(&options.home_dir, provider),
    }
}

fn global_provider_skills_dir(home_dir: &Path, provider: SkillProvider) -> PathBuf {
    match provider {
        SkillProvider::Codex => home_dir.join(".codex").join("skills"),
        SkillProvider::ClaudeCode => home_dir.join(".claude").join("skills"),
        SkillProvider::Cursor => home_dir.join(".cursor").join("skills"),
    }
}

fn sync_bundled_skill_dir(
    dir: &Dir<'_>,
    target: &Path,
    force: bool,
    dry_run: bool,
    skill_name: &str,
    changes: &mut Vec<SkillPathChange>,
) -> Result<bool> {
    match existing_dir_state(dir, target)? {
        ExistingDirState::Missing => {
            if !dry_run {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("create {}", parent.display()))?;
                }
                write_bundled_dir(dir, target)?;
            }
            changes.push(SkillPathChange {
                skill: skill_name.to_string(),
                provider: None,
                path: target.display().to_string(),
                canonical_path: None,
                action: if dry_run {
                    SkillPathAction::WouldWrite
                } else {
                    SkillPathAction::Written
                },
            });
            Ok(true)
        }
        ExistingDirState::Same => {
            changes.push(SkillPathChange {
                skill: skill_name.to_string(),
                provider: None,
                path: target.display().to_string(),
                canonical_path: None,
                action: SkillPathAction::Unchanged,
            });
            Ok(false)
        }
        ExistingDirState::Different => {
            if !force {
                bail!(
                    "destination differs: {} (use --force to overwrite)",
                    target.display()
                );
            }
            if !dry_run {
                remove_any(target)?;
                write_bundled_dir(dir, target)?;
            }
            changes.push(SkillPathChange {
                skill: skill_name.to_string(),
                provider: None,
                path: target.display().to_string(),
                canonical_path: None,
                action: if dry_run {
                    SkillPathAction::WouldWrite
                } else {
                    SkillPathAction::Written
                },
            });
            Ok(true)
        }
    }
}

enum ExistingDirState {
    Missing,
    Same,
    Different,
}

fn existing_dir_state(dir: &Dir<'_>, target: &Path) -> Result<ExistingDirState> {
    let Ok(metadata) = fs::symlink_metadata(target) else {
        return Ok(ExistingDirState::Missing);
    };
    if !metadata.is_dir() {
        return Ok(ExistingDirState::Different);
    }

    let expected = bundled_file_map(dir)?;
    let actual = file_map(target)?;
    if expected == actual {
        Ok(ExistingDirState::Same)
    } else {
        Ok(ExistingDirState::Different)
    }
}

fn bundled_file_map(dir: &Dir<'_>) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut files = BTreeMap::new();
    collect_bundled_files(dir, Path::new(""), &mut files)?;
    Ok(files)
}

fn collect_bundled_files(
    dir: &Dir<'_>,
    relative_base: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    for entry in dir.entries() {
        match entry {
            DirEntry::Dir(child) => {
                let child_base = relative_base.join(child.path().file_name().unwrap());
                collect_bundled_files(child, &child_base, files)?;
            }
            DirEntry::File(file) => {
                let relative = relative_base.join(file.path().file_name().unwrap());
                files.insert(
                    relative.to_string_lossy().replace('\\', "/"),
                    file.contents().to_vec(),
                );
            }
        }
    }
    Ok(())
}

fn file_map(root: &Path) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut files = BTreeMap::new();
    collect_files(root, root, &mut files)?;
    Ok(files)
}

fn collect_files(root: &Path, current: &Path, files: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
    for entry in fs::read_dir(current).with_context(|| format!("read {}", current.display()))? {
        let entry = entry?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.is_dir() {
            collect_files(root, &path, files)?;
            continue;
        }
        if metadata.file_type().is_symlink() {
            continue;
        }
        let relative = path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/");
        files.insert(relative, fs::read(&path)?);
    }
    Ok(())
}

fn write_bundled_dir(dir: &Dir<'_>, target: &Path) -> Result<()> {
    fs::create_dir_all(target).with_context(|| format!("create {}", target.display()))?;
    for entry in dir.entries() {
        match entry {
            DirEntry::Dir(child) => {
                write_bundled_dir(child, &target.join(child.path().file_name().unwrap()))?;
            }
            DirEntry::File(file) => {
                let path = target.join(file.path().file_name().unwrap());
                fs::write(&path, file.contents())
                    .with_context(|| format!("write {}", path.display()))?;
            }
        }
    }
    Ok(())
}

fn link_provider_dir(
    provider: SkillProvider,
    skill_name: &str,
    canonical_dir: &Path,
    provider_dir: &Path,
    force: bool,
    dry_run: bool,
    changes: &mut Vec<SkillPathChange>,
) -> Result<()> {
    if provider_link_points_to(provider_dir, canonical_dir)? {
        changes.push(SkillPathChange {
            skill: skill_name.to_string(),
            provider: Some(provider),
            path: provider_dir.display().to_string(),
            canonical_path: Some(canonical_dir.display().to_string()),
            action: SkillPathAction::Unchanged,
        });
        return Ok(());
    }

    if provider_dir.exists() || fs::symlink_metadata(provider_dir).is_ok() {
        if !force {
            bail!(
                "destination differs: {} (use --force to overwrite or --copy to avoid symlinks)",
                provider_dir.display()
            );
        }
        if !dry_run {
            remove_any(provider_dir)?;
        }
    }

    if !dry_run {
        let parent = provider_dir
            .parent()
            .ok_or_else(|| anyhow!("{} has no parent", provider_dir.display()))?;
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
        create_dir_symlink(canonical_dir, provider_dir).with_context(|| {
            format!(
                "create symlink {} -> {} (rerun with --copy if symlinks are unavailable)",
                provider_dir.display(),
                canonical_dir.display()
            )
        })?;
    }
    changes.push(SkillPathChange {
        skill: skill_name.to_string(),
        provider: Some(provider),
        path: provider_dir.display().to_string(),
        canonical_path: Some(canonical_dir.display().to_string()),
        action: if dry_run {
            SkillPathAction::WouldLink
        } else {
            SkillPathAction::Linked
        },
    });
    Ok(())
}

fn provider_link_points_to(provider_dir: &Path, canonical_dir: &Path) -> Result<bool> {
    let Ok(metadata) = fs::symlink_metadata(provider_dir) else {
        return Ok(false);
    };
    if !metadata.file_type().is_symlink() {
        return Ok(false);
    }
    let link = fs::read_link(provider_dir)?;
    let resolved = if link.is_absolute() {
        link
    } else {
        provider_dir
            .parent()
            .ok_or_else(|| anyhow!("{} has no parent", provider_dir.display()))?
            .join(link)
    };
    Ok(resolved.canonicalize().ok() == canonical_dir.canonicalize().ok())
}

#[cfg(unix)]
fn create_dir_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(relative_symlink_target(target, link), link)
}

#[cfg(windows)]
fn create_dir_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(relative_symlink_target(target, link), link)
}

fn relative_symlink_target(target: &Path, link: &Path) -> PathBuf {
    let Some(parent) = link.parent() else {
        return target.to_path_buf();
    };
    pathdiff::diff_paths(target, parent).unwrap_or_else(|| target.to_path_buf())
}

fn remove_path(
    skill_name: &str,
    provider: Option<SkillProvider>,
    path: &Path,
    canonical_path: Option<&Path>,
    dry_run: bool,
    changes: &mut Vec<SkillPathChange>,
) -> Result<()> {
    if fs::symlink_metadata(path).is_err() {
        changes.push(SkillPathChange {
            skill: skill_name.to_string(),
            provider,
            path: path.display().to_string(),
            canonical_path: canonical_path.map(|p| p.display().to_string()),
            action: SkillPathAction::Missing,
        });
        return Ok(());
    }
    if !dry_run {
        remove_any(path)?;
    }
    changes.push(SkillPathChange {
        skill: skill_name.to_string(),
        provider,
        path: path.display().to_string(),
        canonical_path: canonical_path.map(|p| p.display().to_string()),
        action: if dry_run {
            SkillPathAction::WouldRemove
        } else {
            SkillPathAction::Removed
        },
    });
    Ok(())
}

fn remove_any(path: &Path) -> Result<()> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("read {}", path.display()))?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).with_context(|| format!("remove {}", path.display()))?;
    } else {
        fs::remove_file(path).with_context(|| format!("remove {}", path.display()))?;
    }
    Ok(())
}

fn same_path(a: &Path, b: &Path) -> bool {
    a == b || (a.canonicalize().ok().is_some() && a.canonicalize().ok() == b.canonicalize().ok())
}
