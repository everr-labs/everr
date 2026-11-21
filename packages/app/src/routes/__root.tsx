import { entry } from "@composition/entry";

import { getGithubConfiguration } from "#app/integrations/github/configuration.ts";
import { socialProviders } from "#app/lib/auth-providers.server.ts";
import { mailer } from "#app/lib/mailer.server.ts";
import {
  revalidateRootAccess,
  rootContextKey,
  routeAccessQuery,
} from "#app/lib/route-access-cache.ts";
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
import { focusManager, type QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { useEffect } from "react";
import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import appCss from "#app/styles/app.css?url";
import { CONSENT_COOKIE, isConsentDecision } from "#app/telemetry/consent.ts";
import { ConsentGate } from "#app/telemetry/consent-gate.tsx";
import type { RouterContext } from "../router";

// The route context is readable by any script on the page and is handed from
// the server render to the browser, so it never carries the session token.
function withoutToken<T extends { token: string }>({ token: _token, ...session }: T) {
  return session;
}

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
      session?.session && session?.user
        ? { user: session.user, session: withoutToken(session.session) }
        : null,
    consent: isConsentDecision(consentValue) ? consentValue : undefined,
  };
});

const rootContextQuery = routeAccessQuery(rootContextKey, () => getRootContext());

export type RootContext = Awaited<ReturnType<typeof getRootContext>>;

// Checked on page loads only. Self-hosted setup is the only entry redirect:
// before it nobody can sign in, so the only way in is opening a URL, and
// nothing in the app links to `/setup`.
async function redirectToEntry(pathname: string) {
  const entryRedirect = await entry.getEntryRedirect?.(pathname);
  if (entryRedirect)
    throw "href" in entryRedirect
      ? redirect({ href: entryRedirect.href, replace: true })
      : redirect({ to: entryRedirect.to, replace: true });
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
      const [rootContext] = await Promise.all([
        context.queryClient.ensureQueryData(rootContextQuery),
        redirectToEntry(location.pathname),
      ]);
      return rootContext;
    })
    .client(({ context }: RootBeforeLoadOptions) =>
      context.queryClient.ensureQueryData(rootContextQuery),
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

  useEffect(() => {
    let checking = false;
    return focusManager.subscribe((focused) => {
      if (!focused || checking) return;
      checking = true;
      revalidateRootAccess(queryClient, router, () => getRootContext())
        // Offline or a failed request: the next focus or data request checks again.
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    });
  }, [queryClient, router]);

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
