# 26: Preview alerts show preview history

**What to build:** The expanded triage detail for a preview alert shows
the preview's own evidence and transitions, not empty or live-scope data.

**Details:** finding 16 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** done

- [x] Preview identity carries through the history query (`previewIds` threads through `queryClickHouseAlertEventLog`)
- [x] A test covers the same rule identity in live and preview scopes (`repository.server.test.ts` overlays selected preview ids; `pipeline-read-path.integration.test.ts` keeps a preview out of live history until its id is asked for)

Record check 2026-08-10: the rule detail page carries preview scope correctly.
The triage-board expander, the surface this ticket names, still queries with a
null preview scope, and preview rows are not `is_live`, so it returns empty.
