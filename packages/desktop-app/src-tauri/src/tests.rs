use everr_core::api::{
    AlertNotifyPayload, DesktopNotification, FailedJobInfo, FailureNotification,
};
use everr_core::state::{AppSettings, WizardState};
use tempfile::tempdir;

use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::cli::sync_installed_cli_from_paths;
use crate::notifications::{
    active_notification_auto_fix_prompt, alert_desktop_notification_from_payload,
    reset_notifier_runtime_state,
};
#[cfg(target_os = "macos")]
use crate::notifications::{
    notification_hover_uses_native_panel_geometry, notification_window_uses_native_panel,
};
use crate::settings::build_wizard_status_response;
use crate::startup::sync_installed_global_skills_from_paths;
use crate::{
    current_app_name, current_base_url, current_state_store, should_check_for_updates,
    NotificationQueue, APP_NAME, DEV_APP_NAME,
};

fn failure(dedupe_key: &str) -> FailureNotification {
    FailureNotification {
        dedupe_key: dedupe_key.to_string(),
        trace_id: format!("trace-{dedupe_key}"),
        repo: "everr-labs/everr".to_string(),
        branch: "main".to_string(),
        workflow_name: "CI".to_string(),
        failed_at: "2026-03-07T10:00:00Z".to_string(),
        details_url: format!("https://example.com/{dedupe_key}"),
        failed_jobs: vec![FailedJobInfo {
            job_name: "test".to_string(),
            step_number: "2".to_string(),
            step_name: Some("Run suite".to_string()),
        }],
    }
}

fn workflow(dedupe_key: &str) -> DesktopNotification {
    DesktopNotification::Workflow(failure(dedupe_key))
}

fn notification_dedupe_key(notification: &DesktopNotification) -> &str {
    match notification {
        DesktopNotification::Workflow(failure) => &failure.dedupe_key,
        DesktopNotification::Alert(alert) => &alert.dedupe_key,
    }
}

fn alert_payload(severity: &str, status: &str) -> AlertNotifyPayload {
    AlertNotifyPayload {
        kind: "alert".to_string(),
        tenant_id: "org1".to_string(),
        recipient_user_ids: vec!["user1".to_string()],
        alert_definition_id: 10,
        alert_event_id: 20,
        service: "api".to_string(),
        name: "high-5xx-routes".to_string(),
        severity: severity.to_string(),
        status: status.to_string(),
        summary: "2 routes have elevated 5xxs".to_string(),
        description: Some("Top route: /api".to_string()),
        occurred_at: "2026-06-06T10:00:00Z".to_string(),
        source_url: "https://github.com/acme/repo/blob/main/alerts.yaml".to_string(),
        row_count: 2,
    }
}

fn alert_notification() -> DesktopNotification {
    alert_desktop_notification_from_payload(&alert_payload("critical", "firing"))
        .expect("critical firing alert should become a popup notification")
}

#[test]
fn enqueue_first_item_sets_active_notification() {
    let mut queue = NotificationQueue::default();

    assert!(queue.enqueue(workflow("one")));
    assert_eq!(queue.active().map(notification_dedupe_key), Some("one"));
    assert!(queue.pending.is_empty());
}

#[test]
fn enqueue_additional_items_queues_without_replacing_active() {
    let mut queue = NotificationQueue::default();

    assert!(queue.enqueue(workflow("one")));
    assert!(!queue.enqueue(workflow("two")));

    assert_eq!(queue.active().map(notification_dedupe_key), Some("one"));
    assert_eq!(queue.pending.len(), 1);
}

#[test]
fn advance_promotes_next_notification() {
    let mut queue = NotificationQueue::default();
    queue.enqueue(workflow("one"));
    queue.enqueue(workflow("two"));

    assert!(queue.advance());
    assert_eq!(queue.active().map(notification_dedupe_key), Some("two"));
    assert!(queue.pending.is_empty());
}

#[test]
fn advance_clears_active_when_queue_is_exhausted() {
    let mut queue = NotificationQueue::default();
    queue.enqueue(workflow("one"));

    assert!(queue.advance());
    assert!(queue.active().is_none());
    assert!(queue.pending.is_empty());
}

#[test]
fn advance_is_noop_when_queue_is_empty() {
    let mut queue = NotificationQueue::default();

    assert!(!queue.advance());
    assert!(queue.active().is_none());
    assert!(queue.pending.is_empty());
}

#[test]
fn notification_prompt_builder_formats_single_failure_with_exact_logs_command() {
    let prompt = build_notification_auto_fix_prompt(&failure("one"));

    assert!(prompt.contains("Investigate and fix this CI pipeline failure."));
    assert!(prompt.contains("Failure details:"));
    assert!(prompt.contains("workflow CI | trace trace-one | failing steps: test #2 (Run suite)"));
    assert!(prompt.contains("everr ci logs trace-one --job-name \"test\" --step-number 2"));
    assert!(prompt.contains("Step 2"));
    assert!(prompt.contains("Step 3"));
}

#[test]
fn notification_prompt_lists_all_failed_jobs() {
    let notification = FailureNotification {
        dedupe_key: "multi".to_string(),
        trace_id: "trace-multi".to_string(),
        repo: "everr-labs/everr".to_string(),
        branch: "main".to_string(),
        workflow_name: "CI".to_string(),
        failed_at: "2026-03-07T10:00:00Z".to_string(),
        details_url: "https://example.com/multi".to_string(),
        failed_jobs: vec![
            FailedJobInfo {
                job_name: "test".to_string(),
                step_number: "3".to_string(),
                step_name: Some("Run suite".to_string()),
            },
            FailedJobInfo {
                job_name: "lint".to_string(),
                step_number: "2".to_string(),
                step_name: Some("Biome check".to_string()),
            },
        ],
    };

    let prompt = build_notification_auto_fix_prompt(&notification);

    assert!(
        prompt.contains("failing steps: test #3 (Run suite), lint #2 (Biome check)"),
        "prompt should list all failed jobs, got: {prompt}"
    );
    assert!(
        prompt.contains("everr ci logs trace-multi --job-name \"test\" --step-number 3"),
        "prompt should include logs command for first job"
    );
    assert!(
        prompt.contains("everr ci logs trace-multi --job-name \"lint\" --step-number 2"),
        "prompt should include logs command for second job"
    );
}

#[test]
fn current_session_store_uses_current_build_session_file_name() {
    let store = current_state_store();

    assert_eq!(store.namespace(), everr_core::build::session_namespace());
    assert_eq!(
        store.session_file_name(),
        everr_core::build::default_session_file_name()
    );
}

#[test]
fn current_app_name_matches_the_build_mode() {
    assert_eq!(
        current_app_name(),
        if tauri::is_dev() {
            DEV_APP_NAME
        } else {
            APP_NAME
        }
    );
}

#[test]
fn startup_update_checks_are_disabled_in_dev_only() {
    assert_eq!(should_check_for_updates(), !tauri::is_dev());
}

#[cfg(target_os = "macos")]
#[test]
fn notification_window_uses_native_panel_on_macos() {
    assert!(notification_window_uses_native_panel());
}

#[cfg(target_os = "macos")]
#[test]
fn notification_hover_uses_native_panel_geometry_on_macos() {
    assert!(notification_hover_uses_native_panel_geometry());
}

#[test]
fn wizard_status_response_uses_completion_flag() {
    let response = build_wizard_status_response(WizardState {
        wizard_completed: true,
    });

    assert!(response.wizard_completed);
}

#[test]
fn complete_setup_helper_marks_all_required_wizard_flags() {
    let mut settings = AppSettings::default();

    settings.mark_setup_complete(current_base_url());

    assert!(settings.wizard_state.wizard_completed);
    assert_eq!(
        settings.completed_base_url.as_deref(),
        Some(current_base_url())
    );
}

#[test]
fn active_notification_prompt_prefers_the_active_queue_item() {
    let mut queue = NotificationQueue::default();
    let active = DesktopNotification::Workflow(failure("one"));
    queue.enqueue(active.clone());

    assert_eq!(
        active_notification_auto_fix_prompt(&queue),
        match active {
            DesktopNotification::Workflow(ref failure) => {
                Some(build_notification_auto_fix_prompt(failure))
            }
            DesktopNotification::Alert(_) => None,
        }
    );
}

#[test]
fn active_notification_prompt_ignores_alert_notifications() {
    let mut queue = NotificationQueue::default();
    queue.enqueue(alert_notification());

    assert_eq!(active_notification_auto_fix_prompt(&queue), None);
}

#[test]
fn critical_firing_alert_payload_builds_desktop_notification() {
    let notification =
        alert_desktop_notification_from_payload(&alert_payload("critical", "firing"))
            .expect("critical firing alert should become a popup notification");

    let DesktopNotification::Alert(alert) = notification else {
        panic!("expected alert desktop notification");
    };

    assert_eq!(alert.dedupe_key, "alert:10:20");
    assert_eq!(
        alert.details_url,
        "https://github.com/acme/repo/blob/main/alerts.yaml"
    );
    assert_eq!(alert.row_count, 2);
}

#[test]
fn non_critical_or_non_firing_alert_payloads_do_not_open_popups() {
    assert!(alert_desktop_notification_from_payload(&alert_payload("warning", "firing")).is_none());
    assert!(
        alert_desktop_notification_from_payload(&alert_payload("critical", "resolved")).is_none()
    );
}

#[test]
fn resetting_notifier_runtime_state_clears_queue_and_dedupe_tracker() {
    let mut notifier = crate::NotifierState::default();
    let first = failure("one");

    assert_eq!(notifier.tracker.retain_new(vec![first.clone()]).len(), 1);
    assert!(notifier.tracker.retain_new(vec![first.clone()]).is_empty());

    notifier
        .queue
        .enqueue(DesktopNotification::Workflow(first.clone()));
    notifier
        .queue
        .enqueue(DesktopNotification::Workflow(failure("two")));

    reset_notifier_runtime_state(&mut notifier);

    assert!(notifier.queue.active().is_none());
    assert!(notifier.queue.pending.is_empty());
    assert_eq!(notifier.tracker.retain_new(vec![first]).len(), 1);
}

#[test]
fn mismatched_completed_base_url_reopens_the_wizard() {
    let mut settings = AppSettings {
        completed_base_url: Some("https://app.everr.dev".to_string()),
        wizard_state: WizardState {
            wizard_completed: true,
        },
        ..AppSettings::default()
    };

    settings.apply_runtime_base_url(current_base_url());
    assert!(!settings.wizard_state.wizard_completed);
}

#[test]
fn sync_installed_cli_installs_missing_binary() {
    let temp = tempdir().expect("tempdir");
    let bundled = temp.path().join("bundled-everr");
    let installed = temp.path().join("installed-everr");

    std::fs::write(&bundled, b"bundled").expect("write bundled cli");

    assert!(sync_installed_cli_from_paths(&bundled, &installed).expect("sync cli install"));
    assert_eq!(
        std::fs::read(&installed).expect("read installed cli"),
        b"bundled"
    );
}

#[test]
fn sync_installed_cli_returns_false_when_hashes_match() {
    let temp = tempdir().expect("tempdir");
    let bundled = temp.path().join("bundled-everr");
    let installed = temp.path().join("installed-everr");

    std::fs::write(&bundled, b"same").expect("write bundled cli");
    std::fs::write(&installed, b"same").expect("write installed cli");

    assert!(!sync_installed_cli_from_paths(&bundled, &installed).expect("sync cli install"));
    assert_eq!(
        std::fs::read(&installed).expect("read installed cli"),
        b"same"
    );
}

#[test]
fn sync_installed_cli_replaces_outdated_binary() {
    let temp = tempdir().expect("tempdir");
    let bundled = temp.path().join("bundled-everr");
    let installed = temp.path().join("installed-everr");

    std::fs::write(&bundled, b"new-cli").expect("write bundled cli");
    std::fs::write(&installed, b"old-cli").expect("write installed cli");

    assert!(sync_installed_cli_from_paths(&bundled, &installed).expect("sync cli install"));
    assert_eq!(
        std::fs::read(&installed).expect("read installed cli"),
        b"new-cli"
    );
}

#[test]
fn startup_skill_sync_removes_stale_global_rule_files() {
    let temp = tempdir().expect("tempdir");
    let home = temp.path().join("home");
    let cwd = temp.path().join("cwd");
    std::fs::create_dir_all(&home).expect("create home");
    std::fs::create_dir_all(&cwd).expect("create cwd");

    let options = everr_core::skills::SkillOperationOptions {
        scope: everr_core::skills::SkillScope::Global,
        cwd: cwd.clone(),
        home_dir: home.clone(),
        providers: vec![everr_core::skills::SkillProvider::Codex],
        skill_names: vec!["everr-setup-telemetry".to_string()],
        all: false,
        dry_run: false,
    };
    everr_core::skills::install_bundled_skills(&options).expect("install bundled skill");

    let skill_dir = home.join(".agents/skills/everr-setup-telemetry");
    let stale_rule = skill_dir.join("rules/obsolete.md");
    std::fs::write(&stale_rule, "obsolete").expect("write stale rule");

    assert!(
        sync_installed_global_skills_from_paths(&home, &cwd).expect("sync installed skills"),
        "sync should report a change"
    );

    assert!(!stale_rule.exists());
    assert!(skill_dir.join("rules/nodejs.md").is_file());
}
