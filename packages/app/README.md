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
