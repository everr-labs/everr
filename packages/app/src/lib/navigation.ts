import {
  ChartLine,
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
    ],
  },
  {
    title: "Logs",
    url: "/logs",
    icon: ScrollText,
  },
  {
    title: "Testing",
    url: "/tests-overview",
    icon: FlaskConical,
    isActive: true,
    items: [
      {
        title: "Tests Overview",
        url: "/tests-overview",
      },
    ],
  },
  {
    title: "Insights",
    url: "/cost-analysis",
    icon: ChartLine,
    isActive: true,
    items: [
      {
        title: "Cost Analysis",
        url: "/cost-analysis",
      },
    ],
  },
];
