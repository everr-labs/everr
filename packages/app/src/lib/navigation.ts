import {
  Bell,
  GitBranch,
  LayoutDashboard,
  type LucideIcon,
  NotebookText,
  Telescope,
  Zap,
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
    title: "Runbooks",
    url: "/runbooks",
    icon: NotebookText,
  },
  {
    title: "Alerts",
    url: "/alerts",
    icon: Bell,
  },
  {
    title: "Clickety-Clack",
    url: "/cc-alerting/overview",
    icon: Zap,
    items: [
      { title: "Overview", url: "/cc-alerting/overview" },
      { title: "Monitor", url: "/cc-alerting/monitor" },
      { title: "Rules", url: "/cc-alerting/rules" },
      { title: "Routing", url: "/cc-alerting/routing" },
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
];
