# Self-hosted application

`@everr/app` is the complete self-hosted application and the base for
`@everr/app-cloud`. It owns shared product features and the defaults needed to run
one workspace. Cloud composes those features and supplies its own policy and
cloud capabilities. The app must remain usable without importing or depending
on cloud.

For installation, configuration, deployment, and account recovery, see the
[deployment guide](../../deploy/README.md). For migration ownership, upgrade
steps, and database compatibility, see [DATABASE-MIGRATIONS.md](../../DATABASE-MIGRATIONS.md).

## Ownership

Shared features own their behavior and server-side authorization. Application
specific decisions enter through typed contracts in `src/composition`, exported
from `@everr/app/composition`. Each application provides adapters in its own
`src/app/composition` directory. Keep contracts type-only so importing a
contract does not load an application's implementation.

The self-hosted app owns the single-workspace installation flow, its default
identity and retention policies, and the shared feature implementations. Cloud
owns billing, usage metering, tenant provisioning, commercial policy, and its
Polar integration. Shared code should depend on the narrow contract for the
behavior it needs, not on cloud modules or application implementation paths.

Server responsibilities are separated by workflow: runtime manages migrations
and workers; entry handles installation, signup, and guarded organization
entry; deployment configuration provides the ingest endpoint; identity owns
authentication and membership lifecycle behavior, including shared endpoint
guards. Account preflight stays alongside identity. After membership validation,
`getActiveOrganizationAccess` calls `getOrganizationEntryRedirect(session)` and
applies the returned destination while preserving `returnTo`. Cloud owns
organization creation cookies and continuation behavior. Identity adapters may
implement `beforeMembershipMutation` for lock acquisition and
`beforeMembershipChange` or `afterMembershipChange` for application policy;
creation-only organization hooks remain separate. Shared endpoint guards remain
in place.

## Extending the application

- Use ordinary component props and `children` when adding content to a shared
  component. For example, account composition keeps shared profile and session
  behavior while supplying the application's account-lifecycle action:

  ```tsx
  account: (props) => (
    <AccountSettings {...props}>
      <AccountDeletion />
    </AccountSettings>
  ),
  ```

  Keep shared authorization checks around actions restricted to administrators
  or signed-in users.
- Compose a page when an application needs different data loading or rendering.
  `ApplicationPages.members` can provide both. Its `load` function may prefetch
  data, and its component owns rendering:

  ```tsx
  members: {
    async load({ queryClient, organizationId }) {
      await queryClient.fetchQuery(membersPolicy(organizationId));
    },
    component: MembersPage,
  },
  ```

  Shared routes continue to own authentication and authorization guards.
- Register new application routes explicitly in `AppComposition.routes`. A route
  declaration names its mount point, URL path, and source file:

  ```ts
  import { resolve } from "node:path";
  import type { AppComposition } from "@everr/app/build/composition";

  export const composition: AppComposition = {
    directory: import.meta.dirname,
    routes: {
      signedIn: [
        {
          type: "route",
          path: "settings",
          file: resolve(import.meta.dirname, "src/routes/settings.tsx"),
        },
      ],
    },
  };
  ```

  Shared routes retain file-based discovery. After changing routes, regenerate
  the application's checked-in TanStack route tree by running its development
  server or build. Do not add a component or feature registry for contributions.
- Keep application policy in its adapter. Shared identity code owns membership
  endpoint quirks and normalizes lifecycle behavior before invoking application
  hooks, so an adapter cannot replace the shared membership and deletion guards.

Each application's `tsconfig.json` selects a complete set of named
`@composition/*` modules. Vite and Vitest use the same selection. The root
`pnpm check:boundaries` command checks package imports and composition contracts.

Navigation uses the selected application's generated TanStack route types. Use
literal route patterns with `params` for dynamic destinations. Shared navigation
lists accept only parameter-free `ApplicationPath` values; `RailRow` preserves
TanStack's route, params, and search inference. Breadcrumb segments accept a
`link` element so each route can declare a fully typed `<Link />` directly.
Compile-only navigation checks run with both applications' `typecheck` commands
and verify that invalid routes, params, search, and cross-application links fail.

When changing migration behavior or supported upgrade paths, update the
[migration guide](../../DATABASE-MIGRATIONS.md). When changing installation,
deployment, or recovery procedures, update the
[deployment guide](../../deploy/README.md).

## Local development

From the repository root, install dependencies and start the self-hosted app:

```sh
pnpm install
pnpm --filter @everr/app dev
```

Useful package commands include `pnpm --filter @everr/app build`,
`pnpm --filter @everr/app typecheck`, and
`pnpm --filter @everr/app test:ci`. Run `pnpm check:boundaries` from the
repository root to check package imports.
