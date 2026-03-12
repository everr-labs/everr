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
    themeSwitch: {
      enabled: false,
    },
    links: [
      {
        text: "Documentation",
        url: "/docs",
      },
    ],
  };
}
