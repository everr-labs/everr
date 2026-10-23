# Web GitHub connection and webhook ingress

Admins connect GitHub from `/github`: `Install GitHub App` opens `/api/github/install/start`, which redirects to the App's GitHub install page with a signed `state`; GitHub then calls back and links the installation to the organization. GitHub delivers `workflow_run`/`workflow_job` webhooks to `/webhook/github`, which verifies the HMAC signature, queues collector and status jobs, and drops events whose installation is not linked to any organization.

## Sub-features

- `gh-page` `/github` shows `Connect the Everr GitHub App` and `Install GitHub App`.
- `gh-install-start-anon` `/api/github/install/start` without a session returns `401 unauthenticated`.
- `gh-install-redirect` signed in as admin, install start redirects to `GITHUB_APP_INSTALL_URL` with `state` (blocked past this point: needs a real App).
- `gh-webhook-method` `GET /webhook/github` returns `405 method not allowed`.
- `gh-webhook-unsigned` POST without `x-hub-signature-256` returns `401 missing signature`.
- `gh-webhook-bad-signature` POST with a wrong signature returns `401 invalid signature`.
- `gh-webhook-accepted` a correctly signed `workflow_run` returns `202`, and the worker runs `github-events/collector` and `github-events/status` for it.
- `gh-webhook-unlinked-dropped` for an installation not linked to an org, no `workflow_runs` row is written.
- `gh-linked-runs` a linked installation's runs appear on `/runs` (blocked).

## How to get to it (user POV)

- Sidebar admin area or `/github`, then `Install GitHub App` (opens a new tab).
- GitHub itself POSTs to `/webhook/github` (in dev through smee, `SMEE_CHANNEL`).

## Driving it with verify-everr

Preconditions:

- The default graph uses the real GitHub App settings and Smee channel in each package's existing dotenv file, as described in CONTRIBUTING.md. `WEB DOCTOR OK`; for `gh-page`, `eval "$($V web-browser-env)"` in the driving shell and this run's browser signed in as the sign-up user (an admin).

- **Page.** Run `agent-browser open "$WEB/github" && agent-browser wait --text "Install GitHub App" && ab_save github-01-page`. `github-01-page.txt` contains `Connect the Everr GitHub App` and `Install GitHub App` (`gh-page`). The install button opens the configured real GitHub App. Complete installation only when that external action is part of the requested verification.
- **Install start without a session.** Run `$V web-http install-start-anon GET /api/github/install/start`. Status `401`, body `unauthenticated` (`gh-install-start-anon`).
- **Webhook rejections.** Run `$V web-http webhook-get GET /webhook/github` (expect `405`), `$V web-http webhook-unsigned POST /webhook/github -H 'content-type: application/json' --data '{}'` (expect `401 missing signature`), `$V web-http webhook-badsig POST /webhook/github -H 'content-type: application/json' -H 'x-hub-signature-256: sha256=00' --data '{}'` (expect `401 invalid signature`).
- **Signed delivery.** Run `$V web-webhook webhook-signed workflow_run workflow-run.webhook.json`. Status `202`; `http/webhook-signed/delivery.txt` holds the delivery id. Within a few seconds `web.log` shows `Completed task <n> (github-events/status, ...) with success` and `... (github-events/collector, ...) with success` (`gh-webhook-accepted`).
- **Dropped, not stored.** Run `$V web-psql workflow-runs "select count(*) from workflow_runs"`. `0`, because installation `424242` in the payload is not linked (`gh-webhook-unlinked-dropped`).
- **Proof.** `web/github-01-page.*`, `http/*`, `db/workflow-runs/`, `web.log` after cleanup.

## Gotchas

- `web-webhook` signs with the selected application's configured `GITHUB_APP_WEBHOOK_SECRET`, which is what GitHub does with the App's configured secret. It proves the ingress path, not GitHub's side.
- `gh-install-redirect` and `gh-linked-runs` need `GITHUB_APP_INSTALL_URL`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and a matching webhook secret in `packages/app/.env`, and `GITHUB_APP_STATE_SECRET` in the selected package's dotenv file. The default graph configures the native receivers directly; no collector configuration copy is needed. Report them as blocked with that list. Never insert `github_installation_organizations` rows to fake a link.
- The "stale installation dropped" log line goes to the app's OTel logger, not `web.log`. Only the task completion lines are visible there.
- Both jobs completing with `success` does not mean data was stored; always pair with the `workflow_runs` check.
