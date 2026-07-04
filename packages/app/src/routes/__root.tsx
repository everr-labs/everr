// Side-effect import: starts browser error tracking as early as the client
// bundle loads (no-op during SSR and when unconfigured). See telemetry/client.
import "@/telemetry/client";
import { ErrorBoundary } from "@everr/auto-otel-errors/react";
import { Button } from "@everr/ui/components/button";
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
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth.server";
import appCss from "@/styles/app.css?url";
import type { RouterContext } from "../router";

const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
  });

  if (!session?.session || !session?.user) {
    return null;
  }

  return {
    user: session.user,
    session: session.session,
  };
});

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const session = await getSession();

    return { session };
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

function AppErrorFallback() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground max-w-sm text-sm/relaxed">
          An unexpected error occurred. Reloading the page usually fixes it.
        </p>
      </div>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}

function Component() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary fallback={<AppErrorFallback />}>
        <Outlet />
      </ErrorBoundary>
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
