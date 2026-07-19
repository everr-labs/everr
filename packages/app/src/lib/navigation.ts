import {
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
    url: "/alerts/slos",
    icon: Zap,
    isActive: true,
    items: [
      { title: "SLOs", url: "/alerts/slos" },
      { title: "Triage", url: "/alerts/triage" },
      { title: "History", url: "/alerts/history" },
      { title: "Rules", url: "/alerts/rules" },
      { title: "Delivery", url: "/alerts/delivery" },
      { title: "Silences", url: "/alerts/silences" },
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
