import { entry } from "@composition/entry";

import { getGithubConfiguration } from "#app/integrations/github/configuration.ts";
import { socialProviders } from "#app/lib/auth-providers.server.ts";
import { mailer } from "#app/lib/mailer.server.ts";
import { entryRedirectKey, rootContextKey, routeAccessQuery } from "#app/lib/route-access-cache.ts";
import { getSession } from "#app/lib/session.server.ts";
// This import has an effect at load. It starts the error capture of the browser
// when the client build loads. It does nothing during the SSR and when the app
// has no configuration. Refer to telemetry/client.
import "#app/telemetry/client.ts";
import favicon from "@everr/ui/assets/favicon.svg?url";
import { Toaster } from "@everr/ui/components/sonner";
import { TooltipProvider } from "@everr/ui/components/tooltip";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  redirect,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import appCss from "#app/styles/app.css?url";
import { CONSENT_COOKIE, isConsentDecision } from "#app/telemetry/consent.ts";
import { ConsentGate } from "#app/telemetry/consent-gate.tsx";
import type { RouterContext } from "../router";

// Load session and consent together so auth guards see the same session.
const getRootContext = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getSession({
    headers: getRequestHeaders(),
  });
  const consentValue = getCookie(CONSENT_COOKIE);
  return {
    emailEnabled: mailer !== null,
    googleSignInEnabled: Boolean(socialProviders?.google),
    githubEnabled: Boolean(getGithubConfiguration()),
    session:
      session?.session && session?.user ? { user: session.user, session: session.session } : null,
    consent: isConsentDecision(consentValue) ? consentValue : undefined,
  };
});

// Fetched apart from the root context because it depends on the path: a
// search-only navigation reuses both, a new path asks for its own entry once.
const getEntryRedirect = createServerFn({ method: "GET" })
  .validator((pathname: string) => pathname)
  .handler(async ({ data: pathname }) => (await entry.getEntryRedirect(pathname)) ?? null);

const rootContextQuery = routeAccessQuery(rootContextKey, () => getRootContext());
const entryRedirectQuery = (pathname: string) =>
  routeAccessQuery(entryRedirectKey(pathname), () => getEntryRedirect({ data: pathname }));

export type RootAccess = {
  pathname: string;
  context: Awaited<ReturnType<typeof getRootContext>> | undefined;
  entryRedirect: Awaited<ReturnType<typeof getEntryRedirect>> | undefined;
};

async function loadRootContext(queryClient: QueryClient, pathname: string) {
  const [context, entryRedirect] = await Promise.all([
    queryClient.ensureQueryData(rootContextQuery),
    queryClient.ensureQueryData(entryRedirectQuery(pathname)),
  ]);
  if (entryRedirect)
    throw "href" in entryRedirect
      ? redirect({ href: entryRedirect.href, replace: true })
      : redirect({ to: entryRedirect.to, replace: true });
  return context;
}

type RootBeforeLoadOptions = {
  location: { pathname: string };
  context: { queryClient: QueryClient };
};

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: createIsomorphicFn()
    .server(async ({ location, context }: RootBeforeLoadOptions) => {
      if (process.env.TSS_PRERENDERING === "true")
        return {
          session: null,
          consent: undefined,
          emailEnabled: false,
          googleSignInEnabled: false,
          githubEnabled: false,
        };
      return loadRootContext(context.queryClient, location.pathname);
    })
    .client(({ location, context }: RootBeforeLoadOptions) =>
      loadRootContext(context.queryClient, location.pathname),
    ),
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Everr",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        href: "/favicon.ico",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: favicon,
      },
    ],
  }),
  shellComponent: ShellComponent,
  component: Component,
});

function Component() {
  const { queryClient, consent } = Route.useRouteContext();
  const router = useRouter();

  // Mount consent state only after the browser has loaded the real context.
  if (router.isShell()) return <Outlet />;

  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <ConsentGate initialConsent={consent}>
          <Outlet />
        </ConsentGate>
        <TanStackDevtools
          config={{ position: "bottom-right" }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            {
              name: "React Query",
              render: <ReactQueryDevtoolsPanel />,
            },
            {
              name: "React Form",
              render: <FormDevtoolsPanel />,
            },
          ]}
        />
      </QueryClientProvider>
    </TooltipProvider>
  );
}

function ShellComponent({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}
