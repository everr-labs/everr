import {
  Activity,
  BellOff,
  Bug,
  ChartLine,
  Flame,
  House,
  LayoutDashboard,
  type LucideIcon,
  NotebookText,
  ScrollText,
  Send,
  Waypoints,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Light the item up only on its own URL, not on the URLs nested under it.
   *  A section index such as `/alerts` needs this: without it it stays active
   *  on every sibling below it and two items light up at once. */
  exact?: boolean;
};

export type NavGroup = {
  label?: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    items: [{ title: "Home", url: "/", icon: House, exact: true }],
  },
  {
    label: "Monitor",
    items: [
      { title: "Dashboards", url: "/dashboards", icon: LayoutDashboard },
      { title: "Runbooks", url: "/runbooks", icon: NotebookText },
    ],
  },
  {
    label: "Alerts",
    items: [
      { title: "Triage", url: "/alerts", icon: Flame, exact: true },
      { title: "Silences", url: "/alerts/silences", icon: BellOff },
      { title: "Notifications", url: "/alerts/notifications", icon: Send },
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
    ],
  },
];
