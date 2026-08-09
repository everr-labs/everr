# Alert context in the app.logs projection

The narrowed `app.logs` projection of alert transitions is deliberately
skeletal: fired and resolved only, readable `Body`, identity to locate the
source row, and nothing that could disagree with the typed table (decided
2026-08-09, alerting-surface design doc).

Idea: carry `context_json` (rendered summary, description, runbook and
alert-detail links, condition summary) into the projection, so alert rows
in the logs explorer offer the runbook pivot inline instead of requiring a
hop to `app.alert_events`.

Cost to weigh: a second full copy of that content with its own retention,
and one more way the projection can drift from the typed table. If the
logs UI grows a per-row detail view that can fetch from
`app.alert_events` on demand, that likely beats copying.
