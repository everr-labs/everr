use everr_core::api::FailureNotification;

const TEMPLATE: &str = include_str!("auto_fix_prompt.md");

pub(crate) fn build_notification_auto_fix_prompt(failure: &FailureNotification) -> String {
    let logs_instruction = match build_runs_logs_command(failure) {
        Some(cmd) => format!("`{cmd}`"),
        None => "Pull the relevant Everr logs for this failure before guessing.".to_string(),
    };

    TEMPLATE
        .replace("{{failure_details}}", &format_notification_failure(failure))
        .replace("{{logs_instruction}}", &logs_instruction)
        .trim_end()
        .to_string()
}

pub(crate) fn build_runs_logs_command(failure: &FailureNotification) -> Option<String> {
    let job_name = failure.job_name.as_deref()?;
    let step_number = failure.step_number.as_deref()?;
    let escaped_job_name = serde_json::to_string(job_name).ok()?;

    Some(format!(
        "everr logs --trace-id {} --job-name {} --step-number {}",
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
