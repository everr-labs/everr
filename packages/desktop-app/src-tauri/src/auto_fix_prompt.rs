use everr_core::api::{FailedJobInfo, FailureNotification};

const TEMPLATE: &str = include_str!("auto_fix_prompt.md");

pub(crate) fn build_notification_auto_fix_prompt(failure: &FailureNotification) -> String {
    let jobs = effective_jobs(failure);

    TEMPLATE
        .replace("{{failure_details}}", &format_notification_failure(failure, &jobs))
        .replace("{{logs_instruction}}", &build_logs_instructions(failure, &jobs))
        .trim_end()
        .to_string()
}

fn build_logs_instructions(failure: &FailureNotification, jobs: &[FailedJobInfo]) -> String {
    if jobs.is_empty() {
        return "Pull the relevant Everr logs for this failure before guessing.".to_string();
    }

    let commands: Vec<String> = jobs
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

/// Return all failed jobs. Falls back to the legacy single-job fields when `failed_jobs` is empty.
fn effective_jobs(failure: &FailureNotification) -> Vec<FailedJobInfo> {
    if !failure.failed_jobs.is_empty() {
        return failure.failed_jobs.clone();
    }
    // Legacy fallback
    match (failure.job_name.as_deref(), failure.step_number.as_deref()) {
        (Some(job), Some(step)) => vec![FailedJobInfo {
            job_name: job.to_string(),
            step_number: step.to_string(),
            step_name: failure.step_name.clone(),
        }],
        _ => vec![],
    }
}

fn format_notification_failure(failure: &FailureNotification, jobs: &[FailedJobInfo]) -> String {
    let jobs_suffix = if jobs.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = jobs
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
