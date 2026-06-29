import {
  Bell,
  GitBranch,
  LayoutDashboard,
  type LucideIcon,
  NotebookText,
  Telescope,
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
    title: "Dashboards",
    url: "/dashboards",
    icon: LayoutDashboard,
  },
  {
    title: "Notebooks",
    url: "/notebooks",
    icon: NotebookText,
  },
  {
    title: "Alerts",
    url: "/alerts",
    icon: Bell,
  },
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
        title: "Cost Analysis",
        url: "/cost-analysis",
      },
      {
        title: "Tests Overview",
        url: "/tests-overview",
      },
    ],
  },
  {
    title: "Explore",
    url: "/logs",
    icon: Telescope,
    isActive: true,
    items: [
      { title: "Logs", url: "/logs" },
      { title: "Errors", url: "/errors" },
      { title: "Traces", url: "/traces" },
    ],
  },
];
