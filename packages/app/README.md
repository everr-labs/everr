Welcome to your new TanStack app! 

# Getting Started

To run this application:

```bash
pnpm install
pnpm dev
```

To preview and edit the transactional email templates, run `pnpm dev:email` from
this directory. The preview opens at `http://localhost:3000` (or the next
available port) and reads templates from `src/emails`. Verification, password
reset, and invitation emails use these templates for HTML and include a plain
text fallback. Style the templates with Tailwind utility classes through React
Email's `Tailwind` component and `pixelBasedPreset`. The shared branding and
layout live in `src/lib/email-layout.tsx`. Dedicated copies of the logo and
social icons live in `public/email` and are available to the preview through
`src/emails/static`.

# Organization data access setup

The organization adapter atomically records provisioning intent alongside creation.
Deletion atomically records cleanup intent alongside the organization and
Postgres-resource deletion. A failed enqueue rolls the transaction back.
Organization creation enqueues `clickhouse/provision-organization` in Graphile
Worker. New organizations start with the server-owned `metadata.clickhouseReady`
flag set to false. The worker creates the SQL API user, grants its role, creates all
row policies, and authenticates a query before setting readiness to true.
Provisioning and deletion share a named queue per organization. Their dedicated
runner reserves two execution slots and its own Postgres pool, so alerting,
GitHub, and maintenance jobs cannot delay setup. Both retry up to 1,000 times,
with short initial delays and a 30-second cap. Jitter spreads retries out.
The worker reschedules failed lifecycle jobs through Graphile's public API
after their failure is persisted. Startup and the periodic scan bring forward
retries left with longer delays by an older deployment or an interrupted
reschedule.
Each runner has an independent supervisor that restarts startup and runtime
failures every five seconds. A retry-recovery failure is logged and does not
stop either runner. Organization handlers and the scanner use their reserved
Postgres pool too.
SIGTERM and SIGINT drain both runners before flushing telemetry. ClickHouse
requests receive Graphile's shutdown abort signal after five seconds, allowing
normal shutdown to release job and queue locks. Hard kills can leave locks
behind. Inspect `graphile_worker.jobs`, confirm the owning workers are dead,
and use Graphile's `force_unlock_workers` only for those worker IDs. Never
unlock a live worker.
A scan every minute recovers organizations whose initial enqueue was
missed, without resetting pending jobs' attempt counts or retry schedules.

Email signup creates its automatic Hobby organization after the user and session
transaction commits, then selects it for that session. Users with pending
invitations keep their invitation flow instead of getting a personal organization.
After organization creation commits, signup waits up to five seconds for its
dedicated provisioning job to finish, checking readiness every 100ms. Healthy
signups return ready. The wait does not execute
ClickHouse statements itself, so provisioning and deletion remain serialized
by the per-organization queue. A timeout or failed status read leaves the
committed job running and returns the normal signup session. The deadline also
bounds a slow Postgres lookup, and an expired wait stops polling.

Authentication, invitations, and organization creation share the `_welcome`
layout. Its `_signedIn` guard requires a session, and its `_organization`
guard verifies membership for setup and recovery. The app's `_authenticated`
guard requires only a session, so account settings remain accessible without
an organization. Membership, subscription access, and provisioning have
separate pathless guards. Billing, checkout confirmation, and device approval
remain outside the data-page readiness guard.

Authentication resumes the validated original destination. Automatic Hobby
creation records a short-lived encrypted continuation cookie bound to the
session and organization. The organization guard sends that creation through
setup even if provisioning is already complete, then setup clears the cookie.
Invited users return to their invitation and join the existing organization.
Explicit creation uses the inline name and plan step, followed by provisioning;
Pro creation continues through hosted checkout and setup.

Only organization creation has the minimum 2.5-second animation. Existing
pending organizations see `/organization-pending`, which polls every three
seconds and resumes their destination immediately when ready. The minimum
creation duration never bypasses the real readiness check. Organization
authorization loads readiness once per request; data handlers reject pending
setup before contacting ClickHouse. The query helpers do not read Postgres.
CLI SQL returns HTTP 503 and `Retry-After: 5`.

Provisioning state uses the existing metadata column, so no schema change or
migration is needed. Organizations without the flag remain ready. Metadata
updates preserve the server-owned flag atomically, and provisioning changes
only that flag while retaining other metadata.

To repair an existing organization known to have incomplete SQL API
provisioning, mark its metadata pending. The next scan enqueues it:

```sql
UPDATE organization
SET metadata = (coalesce(metadata::jsonb, '{}'::jsonb)
  || '{"clickhouseReady":false}'::jsonb)::text
WHERE id = 'organization-id';
```

After provisioning exhausts its 1,000 attempts, the setup page stops polling
and offers Try again. This resets the existing organization's job to a fresh
retry budget. Status-request failures remain silent. For exhausted cleanup
jobs, repair the underlying issue and use Graphile's `reschedule_jobs` to reset
the attempts and schedule a new run.
Scans deliberately leave exhausted jobs in place for investigation. Inspect
`graphile_worker.jobs` for retry state and `clickhouse.organization.provision`
spans for the organization ID and failure details.

Every failed organization job attempt emits an ERROR log with organization,
trace, job ID, attempt, maximum attempts, exception details, and exhaustion state.
The scanner emits a health snapshot every minute and one aggregate ERROR log
when organizations have been pending longer than two minutes. Worker startup, runtime, retry recovery, and
reschedule failures also emit ERROR logs. Pending UI/CLI responses remain expected
control flow, so user polling does not flood exception telemetry.

Deployment alerts and runbooks are maintained in the `everr-deploy` repository.

# Building For Production

To build this application for production:

```bash
pnpm build
```

## Testing

This project uses [Vitest](https://vitest.dev/) for testing. You can run the tests with:

```bash
pnpm test
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.


## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:


```bash
pnpm lint
pnpm format
pnpm check
```

## Routing
This project uses [TanStack Router](https://tanstack.com/router). The initial setup is a file based router. Which means that the routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add another a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you use the `<Outlet />` component.

Here is an example layout that includes a header:

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { Link } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <>
      <header>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
        </nav>
      </header>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
})
```

The `<TanStackRouterDevtools />` component is not required so you can remove it if you don't want it in your layout.

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).


## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people",
  loader: async () => {
    const response = await fetch("https://swapi.dev/api/people");
    return response.json() as Promise<{
      results: {
        name: string;
      }[];
    }>;
  },
  component: () => {
    const data = peopleRoute.useLoaderData();
    return (
      <ul>
        {data.results.map((person) => (
          <li key={person.name}>{person.name}</li>
        ))}
      </ul>
    );
  },
});
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

### React-Query

React-Query is an excellent addition or alternative to route loading and integrating it into you application is a breeze.

First add your dependencies:

```bash
pnpm add @tanstack/react-query @tanstack/react-query-devtools
```

Next we'll need to create a query client and provider. We recommend putting those in `main.tsx`.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ...

const queryClient = new QueryClient();

// ...

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);

  root.render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

You can also add TanStack Query Devtools to the root route (optional).

```tsx
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <ReactQueryDevtools buttonPosition="top-right" />
      <TanStackRouterDevtools />
    </>
  ),
});
```

Now you can use `useQuery` to fetch your data.

```tsx
import { useQuery } from "@tanstack/react-query";

import "./App.css";

function App() {
  const { data } = useQuery({
    queryKey: ["people"],
    queryFn: () =>
      fetch("https://swapi.dev/api/people")
        .then((res) => res.json())
        .then((data) => data.results as { name: string }[]),
    initialData: [],
  });

  return (
    <div>
      <ul>
        {data.map((person) => (
          <li key={person.name}>{person.name}</li>
        ))}
      </ul>
    </div>
  );
}

export default App;
```

You can find out everything you need to know on how to use React-Query in the [React-Query documentation](https://tanstack.com/query/latest/docs/framework/react/overview).

## State Management

Another common requirement for React applications is state management. There are many options for state management in React. TanStack Store provides a great starting point for your project.

First you need to add TanStack Store as a dependency:

```bash
pnpm add @tanstack/store
```

Now let's create a simple counter in the `src/App.tsx` file as a demonstration.

```tsx
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import "./App.css";

const countStore = new Store(0);

function App() {
  const count = useStore(countStore);
  return (
    <div>
      <button onClick={() => countStore.setState((n) => n + 1)}>
        Increment - {count}
      </button>
    </div>
  );
}

export default App;
```

One of the many nice features of TanStack Store is the ability to derive state from other state. That derived state will update when the base state updates.

Let's check this out by doubling the count using derived state.

```tsx
import { useStore } from "@tanstack/react-store";
import { Store, Derived } from "@tanstack/store";
import "./App.css";

const countStore = new Store(0);

const doubledStore = new Derived({
  fn: () => countStore.state * 2,
  deps: [countStore],
});
doubledStore.mount();

function App() {
  const count = useStore(countStore);
  const doubledCount = useStore(doubledStore);

  return (
    <div>
      <button onClick={() => countStore.setState((n) => n + 1)}>
        Increment - {count}
      </button>
      <div>Doubled - {doubledCount}</div>
    </div>
  );
}

export default App;
```

We use the `Derived` class to create a new store that is derived from another store. The `Derived` class has a `mount` method that will start the derived store updating.

Once we've created the derived store we can use it in the `App` component just like we would any other store using the `useStore` hook.

You can find out everything you need to know on how to use TanStack Store in the [TanStack Store documentation](https://tanstack.com/store/latest).

# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

# Cloud and self-hosted builds

The deployment is selected at compilation time. There is no runtime deployment
switch. Both builds use the same product, authentication, organization permissions,
and database schema.

```bash
pnpm --filter @everr/app dev        # Everr
pnpm --filter @everr/app build
pnpm --filter @everr/app dev:cloud  # Everr Cloud
pnpm --filter @everr/app build:cloud
```

`packages/app` is the default Everr product. `dev` and `build` select its
self-hostable composition; Cloud is selected explicitly with `dev:cloud` and
`build:cloud`. The `*:self-hosted` commands remain available as aliases for the
product composition. Start either compiled artifact with the usual `start` command.
Each build replaces `packages/app/.output`, so build separate artifacts when
shipping both variants.

For Docker, pass `--build-arg EVERR_BUILD_TARGET=self-hosted` to the app Dockerfile.
The build argument defaults to `cloud`; it is not a runtime environment variable.

`vite.app.ts` resolves `@app/*` to one implementation:

- `src/cloud/app`: selects subscription policy, Polar configuration, billing
  auth extensions, navigation, and access redirects. Billing server functions, checkout completion,
  screens, and their tests live under `src/cloud`.
- `src/app`: one installation workspace, invitation-only onboarding, collaboration
  without subscriptions, and no billing auth extensions.
- `src/product`: shared policy contracts and membership enforcement. Membership
  roles still determine which users may invite, administer, or delete resources.

A self-hosted build neither validates Polar credentials nor imports the Polar SDK
or cloud implementation. The build checks its module graph and fails if those
imports cross the seam. Other runtime configuration, including Postgres,
ClickHouse, authentication, and email, is still required. GitHub is optional.

Self-hosted retention defaults to 30 days for all signals and alert
history. Cloud retention remains defined by the existing plans. Self-hosted
organizations use the `self-hosted` value in the existing text `plan` column for
compatibility with the shared schema; they are not free or paid Cloud organizations.
Moving an existing installation to Cloud requires an explicit plan assignment.
No migration is generated by this change.

Validate both variants:

```bash
pnpm --filter @everr/app typecheck
pnpm --filter @everr/app typecheck:cloud
pnpm --filter @everr/app test:self-hosted
pnpm --filter @everr/app test:cloud
```

The normal test suite uses the cloud implementation. The self-hosted suite selects
its implementation through the same alias as the production build.

### Session workspace recovery

Shared application authentication reads sessions through `getSession` in
`src/lib/session.server.ts`. It validates the selected workspace's membership.
When the selection is missing or no longer valid, it selects and persists the
user's sole membership. With no memberships or multiple memberships, it leaves
the session unselected. Recovery never creates a workspace or grants membership.

The default app retains its single-workspace invariant and access page; Cloud
retains its organization chooser. Ingestion keys and worker jobs continue using
their explicit workspace IDs independently of browser sessions.

### Public connection settings

Set `EVERR_PUBLIC_INGEST_URL` to the public OTLP/HTTP base URL of your collector.
The default app displays this URL during onboarding. It does not fall back to
Everr Cloud when unset; users are asked to contact their administrator. Cloud
keeps its hosted ingestion endpoint. This setting describes the destination for
users' applications, not the web app's own telemetry exporter.

Google sign-in is shown only when both `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are configured. The browser receives only the provider's
availability, never its credentials. Both settings are read at server startup.

### Single-workspace setup

The default app supports exactly one workspace per installation. On a fresh
installation, browser visits open `/setup`. Configure `EVERR_SETUP_TOKEN` with
an operator-generated random secret of at least 32 characters before starting
the app. Enter that token, a workspace name, and the initial owner's name, email,
and password (at least 8 characters) on the setup screen.

Setup atomically creates the owner, password credentials, workspace, owner
membership, and provisioning job. Concurrent requests cannot create a second
workspace. After setup, the owner signs in and continues through telemetry
configuration. The setup token can then be removed from runtime configuration;
setup remains closed while the workspace exists.

If setup fails before committing, no owner, workspace, or provisioning job is
left behind; submit the form again after resolving the error. If the connection
is lost after committing, or automatic sign-in fails, sign in with the owner
credentials entered during setup. Repeating setup cannot create another workspace.
Provisioning resumes through the persisted job after a restart. If its retries
are exhausted, the provisioning screen offers **Try again** for the same
workspace. Do not delete the workspace to restart provisioning.

Later users need an invitation. Public signup and automatic personal workspace
creation are disabled. Invited users verify their email before accepting an
invitation. Existing members sign in directly; users without membership see
access instructions. The product has no organization switcher or creation action.
Direct organization creation and deletion are rejected server-side. The last owner
must transfer ownership before deleting their account.

An existing database containing one organization uses that workspace. Databases
with multiple organizations are rejected with an operator-facing error; this
change does not merge, select, or delete existing organizations. Keep such an
installation on the previous build until its data has been migrated deliberately.
No schema change or generated migration is needed. Cloud retains its existing
organization creation, selection, and signup flows.

### Optional product integrations

GitHub is shared product functionality, available in both cloud and self-hosted
builds. Its implementation lives in `src/integrations/github`: configuration,
installation handlers, authenticated data functions, setup UI, and event jobs.
The files under `routes/` only connect those handlers and screens to the router.

Both `cloud/app/integrations.ts` and
`app/integrations.ts` register the integration's worker tasks.
The general worker consumes `@app/integrations`, without importing GitHub
jobs directly. Disabled integrations contribute no tasks. Existing queued GitHub
jobs remain in the database and can resume when the integration is enabled again.

GitHub configuration is independent of the global product environment:

- With none of its settings present, GitHub is disabled.
- Existing complete configuration enables it automatically in either edition.
- `EVERR_GITHUB_ENABLED=false` explicitly disables it, even with credentials present.
- `EVERR_GITHUB_ENABLED=true` requires a complete configuration. Partial
  configuration also fails validation rather than silently disabling the integration.

Required integration settings are `GITHUB_APP_INSTALL_URL`,
`GITHUB_APP_STATE_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, and `INGRESS_COLLECTOR_URL`. `INGRESS_SOURCE` is no
longer required by the app. Restart the app after changing these settings.

The UI receives only availability, never integration credentials. When disabled,
the GitHub navigation entry is hidden and its page, installation endpoints,
webhook, and data operations are unavailable. Existing organization authorization
and webhook signature checks still apply when enabled.

The deployment choice is compiled into the artifact; optional integration
configuration is supplied at runtime. GitHub remains included in both artifacts.
Database tables and organization-data cleanup remain shared, so disabling an
integration does not abandon its stored data or prevent organization deletion.


### Retention policy composition

`product/retention.ts` defines the plan-free retention contract.
`product/retention.server.ts` obtains the selected app policy and caches
it per organization for 30 seconds. The ingestion-key verifier, GitHub collector
forwarder, and alert-history writer all use this lookup.

Cloud plan mappings live exclusively in `cloud/retention.ts`. Existing windows
are unchanged: Hobby uses 14 days throughout; Pro uses 365 days for telemetry
and alert lifecycle history, and 30 days for alert evaluations.

Self-hosted policy reads operator settings from its app environment:

```sh
EVERR_RETENTION_DAYS=30
# Optional overrides; otherwise each inherits EVERR_RETENTION_DAYS.
EVERR_RETENTION_TRACES_DAYS=14
EVERR_RETENTION_LOGS_DAYS=7
EVERR_RETENTION_METRICS_DAYS=90
EVERR_RETENTION_ALERT_EVALUATIONS_DAYS=7
EVERR_RETENTION_ALERT_LIFECYCLE_DAYS=180
```

Supported windows are 1, 7, 14, 30, 90, 180, and 365 days. The finite set keeps
retention partition variants bounded (ClickHouse guidance:
`schema-partition-low-cardinality`). Zero, fractional values, and unlimited
retention are not supported. Settings apply to every organization on the
self-hosted instance and do not affect cloud builds.

Restart after changing settings. The existing collector cache can briefly retain
the previous values. Retention is stamped into rows at ingestion; changing policy
affects new writes and does not rewrite the TTL of existing rows. The existing
TTL enforcement stays unchanged (`schema-partition-lifecycle`); this change
requires no database migration.


### Source independence

The default production runtime needs Postgres, ClickHouse, authentication and
ingest-verification secrets, and SMTP configuration. Polar and Google credentials
are not required. GitHub jobs are registered only when its optional integration
is configured. The core workers run alerts, preview retention, and workspace
provisioning independently of those integrations.


Self-hosted source can typecheck, run its tests, and build with `src/cloud` absent. Billing server functions are not part of the
shared data interface and have no self-hosted stubs. Billing, checkout, and organization creation and selection routes
live entirely under `src/cloud/routes`; the product router does not register them.

`appRoutes()` in `vite.app.ts` composes TanStack physical route
directories at build time. The product uses `src/routes` plus `src/app/routes` (setup and workspace access), and generates
`src/routeTree.gen.ts`. Cloud combines the shared `src/routes` with `src/cloud/routes` and generates its own
`src/cloud/routeTree.gen.ts`. Its leaves inherit product authentication and
organization layouts. `@app/route-tree` selects the matching tree for the
single shared router factory. Builds do not overwrite each other's route types.

The organization menu renders `@app/navigation`; only Cloud contributes
the billing item. The app access guard calls `@app/app-access`; only Cloud
redirects suspended subscriptions to its recovery route. `@app/client` selects
the missing-workspace destination: `/access-required` for the product and
`/choose-organization` for Cloud. Creation, selection, and switching screens live
in `src/cloud/components`. Shared guards and provisioning do not depend on Cloud URLs.

`typecheck:self-hosted` checks production sources using the `@app/*` alias.
It excludes test roots and cloud roots, then examines the complete TypeScript
source graph, including imported types. Any cloud or Polar dependency fails the
check, even if TypeScript would otherwise follow it into an excluded directory.
`typecheck:cloud` covers Cloud and shared test sources; `test:self-hosted` executes the
self-hosted behavior tests with the matching alias. The existing Vite guard
independently checks the production build graph.

This proves source independence, not separate packaging: package manifests,
installed development dependencies, and database schema remain shared. Removing the cloud source does not yet produce a standalone repository
or a separately maintained dependency manifest.
