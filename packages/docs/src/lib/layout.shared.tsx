import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Citrus } from "lucide-react";

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
    githubUrl: "https://github.com/everr-labs/everr",
    themeSwitch: {
      enabled: false,
    },
    links: [
      {
        text: "Documentation",
        url: "/docs",
      },
      // {
      //   text: "Blog",
      //   url: "/blog",
      //   on: "nav",
      //   active: "nested-url",
      // },
      {
        text: "Devlog",
        url: "/devlog",
        on: "nav",
        active: "nested-url",
      },
    ],
  };
}
