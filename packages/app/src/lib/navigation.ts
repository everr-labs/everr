import {
  Activity,
  Bell,
  Bug,
  ChartLine,
  FlaskConical,
  House,
  LayoutDashboard,
  type LucideIcon,
  NotebookText,
  ScrollText,
  Waypoints,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label?: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    items: [{ title: "Home", url: "/", icon: House }],
  },
  {
    label: "Monitor",
    items: [
      { title: "Dashboards", url: "/dashboards", icon: LayoutDashboard },
      { title: "Runbooks", url: "/runbooks", icon: NotebookText },
      { title: "Alerts", url: "/alerts", icon: Bell },
    ],
  },
  {
    label: "Explore",
    items: [
      { title: "Logs", url: "/logs", icon: ScrollText },
      { title: "Errors", url: "/errors", icon: Bug },
      { title: "Traces", url: "/traces", icon: Waypoints },
    ],
  },
  {
    label: "CI/CD",
    items: [
      { title: "Runs", url: "/runs", icon: Activity },
      { title: "Cost Analysis", url: "/cost-analysis", icon: ChartLine },
      { title: "Tests Overview", url: "/tests-overview", icon: FlaskConical },
    ],
  },
];
