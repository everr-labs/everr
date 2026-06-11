# Triage

Work through these checks in order:

- Confirm the spike is real: the 5xx rate panel on the index page should show a sustained rise, not a single bucket.
- Check whether request volume moved too — a traffic surge with a flat error count is a capacity problem, not a regression.
- Use the "Errors by service" breakdown to find which service is producing the errors; `everr-web-node` server spans are the usual entry point.
- Look at the [Errors & Logs dashboard](/dashboards/demo/errors-and-logs) for matching error logs around the spike window.
- If a single route dominates, check the "Top routes by p95 latency" table on the Web HTTP Overview dashboard for a correlated latency change.
- If a deploy landed shortly before the spike, roll it back first and investigate after.
