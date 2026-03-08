import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Citrus } from "lucide-react";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-1.5 font-semibold">
          <Citrus className="size-5" />
          Everr
        </span>
      ),
      url: "/",
    },
    githubUrl: "https://app.everr.dev",
    links: [
      {
        text: "Documentation",
        url: "/docs",
      },
    ],
  };
}
