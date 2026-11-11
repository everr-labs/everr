import favicon from "@everr/ui/assets/favicon.svg?url";
import { PostHogProvider } from "@posthog/react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Outlet, Scripts, useLocation } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type * as React from "react";
import { baseOptions } from "@/lib/layout.shared";
import { posthog } from "@/lib/posthog";
import { getLocale } from "@/paraglide/runtime";
import "@/lib/telemetry";
import docsCss from "@/styles/docs.css?url";

export const Route = createRootRoute({
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
        title: "Everr - Observability made simple",
      },
      {
        name: "description",
        content:
          "Everr keeps watch over your app. When a page slows down or something breaks, it tells you what happened, where, and why. No specialist team required.",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/svg+xml", href: favicon },
      { rel: "stylesheet", href: docsCss },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  // Redraws the document on navigation: going from /it to the docs changes the language
  useLocation();
  return (
    <html lang={getLocale()} className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        <PostHogProvider client={posthog}>
          <RootProvider
            theme={{
              enableColorScheme: false,
              forcedTheme: "dark",
              enabled: false,
            }}
          >
            <HomeLayout {...baseOptions()}>{children}</HomeLayout>
            <TanStackDevtools
              config={{ position: "bottom-right" }}
              plugins={[
                {
                  name: "Tanstack Router",
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
          </RootProvider>
        </PostHogProvider>
        <Scripts />
      </body>
    </html>
  );
}
