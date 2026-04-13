use std::sync::{Arc, Mutex};

use everr_core::api::{FailedJobInfo, FailureNotification};
use everr_core::assistant::{AssistantKind, AssistantStatus};
use everr_core::state::{AppSettings, AppStateStore, WizardState};
use everr_core::state_watcher::StateWatcher;
use tempfile::tempdir;

use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::cli::sync_installed_cli_from_paths;
use crate::notifications::{active_notification_auto_fix_prompt, reset_notifier_runtime_state};
use crate::settings::{build_assistant_setup_response, build_wizard_status_response};
use crate::{
    current_app_name, current_base_url, current_state_store, should_check_for_updates,
    NotificationQueue, NotifierState, RuntimeState, APP_NAME, DEV_APP_NAME,
};

pub(crate) fn test_runtime_state() -> RuntimeState {
    let temp = tempdir().expect("tempdir");
    let store = AppStateStore::for_namespace_with_file_name(
        temp.path().to_str().unwrap(),
        "test-session.json",
    );
    let watcher = StateWatcher::start(store.clone()).expect("state watcher");
    // Keep tempdir alive by leaking it — tests are short-lived
    let _ = Box::leak(Box::new(temp));
    RuntimeState {
        store,
        watcher: Arc::new(watcher),
        notifier: Arc::new(Mutex::new(NotifierState::default())),
        pending_auth: Arc::new(Mutex::new(None)),
    }
}

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
fn notification_prompt_builder_formats_single_failure_with_exact_logs_command() {
    let prompt = build_notification_auto_fix_prompt(&failure("one"));

    assert!(prompt.contains("Investigate and fix this CI pipeline failure."));
    assert!(prompt.contains("Failure details:"));
    assert!(prompt.contains("workflow CI | trace trace-one | failing steps: test #2 (Run suite)"));
    assert!(prompt.contains("everr logs trace-one --job-name \"test\" --step-number 2"));
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
        job_name: Some("test".to_string()),
        step_number: Some("3".to_string()),
        step_name: Some("Run suite".to_string()),
    };

    let prompt = build_notification_auto_fix_prompt(&notification);

    assert!(
        prompt.contains("failing steps: test #3 (Run suite), lint #2 (Biome check)"),
        "prompt should list all failed jobs, got: {prompt}"
    );
    assert!(
        prompt.contains("everr logs trace-multi --job-name \"test\" --step-number 3"),
        "prompt should include logs command for first job"
    );
    assert!(
        prompt.contains("everr logs trace-multi --job-name \"lint\" --step-number 2"),
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
fn resetting_notifier_runtime_state_clears_queue_and_dedupe_tracker() {
    let mut notifier = crate::NotifierState::default();
    let first = failure("one");

    assert_eq!(notifier.tracker.retain_new(vec![first.clone()]).len(), 1);
    assert!(notifier.tracker.retain_new(vec![first.clone()]).is_empty());

    notifier.queue.enqueue(first.clone());
    notifier.queue.enqueue(failure("two"));

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
