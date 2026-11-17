---
"@everr/cli": minor
---

Add `everr cloud recording show --stream <id> --at <time>`. It prints the page of a recorded browser visit 0.75 seconds after the moment, as a bounded outline (`--html` for HTML): its elements, their state, and the text the app did not mask. Clicks, requests, errors, navigations, and the Clips themselves stay in traces and logs, read with `everr cloud query`. `--at` accepts RFC 3339 with a zone, epoch milliseconds or seconds, or date math such as `now-5m`. The CLI downloads the Recording's Segments up to that moment (gzipped) and rebuilds the page on your machine. The `everr-use-telemetry` skill gains `rules/recordings.md`: the session timeline from SQL, the queries that find Clips and count UX patterns over every visit, and when to read the page.
