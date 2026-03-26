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
import { getAuthAction } from "@workos/authkit-tanstack-react-start";
import { AuthKitProvider } from "@workos/authkit-tanstack-react-start/client";
import { WorkOsWidgets } from "@workos-inc/widgets";
import { ThemeProvider } from "better-themes";
import { queryClient } from "@/query-client";
import appCss from "@/styles/app.css?url";
import type { RouterContext } from "../router";

export const Route = createRootRouteWithContext<RouterContext>()({
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
  loader: async () => {
    const auth = await getAuthAction();
    return {
      auth,
    };
  },
});

function Component() {
  const { auth } = Route.useLoaderData();

  return (
    <AuthKitProvider initialAuth={auth}>
      <QueryClientProvider client={queryClient}>
        <Outlet />
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
    </AuthKitProvider>
  );
}

function ShellComponent({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" disableTransitionOnChange>
          <WorkOsWidgets>{children}</WorkOsWidgets>
          <Scripts />
        </ThemeProvider>
      </body>
    </html>
  );
}
