use everr_core::api::FailureNotification;

const TEMPLATE: &str = include_str!("auto_fix_prompt.md");

pub(crate) fn build_notification_auto_fix_prompt(failure: &FailureNotification) -> String {
    TEMPLATE
        .replace("{{failure_details}}", &format_notification_failure(failure))
        .replace("{{logs_instruction}}", &build_logs_instructions(failure))
        .trim_end()
        .to_string()
}

fn build_logs_instructions(failure: &FailureNotification) -> String {
    if failure.failed_jobs.is_empty() {
        return "Pull the relevant Everr logs for this failure before guessing.".to_string();
    }

    let commands: Vec<String> = failure.failed_jobs
        .iter()
        .filter_map(|job| {
            let escaped = serde_json::to_string(&job.job_name).ok()?;
            Some(format!(
                "`everr logs {} --job-name {} --step-number {}`",
                failure.trace_id, escaped, job.step_number
            ))
        })
        .collect();

    commands.join("\n  ")
}

fn format_notification_failure(failure: &FailureNotification) -> String {
    let jobs_suffix = if failure.failed_jobs.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = failure.failed_jobs
            .iter()
            .map(|job| {
                let step_name_suffix = job
                    .step_name
                    .as_deref()
                    .map(|name| format!(" ({name})"))
                    .unwrap_or_default();
                format!("{} #{}{}", job.job_name, job.step_number, step_name_suffix)
            })
            .collect();
        format!(" | failing steps: {}", parts.join(", "))
    };

    format!(
        "branch {} | workflow {} | trace {}{}",
        failure.branch, failure.workflow_name, failure.trace_id, jobs_suffix
    )
}
