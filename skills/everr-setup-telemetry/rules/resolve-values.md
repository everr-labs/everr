# Resolve Configuration Values

OpenTelemetry setup needs project-specific values. Inspect the codebase before asking the user and keep placeholders out of working config.

For service names, follow the identity decision below. For other values, use the first source that yields a result. If no source matches and the value is required, ask the user or leave an explicit deploy-time variable reference.

## `service.name`

1. Preserve a name explicitly chosen by the user or already established in working OTel setup or deployment configuration, even if it differs from the convention below. Treat SDK fallbacks such as `unknown_service` and unconfigured example placeholders as unresolved. If existing sources conflict, surface the conflict in the plan and resolve it with the user before implementation.
2. For each unresolved identity, choose `<project>.<service>` from the repository's actual product and service boundaries:
   - **Project:** use the product/project identity established in repository documentation and deployment configuration. Package/build metadata and directory names are supporting evidence, not automatic service names. A package scope may identify an organization rather than the project.
   - **Service:** use the runnable app's responsibility, such as `web`, `api`, `import-worker`, or `desktop`. Distinguish services with the same role by their domain, such as `billing-api` and `catalog-api`. Keep browser and server identities distinct where the runtime rules require it, even within one package. Shared libraries use their host service's identity.
   - Normalize each component to lowercase kebab-case and join them with a dot. Keep the name stable across environments, destinations, deployments, and restarts; use the corresponding resource attributes for environment, version, and instance identity.
3. Present the exact name, runtime/path mapping, and rationale in the implementation plan, including preserved names. For example, a project documented as Acme Shop with packages named `@acme/app`, `server`, and `jobs` could use `acme-shop.web`, `acme-shop.api`, and `acme-shop.import-worker` when inspection confirms those roles. If project identity or service boundaries remain ambiguous, ask a focused question instead of falling back to a manifest or directory name.
4. Confirm proposed names through the planning step before applying them. Hardcode the resolved default in the telemetry setup module and use the same case-sensitive value in every environment, signal, query, and documentation example. Preserve existing configuration overrides when extending a working setup.

The dotted form is an Everr setup convention for new names, not an OpenTelemetry requirement. `service.namespace` remains a separate optional grouping attribute; setting it does not replace the full chosen `service.name`.

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

For the local collector destination, run `everr local status` and use the returned `otlp:` URL. Do not guess a localhost port.

For the cloud destination, use `https://ingest.everr.dev/` in the environments selected for cloud export. The destination does not determine `deployment.environment.name`. Preserve configuration for environments outside the task.

## Authentication

For local collector endpoints, no application auth header is normally needed.

For cloud ingest from a server or backend:

- Load the ingest key from the secret manager, or the local environment for development/test cloud export.
- Use `EVERR_INGEST_KEY` by convention.
- Set `Authorization: Bearer <ingest-key>` server-side only.
- Never commit keys, print keys, invent keys, or expose `EVERR_INGEST_KEY` in browser bundles.

Browser cloud telemetry authenticates with a **public** ingest key instead: origin-bound, ingest-only, safe in page source, injected through a client build variable such as `VITE_EVERR_PUBLIC_INGEST_KEY`. Never ship a secret key to the browser. See [Browser](browser.md#key-model).

For cloud credentials and CLI query access, follow [Cloud setup](../references/cloud-setup.md). Local-only setup requires neither cloud login nor an ingest key.
