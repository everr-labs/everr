# Application composition contracts

This directory defines the interfaces shared features use for behavior that
differs between the self-hosted and Cloud applications. The self-hosted app owns
the shared features; Cloud composes them through these contracts without adding
Cloud dependencies or deployment checks to shared code.

Contracts describe capabilities such as application startup, identity policy,
storage access, entry routing, and page composition. For example,
`ApplicationDeployment` exposes the ingest endpoint advertised by onboarding and
CLI discovery. Each application supplies its own value.

## Contracts and implementations

Files here contain interfaces, type aliases, and type-only imports/exports.
Export public contracts from `index.ts`, exposed as `@everr/app/composition`.
Keeping this directory type-only lets callers use its contracts without loading
environment configuration, database clients, or application startup code.

Implementations live in each application's `src/app/composition` directory:

- [Self-hosted adapters](../app/composition).
- [Cloud adapters](../../../cloud/src/app/composition).

Each application's `tsconfig.json` maps named `@composition/*` imports to its
adapters. Shared code consumes the selected adapter, for example:

```ts
import { deployment } from "@composition/deployment";

const ingestEndpoint = deployment.ingestEndpoint;
```

Type-only contracts belong here; functions, configured objects, and other runtime
values belong in the implementation modules. `pnpm check:boundaries` enforces
this distinction and the import boundaries in `.oxlintrc.json`.

## Extending composition

Keep shared behavior and authorization inside the feature that owns them. Add a
contract member when a feature needs an application-owned decision or capability,
then implement it in both applications. Use ordinary props and children for UI
additions, and page composition when loading or rendering differs.

See the [app ownership and extension guide](../../README.md) for the complete
composition conventions.
