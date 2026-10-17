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

# Installation

The app manages one workspace. Configure PostgreSQL, ClickHouse, authentication
secrets, and the public app URL using `.env.example` as a reference. Local
settings can go in `.env.local`; shell environment variables take precedence.

```sh
pnpm --filter @everr/app dev
pnpm --filter @everr/app build
pnpm --filter @everr/app typecheck
pnpm --filter @everr/app test:ci
```

The production output is `.output`. PostgreSQL migrations in `drizzle`
run automatically at startup, or explicitly with `pnpm db:migrate`. Create the
database before starting the app. Use `packages/app/Dockerfile` for the image
and see [deployment instructions](../../deploy/README.md) for setup and account
recovery. The build includes `.output/server/recovery.mjs`.

### Single-workspace setup

The default app supports exactly one workspace per installation. On a fresh
installation, browser visits open `/setup`. The first person to complete setup
becomes the workspace owner. Enter a workspace name and the owner's name, email,
and password (at least 8 characters).

Setup atomically creates the owner, password credentials, workspace, and owner
membership. Concurrent requests cannot create a second
workspace. After setup, the owner signs in and continues through telemetry
configuration. Setup remains closed while the workspace exists.

If setup fails before committing, no owner or workspace is
left behind; submit the form again after resolving the error. If the connection
is lost after committing, or automatic sign-in fails, sign in with the owner
credentials entered during setup. Repeating setup cannot create another workspace.

Later users need an invitation. Public signup and automatic personal workspace
creation are disabled. Invited users can accept a valid invitation without
verifying their email. Acceptance does not mark the address as verified. Existing
members sign in directly; users without membership see access instructions. The product has no organization switcher or creation action.
Direct organization creation and deletion are rejected server-side. The last owner
must transfer ownership before deleting their account.

An existing database containing one organization uses that workspace. Databases
with multiple organizations are rejected with an operator-facing error; this
change does not merge, select, or delete existing organizations. Keep such an
installation on the previous build until its data has been migrated deliberately.


### Optional integrations

Email delivery requires `EMAIL_DSN` and `EMAIL_FROM`. Without email delivery,
admins can share invitation links and use the account recovery command. Google
sign-in is available when both Google credentials are configured.

GitHub is enabled by complete integration configuration. Set
`EVERR_GITHUB_ENABLED=false` to disable it. Setting it to `true` requires all
integration settings. Partial configuration fails validation. Disabled GitHub
integration hides its navigation and disables its endpoints and jobs.

Set `EVERR_PUBLIC_INGEST_URL` to the public collector URL shown in onboarding
and returned by CLI discovery. When unset, onboarding asks users to contact
their administrator.

### Retention policy composition

`product/retention.ts` defines the retention interface.
`lib/retention.server.ts` obtains the selected app policy and caches
it per organization for 30 seconds. The ingestion-key verifier, GitHub collector
forwarder, and alert-history writer all use this lookup.

Retention reads operator settings from the environment:

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
installation.

Restart after changing settings. The existing collector cache can briefly retain
the previous values. Retention is stamped into rows at ingestion; changing policy
affects new writes and does not rewrite the TTL of existing rows. The existing
TTL enforcement stays unchanged (`schema-partition-lifecycle`); this change
requires no database migration.


### Application telemetry

Development uses the local collector at `http://127.0.0.1:54318`. Production
requires an explicit endpoint. Configure `OTEL_EXPORTER_OTLP_ENDPOINT` for a
standard receiver, or `EVERR_INGEST_ENDPOINT` and `EVERR_INGEST_KEY` for an
authenticated Everr receiver. Browser telemetry uses `VITE_EVERR_INGEST_ENDPOINT`
and optionally `VITE_EVERR_PUBLIC_INGEST_KEY`.

## Application composition

Application behavior is supplied as typed values. The contracts live in
`src/product`: `ApplicationServer`, `ApplicationIdentity`,
`ApplicationNavigation`, `ApplicationDashboards`, `Product`, `ProductClient`,
and `ProductUI`. Implementations use `satisfies` or an explicit type annotation
so missing methods and incompatible signatures fail typechecking.

The build selects explicit server, client, policy, navigation, dashboard, page,
and UI entry modules through `AppComposition.modules`. Implementations need not
have matching filenames or directories. The same declaration generates
`tsconfig.composition.json`; do not edit its paths manually. Builds, tests, and
typechecks prepare the composition, and typechecks generate the route tree
without requiring a prior production build.

`AppComposition.routes` registers extra routes under named attachment points:
`welcome`, `signedIn`, and `organizationDashboard`. Each registration provides a
URL path or layout ID and its source file. TanStack virtual routes preserve
loading, type generation, and route code splitting. Six explicitly registered
shared layout files use the normal `-` ignore prefix so physical discovery does
not register them twice. Other shared routes retain file-based discovery.

For example, an application can register a page without reproducing internal
route directories:

```ts
routes: {
  signedIn: [
    { type: "route", path: "settings", file: resolve(directory, "src/settings.tsx") },
  ],
}
```

`ApplicationPages.members` replaces page loading and rendering while preserving
the route's existing authentication and admin guards. `ProductUI` declares menu
and welcome-action contributions, a sign-in footer, account-deletion UI, and
device-login recovery content. Defaults describe an ordinary installation.
Shared feature components own reusable behavior; application compositions own
their additional actions and policy decisions. Server authorization remains
independent of these UI decisions.

Run `pnpm check:boundaries` from the repository root to enforce source-package
imports with Oxlint. The pre-commit hook and CI run this check:
relative imports stay in their package, `@/` stays private to its owning package,
and cross-package imports use declared exports. Re-exports, type imports,
literal dynamic imports, and test mocks are checked too. Generated route trees
are exempt because TanStack owns their cross-package imports. Documentation
assets imported with `.md?raw` are allowed. These checks prevent accidental
private-source coupling; they are not a security sandbox.

Server identity and background work load on demand, so importing storage or
public endpoint settings does not initialize authentication or workers. Browser
navigation stays separate from server behavior. Dashboard documents also have
their own entry to keep the small dashboard menu manifest lightweight.
