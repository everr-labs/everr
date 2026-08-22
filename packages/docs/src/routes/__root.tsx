import { PostHogProvider } from "@posthog/react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type * as React from "react";
import { EVERR_SUMMARY } from "@/lib/agent-guide";
import { baseOptions } from "@/lib/layout.shared";
import { posthog } from "@/lib/posthog";
import { absoluteUrl, DEFAULT_OG_IMAGE_PATH, SITE_NAME } from "@/lib/seo";
import "@/lib/telemetry";
import docsCss from "@/styles/docs.css?url";

export const Route = createRootRoute({
  head: () => ({
    // Defaults for every page. A route that sets the same meta name or
    // property wins, so leaf routes only have to state what differs.
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
        content: EVERR_SUMMARY,
      },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "en_US" },
      { property: "og:image", content: absoluteUrl(DEFAULT_OG_IMAGE_PATH) },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@everrlabs" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico" },
      { rel: "stylesheet", href: docsCss },
      { rel: "sitemap", type: "application/xml", href: "/sitemap.xml" },
      {
        rel: "service",
        type: "application/vnd.oai.openapi+json",
        href: "/openapi.json",
      },
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
  return (
    <html lang="en" className="dark">
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
