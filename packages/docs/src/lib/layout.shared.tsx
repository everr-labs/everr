import { EverrLogo } from "@everr/ui/components/everr-logo";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import type { ComponentProps, CSSProperties } from "react";
import { NAV_LINKS, SiteHeader } from "@/components/site-header";

type DocsLayoutOptions = BaseLayoutProps & Pick<DocsLayoutProps, "containerProps" | "sidebar">;

const docsTopNavHeight = "3.5rem";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <EverrLogo size="lg" />,
      url: "/",
      component: <SiteHeader />,
    },
    themeSwitch: {
      enabled: false,
    },
    links: NAV_LINKS.map((link) => ({ ...link })),
  };
}

export function docsOptions(): DocsLayoutOptions {
  const options = baseOptions();

  const containerStyle: CSSProperties & Record<`--${string}`, string | number | undefined> = {
    "--fd-banner-height": docsTopNavHeight,
  };

  return {
    ...options,
    // The site header already sits above the docs layout: the docs layout keeps its own nav
    nav: { ...options.nav, component: undefined },
    links: options.links?.map((link) => ({ ...link, on: "nav" })),
    searchToggle: {
      ...options.searchToggle,
      enabled: false,
    },
    sidebar: {
      collapsible: false,
    },
    containerProps: {
      style: containerStyle,
    },
    slots: {
      ...options.slots,
      navTitle: DocsSidebarNavTitle,
    },
  };
}

function DocsSidebarNavTitle(_props: ComponentProps<"a">) {
  return null;
}
