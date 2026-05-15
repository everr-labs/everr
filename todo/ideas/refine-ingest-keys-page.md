# Refine ingest keys page

## What

Improve the design and UX of the ingest keys management page (`/ingest-keys`) and the create-key dialog. The current implementation is functional but minimal: a plain table, a basic form, no copy-affordance polish, no usage feedback, and it's tucked away in the avatar menu.

## Why

This page is the first concrete interaction a user has when wiring up SDK ingest. The current flow works but doesn't carry the user across "I have a key" → "telemetry is flowing." It also hides behind the user menu so new users don't discover it. Worth a focused pass before any external users see it.

## Who

Anyone setting up OTLP ingest for the first time — both engineers wiring real services and AI agents going through onboarding programmatically. Org admins managing key lifecycle.

## Rough appetite

small

## Notes

- **Discoverability:** today the link lives in the avatar dropdown. Consider a Settings → Ingest section, or surface from an "Add a source" CTA on an empty dashboard view.
- **Post-creation step:** copy-as-curl / copy-as-env-var / copy-as-collector-yaml snippets pre-filled with the user's key, side-by-side with the raw value. Make it obvious the key won't be visible again.
- **Pre-filled examples per SDK** (Node, Python, Go, Rust) — same as the docs page but right there at the moment of "now what do I do with this."
- **Connectivity check:** "Test this key" button that sends a single OTLP log/span from the browser (or instructs how to send one) and reports back whether it landed. Closes the loop without leaving the page.
- **Empty state:** a real first-key flow with an explanation of what an ingest key is, what scope it has, and how it differs from the CLI keys.
- **Table polish:** the existing columns (Name / Prefix / Created / Expires / Last used) are fine but the row actions are stark. Consider grouping into a dropdown, and adding "regenerate" alongside "revoke" once that flow exists.
- **Rotation flow:** rotating a key currently means revoke + create + re-paste in N places. A "rotate" affordance that issues a new key and shows both old + new during a grace window would be friendlier.
- **Names + descriptions:** the create form requires a name but doesn't ask for purpose / environment / owner. Optional fields would make older entries easier to audit a year later.
- **Confirm-on-revoke** copy is fine; could call out the 30s cache TTL explicitly ("Effective within 30 seconds").
- **Mobile / small screens:** untested. Probably fine given the simple table, but worth a glance.
- Out of scope here: rate limiting (separate idea), auto-issued per-(user, org) keys for the routing design (also separate), backend changes to key schema.
