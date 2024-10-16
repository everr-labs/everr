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

### Run the app

> [!NOTE]  
> When running the app for the first time you need to push the db schema to postgres. You can do this by running `pnpm db:push` inside the `packages/app` directory.

```bash
pnpm dev
```
