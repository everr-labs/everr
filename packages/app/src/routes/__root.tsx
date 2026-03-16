import { TanStackDevtools } from "@tanstack/react-devtools";
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools";
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
import type { RouterContext } from "../router";
import appCss from "../styles.css?url";

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
  shellComponent: RootDocument,
  component: RootComponent,
  loader: async () => {
    const auth = await getAuthAction();
    return {
      auth,
    };
  },
});

function RootComponent() {
  return (
    <>
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
    </>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { auth } = Route.useLoaderData();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthKitProvider initialAuth={auth}>
          <ThemeProvider attribute="class" disableTransitionOnChange>
            <WorkOsWidgets>{children}</WorkOsWidgets>
            <Scripts />
          </ThemeProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
