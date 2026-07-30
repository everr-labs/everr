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
    /** Match this URL exactly (for section landing pages like /alerts). */
    exact?: boolean;
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
    isActive: true,
    // Ordered by intent: respond (Triage, the section landing page, which also
    // hosts silences), track promises (SLOs), inspect detectors (Rules),
    // control notifications (Delivery), audit (History).
    items: [
      { title: "Triage", url: "/alerts", exact: true },
      { title: "SLOs", url: "/alerts/slos" },
      { title: "Rules", url: "/alerts/rules" },
      { title: "Delivery", url: "/alerts/delivery" },
      { title: "History", url: "/alerts/history" },
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
