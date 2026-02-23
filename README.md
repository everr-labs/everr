# Citric

## Development

### Set up `devtunnels`

> [!NOTE]  
> The follwing steps are for setting up `devtunnels` for the first time. If you have already set up the devtunnel, you can skip to the last step and directly start the tunnel via `devtunnel host`.
> You may need to repeat the steps if the tunnel is not used for more than 30 days.

1. Install and setup [`devtunnels`](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started?tabs=macos#install).
2. Login via `devtunnel user login`
3. Create a tunnel via `devtunnel create -a -d 'OTel collector' citric`
4. Configure the tunnel `devtunnel port create -p 3333`
5. Start the tunnel `devtunnel host`

### Start clickhouse

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
4. Set a webhook secret and store it in `collector/config.yml` as `receivers.githubactions.secret`.
5. Under **Repository permissions**, set **Actions** to **Read-only**.
6. Under **Subscribe to events**, select **Workflow job** and **Workflow run**.
7. Create the app.
8. In the app settings page, scroll to **Private keys** and click **Generate a private key** to download the `.pem` file.
9. Move the downloaded `.pem` file into `collector/` and set restrictive permissions:
   ```bash
   mv ~/Downloads/<your-app-name>*.pem collector/dev-citric-app.pem
   chmod 600 collector/dev-citric-app.pem
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
            private_key_path: ./dev-citric-app.pem
    ```
13. Try to redeliver the ping to validate that everything is ok

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

### Run the app

> [!NOTE]  
> When running the app for the first time you need to push the db schema to postgres. You can do this by running `pnpm db:push` inside the `packages/app` directory.

```bash
pnpm dev
```

## Configure Grafana

You need a Grafana Cloud Instance.

Generate an Access Policy with the following permissions:

- metrics:write
- traces:write
- logs:write
- profiles:write

and fill in `collector/config.yml`.

### Generate a Service account

Generate a service account with `Data Sources:reader` permission and generate a token.
