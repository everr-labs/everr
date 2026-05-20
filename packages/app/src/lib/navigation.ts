import {
  FlaskConical,
  GitBranch,
  type LucideIcon,
  ScrollText,
  Workflow,
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
    title: "Traces",
    url: "/traces",
    icon: Workflow,
  },
  {
    title: "Tests Overview",
    url: "/tests-overview",
    icon: FlaskConical,
  },
];
