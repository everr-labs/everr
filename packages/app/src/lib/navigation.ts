import {
  FlaskConical,
  GitBranch,
  type LucideIcon,
  ScrollText,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  items?: {
    title: string;
    url: string;
  }[];
};

export const navMain: NavItem[] = [
  {
    title: "CI/CD",
    url: "/runs",
    icon: GitBranch,
    isActive: true,
    items: [
      {
        title: "Runs",
        url: "/runs",
      },
      {
        title: "Workflows",
        url: "/workflows",
      },
      {
        title: "Cost Analysis",
        url: "/cost-analysis",
      },
    ],
  },
  {
    title: "Logs",
    url: "/logs",
    icon: ScrollText,
  },
  {
    title: "Tests Overview",
    url: "/tests-overview",
    icon: FlaskConical,
  },
];
