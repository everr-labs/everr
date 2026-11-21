import { exploreNavGroup } from "@everr/app-shell/explore/routes";
import type { NavGroup as ShellNavGroup } from "@everr/app-shell/shell";
import {
  Activity,
  BellOff,
  ChartLine,
  Flame,
  Hash,
  House,
  LayoutDashboard,
  NotebookText,
} from "lucide-react";
import type { ApplicationPath } from "#app/composition/client.ts";

export type NavGroup = ShellNavGroup<ApplicationPath>;

export const navGroups: NavGroup[] = [
  {
    accent: "[--nav-accent:var(--ctp-lavender)]",
    items: [{ title: "Home", url: "/", icon: House, exact: true }],
  },
  {
    label: "Monitor",
    accent: "[--nav-accent:var(--ctp-blue)]",
    items: [
      { title: "Dashboards", url: "/dashboards", icon: LayoutDashboard },
      { title: "Runbooks", url: "/runbooks", icon: NotebookText },
    ],
  },
  {
    label: "Alerts",
    accent: "[--nav-accent:var(--ctp-peach)]",
    items: [
      { title: "Triage", url: "/alerts", icon: Flame, exact: true },
      { title: "Silences", url: "/alerts/silences", icon: BellOff },
      { title: "Notifications", url: "/alerts/notifications", icon: Hash },
    ],
  },
  exploreNavGroup,
  {
    label: "CI/CD",
    accent: "[--nav-accent:var(--ctp-teal)]",
    items: [
      { title: "Runs", url: "/runs", icon: Activity },
      { title: "Cost analysis", url: "/cost-analysis", icon: ChartLine },
    ],
  },
];
