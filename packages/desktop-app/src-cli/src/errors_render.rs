//! Shared human/JSON rendering for `errors list` and `errors show`, used by
//! both the cloud commands (over the /api/cli routes) and the local commands
//! (over the collector's SQL endpoint). The only thing that differs between the
//! two surfaces is where an Error's links point, captured by [`ErrorLinks`].

use everr_core::api::{ApiClient, ErrorIssueDetail, ErrorIssueSummary};

/// Where an Error's links point. The cloud has a web UI, so it prints a web
/// link and clickable trace URLs; local telemetry has neither, so it omits the
/// web link and prints raw trace IDs (usable with `everr local query`).
pub(crate) enum ErrorLinks<'a> {
    // Only `core.rs` (the cloud commands) constructs this, and `core.rs` is not
    // part of the lib crate, so the lib build alone sees it as unused.
    #[allow(dead_code)]
    Cloud(&'a ApiClient),
    Local,
}

impl ErrorLinks<'_> {
    fn web_url(&self, fingerprint: &str) -> Option<String> {
        match self {
            ErrorLinks::Cloud(client) => Some(client.error_web_url(fingerprint)),
            ErrorLinks::Local => None,
        }
    }

    fn trace_cell(&self, trace_id: &str, span_id: &str) -> String {
        if trace_id.is_empty() {
            return "(no trace)".to_string();
        }
        match self {
            ErrorLinks::Cloud(client) => client.trace_web_url(trace_id, Some(span_id)),
            ErrorLinks::Local => trace_id.to_string(),
        }
    }
}

/// ClickHouse timestamps arrive with nanosecond precision; the human views cut
/// them to seconds (`YYYY-MM-DD HH:MM:SS`). `--json` keeps full precision.
pub(crate) fn short_ts(timestamp: &str) -> &str {
    timestamp.get(..19).unwrap_or(timestamp)
}

/// One-line headline of an Error: `Type: message`, degrading to whichever part
/// exists, then to the first body line.
pub(crate) fn error_title(summary: &ErrorIssueSummary) -> String {
    let title = match (
        summary.exception_type.is_empty(),
        summary.exception_message.is_empty(),
    ) {
        (false, false) => format!("{}: {}", summary.exception_type, summary.exception_message),
        (false, true) => summary.exception_type.clone(),
        (true, false) => summary.exception_message.clone(),
        (true, true) => summary.body.lines().next().unwrap_or_default().to_string(),
    };
    // Keep the table one row per Error even when a message carries newlines.
    title.lines().next().unwrap_or_default().to_string()
}

pub(crate) fn print_errors_list(issues: &[ErrorIssueSummary], json: bool) -> anyhow::Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(issues)?);
        return Ok(());
    }
    if issues.is_empty() {
        println!("No Errors in this time range.");
        return Ok(());
    }
    println!(
        "{:>11}  {:<19}  {:<20}  {:<20}  ERROR",
        "OCCURRENCES", "LAST SEEN", "SERVICE", "FINGERPRINT"
    );
    for issue in issues {
        println!(
            "{:>11}  {:<19}  {:<20}  {:<20}  {}",
            issue.occurrence_count,
            short_ts(&issue.last_seen),
            issue.latest_service_name,
            issue.fingerprint,
            error_title(issue)
        );
    }
    Ok(())
}

pub(crate) fn print_error_detail(
    detail: &ErrorIssueDetail,
    json: bool,
    links: &ErrorLinks,
) -> anyhow::Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(detail)?);
        return Ok(());
    }

    let summary = &detail.summary;
    println!("{}", error_title(summary));
    println!();
    println!("{:<12} {}", "Fingerprint", summary.fingerprint);
    println!("{:<12} {}", "Services", summary.services.join(", "));
    println!(
        "{:<12} {} across {} traces",
        "Occurrences", summary.occurrence_count, summary.trace_count
    );
    println!("{:<12} {}", "First seen", short_ts(&summary.first_seen));
    println!("{:<12} {}", "Last seen", short_ts(&summary.last_seen));
    if let Some(web) = links.web_url(&summary.fingerprint) {
        println!("{:<12} {}", "Web", web);
    }

    println!();
    println!("Stacktrace");
    if detail.latest.exception_stacktrace.is_empty() {
        println!("  (none recorded)");
    } else {
        for line in detail.latest.exception_stacktrace.lines() {
            println!("  {line}");
        }
    }

    println!();
    println!(
        "Occurrences ({} of {})",
        detail.occurrences.len(),
        summary.occurrence_count
    );
    for occurrence in &detail.occurrences {
        let version = occurrence
            .resource_attributes
            .get("service.version")
            .filter(|v| !v.is_empty())
            .map(String::as_str)
            .unwrap_or("-");
        println!(
            "  {}  {:<20}  {:<12}  {}",
            short_ts(&occurrence.timestamp),
            occurrence.service_name,
            version,
            links.trace_cell(&occurrence.trace_id, &occurrence.span_id)
        );
    }
    Ok(())
}
