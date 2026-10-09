// This import has an effect at load. It starts the error capture of the browser
// when the client build loads. It does nothing during the SSR and when the app
// has no configuration. Refer to telemetry/client.
import "@/telemetry/client";
import favicon from "@everr/ui/assets/favicon.svg?url";
import { Toaster } from "@everr/ui/components/sonner";
import { TooltipProvider } from "@everr/ui/components/tooltip";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth.server";
import {
  ORGANIZATION_CREATION_COOKIE,
  readCreatedOrganizationId,
} from "@/lib/organization-creation-continuation.server";
import appCss from "@/styles/app.css?url";
import { CONSENT_COOKIE, isConsentDecision } from "@/telemetry/consent";
import { ConsentGate } from "@/telemetry/consent-gate";
import type { RouterContext } from "../router";

// Load session and consent together so auth guards see the same session.
const getRootContext = createServerFn({ method: "GET" }).handler(async () => {
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
  });
  const consentValue = getCookie(CONSENT_COOKIE);

  return {
    createdOrganizationId: await readCreatedOrganizationId(
      getCookie(ORGANIZATION_CREATION_COOKIE),
      session?.session,
    ),
    session:
      session?.session && session?.user
        ? { user: session.user, session: session.session }
        : null,
    consent: isConsentDecision(consentValue) ? consentValue : undefined,
  };
});

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: createIsomorphicFn()
    .server(() =>
      process.env.TSS_PRERENDERING === "true"
        ? { session: null, consent: undefined, createdOrganizationId: null }
        : getRootContext(),
    )
    .client(() => getRootContext()),
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
    <TooltipProvider delay={200}>
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
