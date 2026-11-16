import {
  Activity,
  BellOff,
  Bug,
  ChartLine,
  Flame,
  Hash,
  House,
  LayoutDashboard,
  type LucideIcon,
  NotebookText,
  ScrollText,
  Waypoints,
} from "lucide-react";
import type { ApplicationPath } from "#app/composition/client.ts";

type NavItem = {
  title: string;
  url: ApplicationPath;
  icon: LucideIcon;
  /** Light the item up only on its own URL, not on the URLs nested under it.
   *  A section index such as `/alerts` needs this: without it it stays active
   *  on every sibling below it and two items light up at once. */
  exact?: boolean;
};

export type NavGroup = {
  label?: string;
  /** Sets `--nav-accent`, the section colour its icons wear in the sidebar,
   *  the command bar, the breadcrumb and empty states. One per group rather
   *  than per item, so the colour says which section you are in. A whole
   *  class, so Tailwind finds it here. */
  accent: string;
  items: NavItem[];
};

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
  {
    label: "Explore",
    accent: "[--nav-accent:var(--ctp-mauve)]",
    items: [
      { title: "Logs", url: "/logs", icon: ScrollText },
      { title: "Errors", url: "/errors", icon: Bug },
      { title: "Traces", url: "/traces", icon: Waypoints },
    ],
  },
  {
    label: "CI/CD",
    accent: "[--nav-accent:var(--ctp-teal)]",
    items: [
      { title: "Runs", url: "/runs", icon: Activity },
      { title: "Cost analysis", url: "/cost-analysis", icon: ChartLine },
    ],
  },
];

/** The sidebar destination a pathname belongs to: the item with the longest
 *  URL that prefixes it, so `/alerts/silences` resolves to Silences rather
 *  than Triage. Home matches only `/` itself. */
export function findNavSection(pathname: string): { group: NavGroup; item: NavItem } | undefined {
  let best: { group: NavGroup; item: NavItem } | undefined;
  for (const group of navGroups) {
    for (const item of group.items) {
      const matches =
        item.url === "/"
          ? pathname === "/"
          : pathname === item.url || pathname.startsWith(`${item.url}/`);
      if (matches && (!best || item.url.length > best.item.url.length)) best = { group, item };
    }
  }
  return best;
}
