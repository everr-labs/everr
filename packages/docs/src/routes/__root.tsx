import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type * as React from "react";
import { baseOptions } from "@/lib/layout.shared";
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
        title: "Everr - Every second counts in CI/CD",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico" },
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
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          theme={{
            enableColorScheme: false,
            forcedTheme: "dark",
            enabled: false,
          }}
        >
          <HomeLayout {...baseOptions()}>{children}</HomeLayout>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
