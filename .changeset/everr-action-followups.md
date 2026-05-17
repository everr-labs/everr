---
"@everr/action": minor
---

Default `resource-usage` to `"true"` so callers can use the action with
no `with:` block. Inline the finalize logic into the main bundle (no
more spawned subprocess), guard finalization on `RUNNER_OS=Linux`, and
fix the auto-generated README that still referenced the removed
`check-run-id` input.
