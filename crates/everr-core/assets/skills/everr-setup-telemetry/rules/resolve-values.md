# Resolve Configuration Values

OpenTelemetry setup needs project-specific values. Do not invent them, hardcode placeholders into working config, or ask the user before checking the codebase.

Use the first source that yields a result. If no source matches and the value is required, ask the user or leave an explicit deploy-time variable reference.

## `service.name`

Check in order:

1. Existing OTel setup code or deployment config that already sets a stable `service.name`.
2. Package/build metadata:
   - Node.js: `name` in `package.json`.
   - Go: last path segment of `module` in `go.mod`.
   - Python: `name` in `pyproject.toml`, `setup.cfg`, or `setup.py`.
   - Rust: `package.name` in `Cargo.toml`.
   - PHP: package segment after `/` in `composer.json`.
3. Project directory name.

Normalize names with spaces, underscores, or mixed case to a stable convention such as kebab-case. Hardcode the resolved default in the telemetry setup module and use the same case-sensitive value in every environment.

## `service.version`

Check in order:

1. Existing `service.version` in `OTEL_RESOURCE_ATTRIBUTES`.
2. CI/CD version injection in workflow files, build args, Helm values, or deployment manifests.
3. Package/build metadata version fields.
4. `git describe --tags --always`; if no tag exists, use a short commit SHA.

Do not hardcode literal versions such as `1.0.0` into application code or committed env files. Reference a build or deployment variable whenever possible.

## `deployment.environment.name`

Check in order:

1. Existing `deployment.environment.name` in OTel configuration.
2. Framework environment variables: `NODE_ENV`, `RAILS_ENV`, `RACK_ENV`, `DJANGO_SETTINGS_MODULE`, `FLASK_ENV`, `SPRING_PROFILES_ACTIVE`, `ASPNETCORE_ENVIRONMENT`, `DOTNET_ENVIRONMENT`, `APP_ENV`, or equivalent.
3. Kubernetes namespace when manifests clearly map namespaces to environments.
4. Docker or Compose build args such as `TARGET`, `ENV`, or `ENVIRONMENT`.

Do not silently default production telemetry to `development` or local telemetry to `production`. If unresolved for deployment config, use a deploy-time variable such as `${DEPLOYMENT_ENVIRONMENT}` and document that operators must set it.

## `service.namespace`

Check in order:

1. Existing `service.namespace` in `OTEL_RESOURCE_ATTRIBUTES`.
2. Monorepo grouping directory, such as `apps/web/checkout`.
3. Product or organization prefix if the repository naming makes it obvious.

Omit `service.namespace` if the project has no real grouping concept.

## `service.instance.id`

Generate automatically; do not ask the user.

- Use a UUID v4 generated at process startup for most services.
- Use a UUID v5 derived from an inherent unique value, such as Kubernetes pod UID, only when a deterministic identifier is required.
- The value must be stable for the lifetime of the process and unique per worker process.
- Do not use `hostname`; it can collide across containers, workers, or recycled infrastructure.

## OTLP Endpoint

For local development, run `everr local status` and use the returned `otlp:` URL. Do not guess a localhost port.

For production, use Everr hosted ingest base endpoint: `https://ingest.everr.dev/`

## Authentication

For local collector endpoints, no application auth header is normally needed.

For production Everr ingest:

- Store the ingest key in the deployment secret manager.
- Use `EVERR_INGEST_KEY` by convention.
- Set `Authorization: Bearer <ingest-key>` server-side only.
- Never commit keys, print keys, invent keys, or expose `EVERR_INGEST_KEY` in browser bundles.

Browser production telemetry authenticates with a **public** ingest key instead: origin-bound, ingest-only, safe in page source, injected through a client build variable such as `VITE_EVERR_PUBLIC_INGEST_KEY`. Never ship a secret key to the browser. See `rules/browser.md`.
