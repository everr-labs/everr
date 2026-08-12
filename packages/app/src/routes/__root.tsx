// This import has an effect at load. It starts the error capture of the browser
// when the client build loads. It does nothing during the SSR and when the app
// has no configuration. Refer to telemetry/client.
import "@/telemetry/client";
import { Toaster } from "@everr/ui/components/sonner";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth.server";
import appCss from "@/styles/app.css?url";
import { CONSENT_COOKIE, isConsentDecision } from "@/telemetry/consent";
import { ConsentGate } from "@/telemetry/consent-gate";
import type { RouterContext } from "../router";

// The consent cookie comes from the server in the same request as the session.
// Thus the markup from the server already has the correct state of the banner,
// and the banner does not change after the hydration.
const getRootContext = createServerFn({ method: "GET" }).handler(async () => {
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
  });
  const consentValue = getCookie(CONSENT_COOKIE);

  return {
    session:
      session?.session && session?.user
        ? { user: session.user, session: session.session }
        : null,
    consent: isConsentDecision(consentValue) ? consentValue : undefined,
  };
});

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const { session, consent } = await getRootContext();

    return { session, consent };
  },
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
        type: "image/png",
        href: "/logo192.png",
      },
      {
        rel: "apple-touch-icon",
        href: "/logo192.png",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
    ],
  }),
  shellComponent: ShellComponent,
  component: Component,
});

function Component() {
  const { queryClient, consent } = Route.useRouteContext();
  return (
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
