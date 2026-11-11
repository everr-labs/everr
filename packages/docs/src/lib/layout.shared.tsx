import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import type { ComponentProps, CSSProperties } from "react";
import { SiteHeader } from "@/components/site-header";

type DocsLayoutOptions = BaseLayoutProps & Pick<DocsLayoutProps, "containerProps" | "sidebar">;

const docsTopNavHeight = "3.5rem";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      component: <SiteHeader />,
    },
    themeSwitch: {
      enabled: false,
    },
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
