import { Button } from "@everr/ui/components/button";
import { SiDiscord } from "@icons-pack/react-simple-icons";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ArrowRight, Citrus } from "lucide-react";
import type { ComponentProps, CSSProperties } from "react";
import { GithubInfo } from "@/components/github-info";

type DocsLayoutOptions = BaseLayoutProps &
  Pick<DocsLayoutProps, "containerProps" | "sidebar">;

const docsTopNavHeight = "3.5rem";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-1.5 font-semibold font-heading">
          <Citrus className="size-5 text-primary" />
          Everr
        </span>
      ),
      url: "/",
    },
    themeSwitch: {
      enabled: false,
    },
    links: [
      {
        text: "Docs",
        url: "/docs",
      },
      {
        text: "Pricing",
        url: "/pricing",
      },
      {
        text: "Devlog",
        url: "/devlog",
        active: "nested-url",
      },
      {
        type: "custom",
        secondary: true,
        children: (
          <div
            data-nav-actions
            className="flex items-center gap-2 max-lg:grid max-lg:w-full max-lg:grid-cols-2 max-lg:gap-3 max-lg:border-t max-lg:pt-4"
          >
            <GithubInfo
              aria-label="GitHub"
              owner="everr-labs"
              repo="everr"
              className="items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-lg:min-h-11 max-lg:rounded-lg max-lg:border max-lg:px-3"
            >
              <span className="lg:hidden">GitHub</span>
            </GithubInfo>
            <a
              href="https://discord.gg/hd6yYDjAuw"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Discord"
              className="inline-flex items-center justify-center gap-2 rounded-full p-2 text-sm text-fd-foreground/80 transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-lg:min-h-11 max-lg:rounded-lg max-lg:border max-lg:px-3"
            >
              <SiDiscord className="size-5 shrink-0" aria-hidden="true" />
              <span className="lg:hidden">Discord</span>
            </a>
            <Button
              className="rounded-full max-lg:col-span-2 max-lg:min-h-11 max-lg:w-full max-lg:rounded-lg"
              nativeButton={false}
              render={
                // biome-ignore lint/a11y/useAnchorContent: content is injected
                <a href="https://app.everr.dev" />
              }
            >
              Sign In <ArrowRight />
            </Button>
          </div>
        ),
      },
    ],
  };
}

export function docsOptions(): DocsLayoutOptions {
  const options = baseOptions();

  return {
    ...options,
    links: options.links?.map((link) => ({ ...link, on: "nav" })),
    searchToggle: {
      ...options.searchToggle,
      enabled: false,
    },
    sidebar: {
      collapsible: false,
    },
    containerProps: {
      style: {
        "--fd-banner-height": docsTopNavHeight,
      } as CSSProperties,
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
