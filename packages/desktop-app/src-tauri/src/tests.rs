use everr_core::api::FailureNotification;
use everr_core::assistant::{AssistantKind, AssistantStatus};
use everr_core::state::{AppSettings, WizardState};
use tempfile::tempdir;

use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::cli::sync_installed_cli_from_paths;
use crate::notifications::active_notification_auto_fix_prompt;
use crate::settings::{build_assistant_setup_response, build_wizard_status_response};
use crate::tray::{
    build_tray_failed_runs_url, build_tray_menu_model, build_tray_snapshot, format_tray_title,
    format_tray_tooltip, tray_auto_fix_prompt, tray_failed_runs_target,
};
use crate::{
    current_app_name, current_base_url, current_state_store, should_check_for_updates,
    NotificationQueue, TraySnapshot, TrayState, APP_NAME, DEV_APP_NAME,
    TRAY_FAILURES_WINDOW_MINUTES,
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
        job_name: Some("test".to_string()),
        step_number: Some("2".to_string()),
        step_name: Some("Run suite".to_string()),
    }
}

#[test]
fn enqueue_first_item_sets_active_notification() {
    let mut queue = NotificationQueue::default();

    assert!(queue.enqueue(failure("one")));
    assert_eq!(
        queue
            .active()
            .map(|notification| notification.dedupe_key.as_str()),
        Some("one")
    );
    assert!(queue.pending.is_empty());
}

#[test]
fn enqueue_additional_items_queues_without_replacing_active() {
    let mut queue = NotificationQueue::default();

    assert!(queue.enqueue(failure("one")));
    assert!(!queue.enqueue(failure("two")));

    assert_eq!(
        queue
            .active()
            .map(|notification| notification.dedupe_key.as_str()),
        Some("one")
    );
    assert_eq!(queue.pending.len(), 1);
}

fn tray_snapshot_with_failures() -> TraySnapshot {
    let failures = vec![failure("one"), failure("two")];
    build_tray_snapshot(&failures, Some("everr-labs/everr"), Some("main"))
}

#[test]
fn advance_promotes_next_notification() {
    let mut queue = NotificationQueue::default();
    queue.enqueue(failure("one"));
    queue.enqueue(failure("two"));

    assert!(queue.advance());
    assert_eq!(
        queue
            .active()
            .map(|notification| notification.dedupe_key.as_str()),
        Some("two")
    );
    assert!(queue.pending.is_empty());
}

#[test]
fn advance_clears_active_when_queue_is_exhausted() {
    let mut queue = NotificationQueue::default();
    queue.enqueue(failure("one"));

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
fn tray_title_and_tooltip_include_failed_count_only() {
    let snapshot = tray_snapshot_with_failures();

    assert_eq!(format_tray_title(&snapshot), "F2");
    assert_eq!(
        format_tray_tooltip(&snapshot),
        format!("{} | Recent failed pipelines (5m): 2", current_app_name())
    );
    assert_eq!(format_tray_title(&TraySnapshot::default()), "");
}

#[test]
fn tray_snapshot_builds_recent_failures_dashboard_url_for_current_scope() {
    let snapshot = tray_snapshot_with_failures();
    let expected = format!(
        "{}/runs?conclusion=failure&from=now-5m&to=now&repo=everr-labs%2Feverr&branch=main",
        current_base_url().trim_end_matches('/')
    );

    assert_eq!(snapshot.dashboard_url.as_deref(), Some(expected.as_str()));
    assert_eq!(
        build_tray_failed_runs_url(Some("everr-labs/everr"), Some("main")).as_deref(),
        snapshot.dashboard_url.as_deref()
    );
    assert_eq!(TRAY_FAILURES_WINDOW_MINUTES, 5);
}

#[test]
fn notification_prompt_builder_formats_single_failure_with_exact_logs_command() {
    let prompt = build_notification_auto_fix_prompt(&failure("one"));

    assert!(prompt.contains("Investigate and fix this unresolved CI pipeline failure."));
    assert!(prompt.contains("Current unresolved failure:"));
    assert!(prompt.contains("workflow CI | trace trace-one | step test #2 (Run suite)"));
    assert!(
        prompt.contains("everr logs --trace-id trace-one --job-name \"test\" --step-number 2")
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

#[test]
fn assistant_setup_response_returns_detected_and_configured_statuses() {
    let response = build_assistant_setup_response(vec![
        AssistantStatus {
            assistant: AssistantKind::Codex,
            detected: true,
            configured: false,
            path: "/tmp/.codex/AGENTS.md".to_string(),
        },
        AssistantStatus {
            assistant: AssistantKind::Claude,
            detected: true,
            configured: true,
            path: "/tmp/.claude/CLAUDE.md".to_string(),
        },
    ]);

    assert_eq!(response.assistant_statuses.len(), 2);
    assert_eq!(
        response.assistant_statuses[0].assistant,
        AssistantKind::Codex
    );
    assert!(!response.assistant_statuses[0].configured);
    assert_eq!(
        response.assistant_statuses[1].assistant,
        AssistantKind::Claude
    );
    assert!(response.assistant_statuses[1].configured);
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
fn tray_menu_model_shows_failed_actions_when_failures_exist() {
    let snapshot = tray_snapshot_with_failures();
    let model = build_tray_menu_model(&snapshot);

    assert_eq!(model.failed_status_label, "Recent failed pipelines (5m): 2");
    assert!(model.show_failed_actions);
}

#[test]
fn tray_menu_model_hides_failed_actions_when_failures_are_empty() {
    let model = build_tray_menu_model(&TraySnapshot::default());

    assert_eq!(model.failed_status_label, "Recent failed pipelines (5m): 0");
    assert!(!model.show_failed_actions);
}

#[test]
fn clearing_tray_state_resets_counts_and_cached_actions() {
    let mut tray = TrayState::default();
    tray.replace_snapshot(tray_snapshot_with_failures());

    tray.clear_snapshot();

    assert_eq!(tray.snapshot, TraySnapshot::default());
}

#[test]
fn tray_prompt_uses_the_first_available_failure() {
    let snapshot = TraySnapshot {
        failures: vec![failure("one")],
        dashboard_url: None,
    };

    assert_eq!(tray_failed_runs_target(&snapshot), None);
    assert_eq!(
        tray_auto_fix_prompt(&snapshot),
        Some(build_notification_auto_fix_prompt(&failure("one")))
    );
}

#[test]
fn active_notification_prompt_prefers_the_active_queue_item() {
    let mut queue = NotificationQueue::default();
    let active = failure("one");
    queue.enqueue(active.clone());

    assert_eq!(
        active_notification_auto_fix_prompt(&queue),
        Some(build_notification_auto_fix_prompt(&active))
    );
}

#[test]
fn mismatched_completed_base_url_reopens_the_wizard() {
    let mut settings = AppSettings {
        completed_base_url: Some("https://app.everr.dev".to_string()),
        wizard_state: WizardState {
            wizard_completed: true,
        },
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
