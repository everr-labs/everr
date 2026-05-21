use std::fs;

use everr_core::skills::{
    SkillOperationOptions, SkillPathAction, SkillProvider, SkillScope, install_bundled_skills,
    uninstall_bundled_skills, update_bundled_skills,
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
        skill_names: vec!["everr-working-with-ci".to_string()],
        all: false,
        force: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install project skill");

    let canonical = repo.path().join(".agents/skills/everr-working-with-ci");
    assert!(canonical.join("SKILL.md").is_file());
    assert!(
        repo.path()
            .join(".agents/skills/everr-working-with-ci/SKILL.md")
            .is_file()
    );
    assert!(
        !repo
            .path()
            .join(".codex/skills/everr-working-with-ci")
            .exists()
    );
    assert!(
        !repo
            .path()
            .join(".cursor/skills/everr-working-with-ci")
            .exists()
    );
    #[cfg(unix)]
    assert_symlink_to(
        &repo.path().join(".claude/skills/everr-working-with-ci"),
        &canonical,
    );
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
        skill_names: vec!["everr-use-telemetry".to_string()],
        all: false,
        force: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install global skill");

    let canonical = home.path().join(".agents/skills/everr-use-telemetry");
    assert!(canonical.join("SKILL.md").is_file());
    #[cfg(unix)]
    {
        assert_symlink_to(
            &home.path().join(".codex/skills/everr-use-telemetry"),
            &canonical,
        );
        assert_symlink_to(
            &home.path().join(".claude/skills/everr-use-telemetry"),
            &canonical,
        );
        assert_symlink_to(
            &home.path().join(".cursor/skills/everr-use-telemetry"),
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
        skill_names: vec!["everr-working-with-ci".to_string()],
        all: false,
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
    assert!(
        !home
            .path()
            .join(".agents/skills/everr-working-with-ci")
            .exists()
    );
    assert!(
        !home
            .path()
            .join(".codex/skills/everr-working-with-ci")
            .exists()
    );
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
        skill_names: vec!["everr-working-with-ci".to_string()],
        all: false,
        force: false,
        dry_run: false,
    };
    install_bundled_skills(&options).expect("install skill");
    let skill_doc = repo
        .path()
        .join(".agents/skills/everr-working-with-ci/SKILL.md");
    fs::write(&skill_doc, "local edits").expect("edit skill");

    let update_options = SkillOperationOptions {
        skill_names: Vec::new(),
        ..options
    };
    update_bundled_skills(&update_options).expect("update skill");

    let content = fs::read_to_string(skill_doc).expect("read updated skill");
    assert!(content.contains("name: everr-working-with-ci"));
    assert!(!content.contains("local edits"));
}

#[test]
fn update_replaces_installed_legacy_skill_with_new_skill() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let legacy_canonical = repo.path().join(".agents/skills/everr-ci-debugging");
    fs::create_dir_all(&legacy_canonical).expect("create legacy skill");
    fs::write(
        legacy_canonical.join("SKILL.md"),
        "name: everr-ci-debugging",
    )
    .expect("write legacy skill");

    #[cfg(unix)]
    {
        let legacy_provider = repo.path().join(".claude/skills/everr-ci-debugging");
        fs::create_dir_all(legacy_provider.parent().expect("provider parent"))
            .expect("create provider parent");
        std::os::unix::fs::symlink(&legacy_canonical, &legacy_provider)
            .expect("create legacy provider symlink");
    }

    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::ClaudeCode],
        skill_names: Vec::new(),
        all: false,
        force: false,
        dry_run: false,
    };

    let summary = update_bundled_skills(&options).expect("update legacy skill");

    assert_eq!(summary.skills, vec!["everr-working-with-ci"]);
    assert!(!legacy_canonical.exists());
    let new_canonical = repo.path().join(".agents/skills/everr-working-with-ci");
    assert!(new_canonical.join("SKILL.md").is_file());
    let content = fs::read_to_string(new_canonical.join("SKILL.md")).expect("read new skill");
    assert!(content.contains("name: everr-working-with-ci"));
    #[cfg(unix)]
    {
        assert!(
            !repo
                .path()
                .join(".claude/skills/everr-ci-debugging")
                .exists()
        );
        assert_symlink_to(
            &repo.path().join(".claude/skills/everr-working-with-ci"),
            &new_canonical,
        );
    }
}

#[test]
fn install_refuses_to_overwrite_modified_skill_without_force() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let canonical = repo.path().join(".agents/skills/everr-working-with-ci");
    fs::create_dir_all(&canonical).expect("create existing skill");
    fs::write(canonical.join("SKILL.md"), "local edits").expect("write local edits");

    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex],
        skill_names: vec!["everr-working-with-ci".to_string()],
        all: false,
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
    let provider_link = home.path().join(".claude/skills/everr-working-with-ci");
    fs::create_dir_all(provider_link.parent().expect("provider parent")).expect("create parent");
    std::os::unix::fs::symlink(wrong_target.path(), &provider_link).expect("create wrong link");

    let options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::ClaudeCode],
        skill_names: vec!["everr-working-with-ci".to_string()],
        all: false,
        force: true,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("replace provider symlink");

    assert_symlink_to(
        &provider_link,
        &home.path().join(".agents/skills/everr-working-with-ci"),
    );
}

#[test]
#[cfg(unix)]
fn force_removes_dangling_provider_symlink() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let provider_link = home.path().join(".cursor/skills/everr-use-telemetry");
    fs::create_dir_all(provider_link.parent().expect("provider parent")).expect("create parent");
    std::os::unix::fs::symlink(home.path().join("missing-target"), &provider_link)
        .expect("create dangling link");

    let options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Cursor],
        skill_names: vec!["everr-use-telemetry".to_string()],
        all: false,
        force: true,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("replace dangling provider symlink");

    assert_symlink_to(
        &provider_link,
        &home.path().join(".agents/skills/everr-use-telemetry"),
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
        skill_names: vec!["everr-working-with-ci".to_string()],
        all: false,
        force: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install skill");
    uninstall_bundled_skills(&options).expect("uninstall skill");

    assert!(
        !home
            .path()
            .join(".agents/skills/everr-working-with-ci")
            .exists()
    );
    assert!(
        !home
            .path()
            .join(".codex/skills/everr-working-with-ci")
            .exists()
    );
    assert!(
        !home
            .path()
            .join(".claude/skills/everr-working-with-ci")
            .exists()
    );
}
