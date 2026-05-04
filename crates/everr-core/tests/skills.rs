use std::fs;

use everr_core::skills::{
    InstallMode, SkillOperationOptions, SkillPathAction, SkillProvider, SkillScope,
    install_bundled_skills, uninstall_bundled_skills, update_bundled_skills,
};
use tempfile::tempdir;

#[cfg(unix)]
fn assert_symlink_to(path: &std::path::Path, target: &std::path::Path) {
    let metadata = fs::symlink_metadata(path).expect("read symlink metadata");
    assert!(
        metadata.file_type().is_symlink(),
        "{} should be a symlink",
        path.display()
    );
    let link = fs::read_link(path).expect("read symlink target");
    let resolved = path.parent().expect("symlink parent").join(link);
    assert_eq!(
        resolved.canonicalize().expect("canonicalize link target"),
        target.canonicalize().expect("canonicalize target")
    );
}

#[test]
fn installs_project_skills_to_canonical_agents_dir_and_symlinks_claude() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![
            SkillProvider::Codex,
            SkillProvider::ClaudeCode,
            SkillProvider::Cursor,
        ],
        skill_names: vec!["ci-debugging".to_string()],
        all: false,
        mode: InstallMode::Symlink,
        force: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install project skill");

    let canonical = repo.path().join(".agents/skills/ci-debugging");
    assert!(canonical.join("SKILL.md").is_file());
    assert!(
        repo.path()
            .join(".agents/skills/ci-debugging/SKILL.md")
            .is_file()
    );
    assert!(!repo.path().join(".codex/skills/ci-debugging").exists());
    assert!(!repo.path().join(".cursor/skills/ci-debugging").exists());
    #[cfg(unix)]
    assert_symlink_to(&repo.path().join(".claude/skills/ci-debugging"), &canonical);
}

#[test]
fn installs_global_skills_to_agents_dir_and_symlinks_providers() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![
            SkillProvider::Codex,
            SkillProvider::ClaudeCode,
            SkillProvider::Cursor,
        ],
        skill_names: vec!["local-debugging".to_string()],
        all: false,
        mode: InstallMode::Symlink,
        force: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install global skill");

    let canonical = home.path().join(".agents/skills/local-debugging");
    assert!(canonical.join("SKILL.md").is_file());
    #[cfg(unix)]
    {
        assert_symlink_to(
            &home.path().join(".codex/skills/local-debugging"),
            &canonical,
        );
        assert_symlink_to(
            &home.path().join(".claude/skills/local-debugging"),
            &canonical,
        );
        assert_symlink_to(
            &home.path().join(".cursor/skills/local-debugging"),
            &canonical,
        );
    }
}

#[test]
fn dry_run_reports_changes_without_writing_files() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex],
        skill_names: vec!["ci-debugging".to_string()],
        all: false,
        mode: InstallMode::Symlink,
        force: false,
        dry_run: true,
    };

    let summary = install_bundled_skills(&options).expect("dry-run install");

    assert!(summary.dry_run);
    assert!(
        summary
            .changes
            .iter()
            .any(|change| change.action == SkillPathAction::WouldWrite)
    );
    assert!(
        summary
            .changes
            .iter()
            .any(|change| change.action == SkillPathAction::WouldLink)
    );
    assert!(!home.path().join(".agents/skills/ci-debugging").exists());
    assert!(!home.path().join(".codex/skills/ci-debugging").exists());
}

#[test]
fn update_rewrites_modified_installed_skill() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex],
        skill_names: vec!["ci-debugging".to_string()],
        all: false,
        mode: InstallMode::Symlink,
        force: false,
        dry_run: false,
    };
    install_bundled_skills(&options).expect("install skill");
    let skill_doc = repo.path().join(".agents/skills/ci-debugging/SKILL.md");
    fs::write(&skill_doc, "local edits").expect("edit skill");

    let update_options = SkillOperationOptions {
        skill_names: Vec::new(),
        ..options
    };
    update_bundled_skills(&update_options).expect("update skill");

    let content = fs::read_to_string(skill_doc).expect("read updated skill");
    assert!(content.contains("name: ci-debugging"));
    assert!(!content.contains("local edits"));
}

#[test]
fn copy_mode_writes_provider_copy_but_keeps_canonical_copy() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::ClaudeCode],
        skill_names: vec!["local-telemetry-setup".to_string()],
        all: false,
        mode: InstallMode::Copy,
        force: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install copied skill");

    let canonical = repo.path().join(".agents/skills/local-telemetry-setup");
    let claude = repo.path().join(".claude/skills/local-telemetry-setup");
    assert!(canonical.join("SKILL.md").is_file());
    assert!(claude.join("SKILL.md").is_file());
    assert!(
        !fs::symlink_metadata(&claude)
            .expect("read claude skill metadata")
            .file_type()
            .is_symlink()
    );
}

#[test]
fn install_refuses_to_overwrite_modified_skill_without_force() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let canonical = repo.path().join(".agents/skills/ci-debugging");
    fs::create_dir_all(&canonical).expect("create existing skill");
    fs::write(canonical.join("SKILL.md"), "local edits").expect("write local edits");

    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex],
        skill_names: vec!["ci-debugging".to_string()],
        all: false,
        mode: InstallMode::Symlink,
        force: false,
        dry_run: false,
    };

    let error = install_bundled_skills(&options).expect_err("conflict should fail");
    assert!(error.to_string().contains("--force"));
}

#[test]
#[cfg(unix)]
fn force_replaces_existing_provider_symlink() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let wrong_target = tempdir().expect("wrong target tempdir");
    let provider_link = home.path().join(".claude/skills/ci-debugging");
    fs::create_dir_all(provider_link.parent().expect("provider parent")).expect("create parent");
    std::os::unix::fs::symlink(wrong_target.path(), &provider_link).expect("create wrong link");

    let options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::ClaudeCode],
        skill_names: vec!["ci-debugging".to_string()],
        all: false,
        mode: InstallMode::Symlink,
        force: true,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("replace provider symlink");

    assert_symlink_to(
        &provider_link,
        &home.path().join(".agents/skills/ci-debugging"),
    );
}

#[test]
#[cfg(unix)]
fn force_removes_dangling_provider_symlink() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let provider_link = home.path().join(".cursor/skills/local-debugging");
    fs::create_dir_all(provider_link.parent().expect("provider parent")).expect("create parent");
    std::os::unix::fs::symlink(home.path().join("missing-target"), &provider_link)
        .expect("create dangling link");

    let options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Cursor],
        skill_names: vec!["local-debugging".to_string()],
        all: false,
        mode: InstallMode::Symlink,
        force: true,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("replace dangling provider symlink");

    assert_symlink_to(
        &provider_link,
        &home.path().join(".agents/skills/local-debugging"),
    );
}

#[test]
fn uninstall_removes_canonical_and_provider_links() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex, SkillProvider::ClaudeCode],
        skill_names: vec!["ci-debugging".to_string()],
        all: false,
        mode: InstallMode::Symlink,
        force: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install skill");
    uninstall_bundled_skills(&options).expect("uninstall skill");

    assert!(!home.path().join(".agents/skills/ci-debugging").exists());
    assert!(!home.path().join(".codex/skills/ci-debugging").exists());
    assert!(!home.path().join(".claude/skills/ci-debugging").exists());
}
