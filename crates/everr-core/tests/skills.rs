use std::fs;

use everr_core::skills::{
    SkillOperationOptions, SkillPathAction, SkillProvider, SkillScope, bundled_skills,
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
fn bundles_using_everr_skill_for_conversation_start() {
    let skills = bundled_skills().expect("list bundled skills");
    let using_everr = skills
        .iter()
        .find(|skill| skill.name == "using-everr")
        .expect("using-everr skill should be bundled");

    assert!(
        using_everr
            .description
            .contains("starting any conversation")
    );
}

#[test]
fn installs_using_everr_skill_with_must_use_triggers() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex],
        skill_names: vec!["using-everr".to_string()],
        all: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install using-everr skill");

    let content = fs::read_to_string(repo.path().join(".agents/skills/using-everr/SKILL.md"))
        .expect("read installed skill");
    assert!(content.contains("## Must-Use Skill Triggers"));
    assert!(content.contains("`everr-working-with-ci`"));
    assert!(content.contains("`everr-use-telemetry`"));
    assert!(content.contains("`everr-setup-telemetry`"));
}

#[test]
fn everr_use_telemetry_bounds_full_trace_queries_by_time() {
    let content = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("assets/skills/everr-use-telemetry/SKILL.md"),
    )
    .expect("read everr-use-telemetry skill");

    assert!(
        content.contains("WHERE Timestamp > now() - INTERVAL 1 HOUR\n  AND TraceId = '<trace-id>'")
    );
    assert!(content.contains("using the same recent window"));
}

#[test]
fn installs_skill_rule_subdirectories() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex],
        skill_names: vec!["everr-setup-telemetry".to_string()],
        all: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install telemetry setup skill");

    let rule_path = repo
        .path()
        .join(".agents/skills/everr-setup-telemetry/rules/nodejs.md");
    let content = fs::read_to_string(rule_path).expect("read installed rule");
    assert!(content.contains("# Node.js Instrumentation"));
    assert!(content.contains("telemetry-setup.ts"));

    let error_rule_path = repo
        .path()
        .join(".agents/skills/everr-setup-telemetry/rules/error-tracking.md");
    let error_content = fs::read_to_string(error_rule_path).expect("read installed error rule");
    assert!(error_content.contains("# Error Tracking"));
    assert!(error_content.contains("OpenTelemetry-native signals"));

    let rust_rule_path = repo
        .path()
        .join(".agents/skills/everr-setup-telemetry/rules/rust.md");
    let rust_content = fs::read_to_string(rust_rule_path).expect("read installed rust rule");
    assert!(rust_content.contains("# Rust Instrumentation"));
    assert!(rust_content.contains("telemetry_setup.rs"));
}

#[test]
fn nextjs_rule_documents_server_setup_without_browser_instrumentation() {
    let content = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("assets/skills/everr-setup-telemetry/rules/nextjs.md"),
    )
    .expect("read nextjs rule");

    assert!(content.contains("src/instrumentation.ts"));
    assert!(content.contains("process.env.NEXT_RUNTIME !== 'nodejs'"));
    assert!(content.contains("resourceFromAttributes"));
    assert!(content.contains("BatchLogRecordProcessor"));
    assert!(content.contains("PeriodicExportingMetricReader"));
    assert!(content.contains("uncaughtException"));
    assert!(content.contains("unhandledRejection"));
    assert!(content.contains("## Local Collector Configuration"));
    assert!(content.contains("## Production Configuration"));
    assert!(content.contains("OTEL_EXPORTER_OTLP_ENDPOINT=<otlp-url-from-status>"));
    assert!(content.contains("EVERR_INGEST_KEY=<secret-manager-reference>"));
    assert!(content.contains("process.env.EVERR_INGEST_KEY"));

    let lower_content = content.to_ascii_lowercase();
    assert!(!content.contains("OTEL_EXPORTER_OTLP_PROTOCOL="));
    assert!(!content.contains("OTEL_SERVICE_VERSION="));
    assert!(!content.contains("OTEL_DEPLOYMENT_ENVIRONMENT_NAME="));
    assert!(!content.contains("OTEL_TRACES_SAMPLER="));
    assert!(!content.contains("OTEL_TRACES_SAMPLER_ARG="));
    assert!(!content.contains("OTEL_EXPORTER_OTLP_HEADERS="));
    assert!(!content.contains("OTEL_EXPORTER_OTLP_${"));
    assert!(!content.contains("OTEL_SERVICE_VERSION"));
    assert!(!content.contains("OTEL_DEPLOYMENT_ENVIRONMENT_NAME"));
    assert!(!content.contains("NEXT_OTEL_VERBOSE"));
    assert!(!lower_content.contains("browser"));
    assert!(!lower_content.contains("client"));
    assert!(!lower_content.contains("next_public_"));
    assert!(!lower_content.contains("instrumentation-client"));
    assert!(!lower_content.contains("access-control-allow-headers"));
    assert!(!lower_content.contains("custom helpers"));
    assert!(!lower_content.contains("custom server helpers"));
    assert!(!lower_content.contains("otel-collector:4318"));
    assert!(!lower_content.contains("local compose stack"));
    assert!(!lower_content.contains("collector service name"));
}

#[test]
fn nodejs_rule_prefers_telemetry_setup_module_over_register_flags() {
    let content = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("assets/skills/everr-setup-telemetry/rules/nodejs.md"),
    )
    .expect("read nodejs rule");

    assert!(content.contains("telemetry-setup.ts"));
    assert!(content.contains("import './telemetry-setup'"));
    assert!(content.contains("@opentelemetry/sdk-node"));
    assert!(content.contains("@opentelemetry/auto-instrumentations-node"));
    assert!(content.contains("OTEL_SERVICE_NAME"));
    assert!(content.contains("EVERR_INGEST_KEY"));
    assert!(!content.contains("@opentelemetry/auto-instrumentations-node/register"));
    assert!(!content.contains("NODE_OPTIONS"));
}

#[test]
fn rust_rule_documents_tracing_based_setup_with_minimal_env() {
    let content = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("assets/skills/everr-setup-telemetry/rules/rust.md"),
    )
    .expect("read rust rule");

    assert!(content.contains("# Rust Instrumentation"));
    assert!(content.contains("telemetry_setup.rs"));
    assert!(content.contains("tracing-opentelemetry"));
    assert!(content.contains("opentelemetry-appender-tracing"));
    assert!(content.contains("opentelemetry_otlp::SpanExporter::builder()"));
    assert!(content.contains("OTEL_SERVICE_NAME"));
    assert!(content.contains("EVERR_INGEST_KEY"));
    assert!(!content.contains("OTEL_TRACES_EXPORTER="));
    assert!(!content.contains("OTEL_METRICS_EXPORTER="));
    assert!(!content.contains("OTEL_LOGS_EXPORTER="));
    assert!(!content.contains("OTEL_EXPORTER_OTLP_HEADERS="));
}

#[test]
fn install_adds_missing_rule_files() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let skill_dir = repo.path().join(".agents/skills/everr-setup-telemetry");
    fs::create_dir_all(&skill_dir).expect("create existing skill dir");
    let bundled_skill = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("assets/skills/everr-setup-telemetry/SKILL.md"),
    )
    .expect("read bundled skill");
    fs::write(skill_dir.join("SKILL.md"), bundled_skill).expect("write existing skill");

    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex],
        skill_names: vec!["everr-setup-telemetry".to_string()],
        all: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install missing rule files");

    assert!(skill_dir.join("rules/error-tracking.md").is_file());
}

#[test]
fn install_overwrites_modified_rule() {
    let repo = tempdir().expect("repo tempdir");
    let home = tempdir().expect("home tempdir");
    let skill_dir = repo.path().join(".agents/skills/everr-setup-telemetry");
    fs::create_dir_all(skill_dir.join("rules")).expect("create existing skill dir");
    let bundled_skill = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("assets/skills/everr-setup-telemetry/SKILL.md"),
    )
    .expect("read bundled skill");
    fs::write(skill_dir.join("SKILL.md"), bundled_skill).expect("write existing skill");
    fs::write(skill_dir.join("rules/error-tracking.md"), "local edits").expect("edit rule");

    let options = SkillOperationOptions {
        scope: SkillScope::Project,
        cwd: repo.path().to_path_buf(),
        home_dir: home.path().to_path_buf(),
        providers: vec![SkillProvider::Codex],
        skill_names: vec!["everr-setup-telemetry".to_string()],
        all: false,
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install should replace modified rule");

    let content =
        fs::read_to_string(skill_dir.join("rules/error-tracking.md")).expect("read replaced rule");
    assert!(content.contains("# Error Tracking"));
    assert!(!content.contains("local edits"));
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
fn uninstall_global_skills_removes_provider_symlinks() {
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
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install global skill");
    uninstall_bundled_skills(&options).expect("uninstall global skill");

    // Regression: provider symlinks point at the canonical agents dir, so an
    // uninstall that canonicalized paths skipped them and left dangling links.
    // The canonical content and every provider symlink must be gone.
    // `symlink_metadata` does not follow links, so a dangling symlink still
    // reports as existing here — exactly what we must not leave behind.
    for dir in [".agents", ".codex", ".claude", ".cursor"] {
        let path = home
            .path()
            .join(dir)
            .join("skills")
            .join("everr-use-telemetry");
        assert!(
            fs::symlink_metadata(&path).is_err(),
            "{} should not exist after uninstall",
            path.display()
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
fn install_overwrites_modified_skill() {
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
        dry_run: false,
    };

    install_bundled_skills(&options).expect("install should replace modified skill");

    let content = fs::read_to_string(canonical.join("SKILL.md")).expect("read updated skill");
    assert!(content.contains("name: everr-working-with-ci"));
    assert!(!content.contains("local edits"));
}

#[test]
#[cfg(unix)]
fn install_replaces_existing_provider_symlink() {
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
fn install_removes_dangling_provider_symlink() {
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
