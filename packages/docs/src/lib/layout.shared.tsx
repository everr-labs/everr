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
        on: "nav",
      },
      {
        text: "Devlog",
        url: "/devlog",
        on: "nav",
        active: "nested-url",
      },
      {
        type: "custom",
        children: <GithubInfo owner="everr-labs" repo="everr" />,
        secondary: true,
        on: "nav",
      },
      {
        type: "icon",
        text: "Discord",
        label: "Discord",
        icon: <SiDiscord />,
        url: "https://discord.gg/hd6yYDjAuw",
        external: true,
        on: "nav",
        secondary: true,
      },
      {
        on: "nav",
        secondary: true,
        type: "custom",
        children: (
          <Button
            className="rounded-full"
            nativeButton={false}
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is injected
              <a href="https://app.everr.dev" />
            }
          >
            Sign In <ArrowRight />
          </Button>
        ),
      },
    ],
  };
}

export function docsOptions(): DocsLayoutOptions {
  const options = baseOptions();

  return {
    ...options,
    // The top navigation already renders this chrome; drop the repeated "Docs"
    // link and icon links (Discord) from the nested docs sidebar.
    links: options.links?.filter(
      (link) => !isDocsLink(link) && !isIconLink(link),
    ),
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

function isDocsLink(link: NonNullable<BaseLayoutProps["links"]>[number]) {
  return "text" in link && link.text === "Docs";
}

function isIconLink(link: NonNullable<BaseLayoutProps["links"]>[number]) {
  return "type" in link && link.type === "icon";
}

function DocsSidebarNavTitle(_props: ComponentProps<"a">) {
  return null;
}
