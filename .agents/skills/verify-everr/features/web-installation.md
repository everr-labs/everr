# Self-hosted installation setup

A fresh App installation asks for a workspace name and owner account at `/setup`. Completing that form creates the installation and signs in the owner. The owner can create API keys and explore telemetry using the same installation-wide ClickHouse readers as a deployed self-hosted app.

## Sub-features

- `installation-setup` the fresh installation displays the workspace and owner form.
- `installation-owner` submitting the form signs in the owner and persists the workspace.
- `installation-persist` reloading the app retains the installation and session.
- `installation-ingest` an owner-created key accepts telemetry through the App collector.

## How to get to it (user POV)

Open the self-hosted App URL. A fresh database redirects to `/setup`; configured installations show sign-in or Home.

## Driving it with verify-everr

Preconditions:

- `$V web-launch <RUN_ID> --app app` printed `WEB READY`, and `$V web-doctor` passed.
- `VERIFY_NAME`, unique `VERIFY_EMAIL`, and `VERIFY_PASSWORD` are exported.
- `eval "$($V web-browser-env)"` selected this run's browser and App origin.

- **Set up the installation.** Run:

  ```bash
  agent-browser set viewport 1280 800
  agent-browser open "$WEB/setup"
  agent-browser wait --text "Set up your workspace"
  agent-browser fill '#workspace-name' 'Verify workspace'
  agent-browser fill '#owner-name' "$VERIFY_NAME"
  agent-browser fill '#owner-email' "$VERIFY_EMAIL"
  agent-browser fill '#owner-password' "$VERIFY_PASSWORD"
  agent-browser press Enter
  agent-browser wait --text 'Verify workspace'
  ```

  The owner is signed in and the app shell shows the workspace name. Dismiss any consent banner with `Deny`, then `ab_save installation-01-owner "Self-hosted workspace setup signed in its owner"`.
- **Reload and inspect storage.** Run `agent-browser reload`, wait for the workspace name, then `$V web-psql installation-owner "select email from \"user\" where email = '$VERIFY_EMAIL'"`. One row contains the owner's email. Capture `ab_save installation-02-persist "Self-hosted workspace persists after reload"`.
- **Ingest.** Follow [Web API keys](web-api-keys.md) to create and save an ingest key, then run `$V web-seed`. Expect three logs and three spans in App's ClickHouse. Open `/logs?service=%5B%22verify-seed-api%22%5D`, wait for `verify-seed: checkout started`, and capture it. Cloud remains a separate, empty database in the same graph.
- **Proof.** `web/installation-*`, `db/installation-owner/`, and `seed/seed.txt`.

## Gotchas

- App uses installation setup, while Cloud uses sign-up and organization provisioning. Select `--app app` before launch so key lookup, seed queries and database evidence target App.
- The API-key recipe's expected organization name comes from this workspace rather than Cloud's personal organization name.
- The standard development App has no ClickHouse tenant row policies. Cloud's policy count is checked independently by Doctor.
