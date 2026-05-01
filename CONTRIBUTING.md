# Contributing to Everr

## Development

### Set up `devtunnels`

> [!NOTE]
> The following steps are for setting up `devtunnels` for the first time. If you have already set up the devtunnel, you can skip to the last step and directly start the tunnel via `devtunnel host`.
> You may need to repeat the steps if the tunnel is not used for more than 30 days.

1. Install and setup [`devtunnels`](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started?tabs=macos#install).
2. Login via `devtunnel user login`
3. Create a tunnel via `devtunnel create -a -d 'Everr app'`
4. Configure the tunnel `devtunnel port create -p 5173`
5. Start the tunnel `devtunnel host`

### Start ClickHouse

```bash
docker-compose up -d
```

### Install dependencies and build

```bash
pnpm i
pnpm build
```

### Create a GitHub App

1. On GitHub, go to [Settings -> Developer settings -> GitHub Apps](https://github.com/settings/apps) and click **New GitHub App**.
2. Choose an app name and set a homepage URL.
3. Under **Webhook**, enable **Active** and set the webhook URL to your tunnel URL with the receiver path, for example: `https://<your-tunnel>/webhook/github`.
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
12. Fill `collector/config.yml`:
    ```yaml
    receivers:
      githubactions:
        secret: <webhook-secret>
        gh_api:
          auth:
            app_id: <app-id>
            private_key_path: ./dev-everr-app.pem
    processors:
      resource/tenant:
        attributes:
          - key: everr.tenant.id
            from_context: metadata.x-everr-tenant-id
            action: upsert
          - key: everr.tenant.id
            action: convert
            converted_type: int
    ```
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

Use `pnpm dev:web` or `pnpm dev:docs` to start one web surface, or run native commands from `packages/desktop-app/`.

### Build a signed Everr release

For macOS distribution, use:

```bash
pnpm --dir packages/desktop-app build:desktop
```

To bump the desktop app patch version without building, use:

```bash
pnpm bump:desktop
```

If you also want that release flow to install the signed CLI into `~/.local/bin`, opt in explicitly:

```bash
pnpm --dir packages/desktop-app build:desktop -- --install
```

The Apple signing and notarization inputs are documented in `packages/desktop-app/README.md`.
CI secret setup is documented in `docs/desktop-release-secrets.md`.
`packages/desktop-app/.env` is sourced automatically by the package-native build scripts.
That release flow stages the DMG, updater artifacts, checksums, release metadata, and signed CLI files into `target/desktop-release/`.
