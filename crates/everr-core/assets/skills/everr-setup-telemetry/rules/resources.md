# Resource Attributes

Resource attributes identify what produced telemetry. They are attached to traces, logs, and metrics automatically, so they must be correct before adding signal-specific instrumentation.

## Required

### `service.name`

Every service must set `service.name`. Without it, telemetry appears as `unknown_service` and cannot be reliably queried.

Rules:

- Stable across deployments and restarts.
- Unique per logical service.
- Human-readable.
- Case-consistent across environments.
- Hardcoded in the setup module's resource config by default.

Example:

```typescript
resourceFromAttributes({
  'service.name': 'checkout-api',
});
```

## Recommended

### `service.namespace`

Use this to group related services under a product or domain. Omit it when no meaningful namespace exists.

### `deployment.environment.name`

Use this to separate production, staging, development, preview, and test telemetry. Inject it from deployment configuration instead of hardcoding it in application code.

### `service.version`

Use this for deployment tracking and regression comparison. Derive it from build metadata, tags, commit SHAs, or CI variables.

### `service.instance.id`

Use this to distinguish one running process or worker from another. Generate it at startup or inject an opaque deployment-platform identifier. Do not reuse the same value across workers.

## Environment Variable Shape

Hardcode `service.name` in the setup module and use deployment variables or resource attributes for the rest:

```bash
OTEL_RESOURCE_ATTRIBUTES=service.version=${SERVICE_VERSION},deployment.environment.name=${DEPLOYMENT_ENVIRONMENT}
```

For local debug runs, a local version value such as `local-dev` is acceptable if it is clearly local. For production, use a build/deploy value.

## Anti-Patterns

- Missing `service.name`.
- Different service-name casing by environment.
- Hardcoded `service.version` that does not change with deployments.
- Missing `deployment.environment.name`, causing environments to mix.
- Reusing the same `service.instance.id` across replicas or worker processes.
- Putting secrets, hostnames, pod names, raw user identifiers, or request payloads in resource attributes.
