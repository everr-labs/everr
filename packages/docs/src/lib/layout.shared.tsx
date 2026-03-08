import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Gauge } from "lucide-react";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-1.5 font-semibold">
          <Gauge className="size-5" />
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
