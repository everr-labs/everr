import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Citrus } from "lucide-react";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-1.5 font-semibold">
          <Citrus className="size-5" />
          Citric
        </span>
      ),
      url: "/",
    },
    githubUrl: "https://github.com/citric-app/citric",
    links: [
      {
        text: "Documentation",
        url: "/docs",
      },
    ],
  };
}
