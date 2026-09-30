# Contributing to Everr

## Development

### System prerequisites

You need the standard toolchains on every platform: Rust (stable), Node + pnpm,
Go (for the collector), and Docker with the Compose plugin.

On macOS, install the Xcode command line tools. On Linux, install a C/C++ build toolchain and the libraries required by chDB. The local UI runs in your browser.

### Set up GitHub webhook forwarding

The web app starts a [`smee`](https://smee.io/) client during Vite dev when `SMEE_CHANNEL` is set.

1. Create or open a smee channel at `https://smee.io/new`.
2. Copy the channel id from the generated URL. For example, the channel id for `https://smee.io/abc123` is `abc123`.
3. Set the channel id in `packages/app/.env`:
   ```bash
   SMEE_CHANNEL="abc123"
   ```
4. Start the web app with `pnpm dev:web`. The dev server forwards events from `https://smee.io/<SMEE_CHANNEL>` to `http://localhost:5173/webhook/github`.

### Start the local services (Postgres, ClickHouse, collector, mail)

```bash
docker compose up -d
```

> [!NOTE]
> **Fedora / SELinux:** the bind mounts in `docker-compose.yaml` carry the `:Z`
> / `:z` flag, so Docker relabels the host paths for SELinux automatically — no
> manual `chcon` is needed (the flag is ignored on macOS/Docker Desktop). Just
> install the Compose plugin from Fedora's repositories
> (`sudo dnf install docker-compose`) rather than the docker-ce
> `docker-compose-plugin`, which conflicts with Fedora's `docker-buildx`.

### Install dependencies and build

```bash
pnpm i
pnpm build
```

### Create a GitHub App

1. On GitHub, go to [Settings -> Developer settings -> GitHub Apps](https://github.com/settings/apps) and click **New GitHub App**.
2. Choose an app name and set a homepage URL.
3. Under **Webhook**, enable **Active** and set the webhook URL to your smee channel URL, for example: `https://smee.io/<SMEE_CHANNEL>`.
4. Set a webhook secret and store it in both `packages/app/.env` as `GITHUB_APP_WEBHOOK_SECRET` and in `collector/config.yml` as `receivers.githubactions.secret`.
5. Under **Repository permissions**, set **Actions** to **Read-only**.
6. Under **Subscribe to events**, select **Workflow job** and **Workflow run**.
7. Create the app.
8. In the app settings page, scroll to **Private keys** and click **Generate a private key** to download the `.pem` file.
9. Move the downloaded `.pem` file into `collector/` and set restrictive permissions:
   ```bash
   mv ~/Downloads/<your-app-name>*.pem collector/dev-everr-app.pem
   chmod 600 collector/dev-everr-app.pem
   ```
10. Install the app on the repository you want to observe.
11. Get the **App ID** from the GitHub App settings page (shown at the top of the page).
12. Copy `collector/config.example.yml` to `collector/config.yml` and fill in
    the two values you just collected:
    ```bash
    cp collector/config.example.yml collector/config.yml
    ```
    ```yaml
    receivers:
      githubactions:
        secret: <webhook-secret>
        gh_api:
          auth:
            app_id: <app-id>
            private_key_path: ./dev-everr-app.pem
    ```
    Do not hand-write the `processors` block. The example is the maintained
    copy: it stamps the tenant and the retention the views expect, and a
    resource that reaches ClickHouse without retention is rejected.
13. Try to redeliver the ping to validate that everything is ok

### GitHub installation ownership model

- A GitHub App `installation_id` is scoped to the install target account (user/org), not the individual user who clicks install.
- Everr enforces exclusive mapping: one `installation_id` can be linked to only one tenant.
- If another tenant tries to link the same installation, the app returns `github_install=error&reason=already_linked`.
- This prevents cross-tenant takeover of the same installation mapping.

Downsides:

- A customer cannot intentionally share one GitHub installation across multiple Everr tenants.
- If a customer accidentally creates multiple Everr orgs, they must consolidate to one org or uninstall/reinstall with a different GitHub account scope.
- Customer support may be needed to resolve mistaken links (for example, unlinking and relinking the installation).
- True cross-tenant shared views require a different data model than a single-tenant installation mapping.

Practical examples:

- Same tenant, different users:
  User A and User B both belong to the same Everr org and both click install for the same GitHub org. They resolve to the same `installation_id`, and linking succeeds (no ownership conflict).
- Different tenants, same GitHub org install:
  Tenant A links installation `12345`. Tenant B later tries to link installation `12345` and receives `github_install=error&reason=already_linked`.
- Repo selection changes:
  A user adds/removes repositories inside an existing GitHub installation. The `installation_id` does not change, so tenant ownership stays the same.
- Uninstall and reinstall:
  If the app is uninstalled and reinstalled, GitHub may create a new installation context. The new install goes through link flow again and creates/updates mapping for that new `installation_id`.

### Fill the collector config

Update `collector/config.yml` with your Grafana Cloud values.

### Set app environment variables

```bash
cp packages/app/.env.example packages/app/.env
```

Then review and update values in `packages/app/.env` if needed.

### Start the collector

```bash
cd collector
make run
```

### Run the dev stack

> [!NOTE]
> The app now owns the GitHub webhook ingress, queue polling, and workflow status writes into Postgres. Start the full dev stack after Postgres and ClickHouse are up.

```bash
pnpm dev
```

Use `pnpm dev:web` or `pnpm dev:docs` to start a web surface. Run `pnpm dev:local` to start the local UI with hot reload and its Rust CLI backend and collector. The command opens `http://127.0.0.1:1420`, watches Rust changes for rebuilds and restarts, and stops all its processes on Ctrl+C. Use `--no-open` to suppress browser launch. Cloud features use the hosted app development server started by `pnpm dev:web`.

Use `pnpm dev:local:ui` to run only Vite against an already running development CLI. Run `pnpm dev:cli` to rebuild the CLI's embedded UI and collector assets, then `./target/debug/everr-dev local start` to check the packaged experience.

For a release build, run `pnpm build:cli`. The CLI version comes from `packages/cli/package.json`. Build signing inputs can be provided in `packages/cli/.env`.
