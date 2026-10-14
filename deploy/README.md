# Run Everr with Docker Compose

This stack runs the Everr app, collector, PostgreSQL, and ClickHouse on one
machine. It builds the self-hostable product from this checkout. Docker with
Compose and OpenSSL are required; Node and Go are built inside Docker.

From the repository root:

```sh
cd deploy
./configure.sh
```

Optionally edit the generated `.env` and set `EMAIL_DSN` (an `smtp://` or `smtps://` URL)
and `EMAIL_FROM` (an address your relay permits). Email is used for invitations,
verification, and password recovery. URL-encode special characters in SMTP
credentials; single-quote `.env` values containing `$`.

Without SMTP, the app starts and invitations can be shared by link. Email
verification and email-based password recovery still require email delivery;
invited users cannot complete the current verification flow without SMTP.
Operators can recover existing local accounts using the commands below.

Start the stack:

```sh
docker compose up -d --build --wait
```

The first build downloads dependencies and compiles the app and collector.
Open <http://localhost:3000> and create the workspace and its owner. The first
person to complete setup becomes the owner. Setup closes once the workspace
exists, and concurrent attempts cannot create another workspace.

The app applies PostgreSQL migrations during startup. ClickHouse initializes
its schema and access roles on the first start with an empty data volume.
Workers run inside the app; no separate worker service is needed.

## Remote access

Ports bind to `127.0.0.1` by default. Put a TLS reverse proxy in front of the
app (port 3000) and OTLP/HTTP receiver (port 4318). Set `BETTER_AUTH_URL` to the
public app origin and `EVERR_PUBLIC_INGEST_URL` to the public collector base URL,
then run `docker compose up -d`. Keep the collector's `/v1/traces`, `/v1/logs`,
and `/v1/metrics` paths intact and forward the `Authorization` and `Origin`
headers. A containerized proxy must join this Compose network or reach the host
ports explicitly. OTLP/gRPC uses port 4317 and needs a gRPC-capable proxy.

`BIND_ADDRESS`, `APP_PORT`, `OTLP_HTTP_PORT`, and `OTLP_GRPC_PORT` can override
the published listeners. Changing ports does not update the public URLs for you.
PostgreSQL, ClickHouse, and the collector health endpoint have no published ports.

## Send telemetry

Create an ingest key in Everr and configure your application's OpenTelemetry
exporter with the collector's public URL and the key:

```sh
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer YOUR_INGEST_KEY"
OTEL_SERVICE_NAME=my-app
```

Use the reachable collector URL for remote applications. Browser applications
need a public ingest key with their origin allowed. Send a request through your
application and check its service in Everr's traces, logs, or metrics explorer.
The collector rejects unauthenticated ingestion and derives workspace and
retention from the verified key. It keeps queued telemetry on a persistent volume.

This stack has no Cloud billing or required GitHub configuration. GitHub webhook
ingestion is not configured by this Compose bundle. Retention defaults to 30 days;
set `EVERR_RETENTION_DAYS` to a supported window in `.env` to change it.

## Operations

```sh
docker compose ps
docker compose logs --tail=100 app collector
docker compose down
```

`down` preserves data. **`down --volumes` deletes this installation's data.**
Keep `.env` with your backups: it contains database credentials, the authentication
secret, and the key used to derive workspace SQL credentials. The configuration
script refuses to overwrite it. Changing database passwords in `.env` does not
rotate credentials in an initialized database.

Named volumes hold PostgreSQL data, ClickHouse data, and the collector queue.
Keep the Compose project name stable so subsequent starts use the same volumes.
Back up both databases and the secrets before changing versions. PostgreSQL
migrations run automatically, but ClickHouse initialization scripts are not an
upgrade migration mechanism. Review schema changes before upgrading an existing
installation; this bundle currently targets fresh installations.

The repository root's `docker-compose.yaml` remains the development dependency
stack. Run installation commands from this directory to select this stack.

## Account recovery

The self-hosted image includes a recovery command. Run it from this directory
with the installation's existing `.env`. PostgreSQL must be running; if needed,
start it with `docker compose up -d postgres`.

To generate a one-time password reset link:

```sh
docker compose run --rm --no-deps app .output/server/recovery.mjs link --email admin@example.com
```

The link expires after 15 minutes and opens the existing password reset page.
`BETTER_AUTH_URL` must be the app's reachable public URL, and the web app must
be running when the user opens the link. Share the link privately with the
account holder.

To set a password directly, including when the web app cannot start:

```sh
docker compose run --rm --no-deps app .output/server/recovery.mjs password --email admin@example.com
```

Enter the password twice at the hidden prompts. Use an interactive terminal
(do not pass `-T`); passwords are never supplied as command-line arguments.
Passwords must contain 8 to 128 characters. Ctrl+C cancels without changing
the account.

Both commands operate only on existing accounts with local passwords. They
immediately invalidate the account's sessions and previous password reset
links, without changing workspace membership, role, or email-verification
status. Completing a reset link also invalidates sessions created since the
link was issued. Accounts that only use an external identity provider must
be recovered through that provider.

The command is built alongside the self-hosted server by
`pnpm build:self-hosted`. Direct password recovery needs only database
configuration; link generation also needs `BETTER_AUTH_URL`. It does not start
the web server or workers, and requires neither SMTP nor ClickHouse.
