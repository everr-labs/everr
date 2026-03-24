use everr_core::api::FailureNotification;

pub(crate) fn build_notification_auto_fix_prompt(failure: &FailureNotification) -> String {
    let mut sections = vec![
        "Investigate and fix this unresolved CI pipeline failure.".to_string(),
        "Use Everr CLI from the current project directory before guessing.".to_string(),
        String::new(),
        "Required workflow:".to_string(),
    ];

    if let Some(logs_command) = build_runs_logs_command(failure) {
        sections.push("- Start by pulling logs with this exact command:".to_string());
        sections.push(format!("  `{logs_command}`"));
    } else {
        sections.push(
            "- Start by pulling the relevant Everr logs for this failure before guessing."
                .to_string(),
        );
    }

    sections.push("- Make the smallest repo-local fix that addresses the root cause.".to_string());
    sections.push("- Run the narrowest relevant test or check before finishing.".to_string());
    sections.push(String::new());
    sections.push("Current unresolved failure:".to_string());
    sections.push(format!("- {}", format_notification_failure(failure)));
    sections.push(String::new());
    sections.push(
        "Return a concise summary with root cause, code changes, verification, and any follow-up risk."
            .to_string(),
    );

    sections.join("\n")
}

pub(crate) fn build_runs_logs_command(failure: &FailureNotification) -> Option<String> {
    let job_name = failure.job_name.as_deref()?;
    let step_number = failure.step_number.as_deref()?;
    let escaped_job_name = serde_json::to_string(job_name).ok()?;

    Some(format!(
        "everr runs-logs --trace-id {} --job-name {} --step-number {}",
        failure.trace_id, escaped_job_name, step_number
    ))
}

fn format_notification_failure(failure: &FailureNotification) -> String {
    format!(
        "branch {} | workflow {} | trace {}{}",
        failure.branch,
        failure.workflow_name,
        failure.trace_id,
        format_failing_step_suffix(failure)
    )
}

fn format_failing_step_suffix(failure: &FailureNotification) -> String {
    match (failure.job_name.as_deref(), failure.step_number.as_deref()) {
        (Some(job_name), Some(step_number)) => {
            let step_suffix = failure
                .step_name
                .as_deref()
                .map(|step_name| format!(" ({step_name})"))
                .unwrap_or_default();
            format!(" | step {job_name} #{step_number}{step_suffix}")
        }
        _ => String::new(),
    }
}
