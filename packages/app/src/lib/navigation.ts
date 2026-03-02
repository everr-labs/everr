import {
  ChartLine,
  FlaskConical,
  GitBranch,
  type LucideIcon,
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
    url: "/dashboard",
    icon: GitBranch,
    isActive: true,
    items: [
      {
        title: "Overview",
        url: "/dashboard",
      },
      {
        title: "Runs",
        url: "/dashboard/runs",
      },
      {
        title: "Workflows",
        url: "/dashboard/workflows",
      },
    ],
  },
  {
    title: "Testing",
    url: "/dashboard/test-results",
    icon: FlaskConical,
    isActive: true,
    items: [
      {
        title: "Test Results",
        url: "/dashboard/test-results",
      },
    ],
  },
  {
    title: "Insights",
    url: "/dashboard/cost-analysis",
    icon: ChartLine,
    isActive: true,
    items: [
      {
        title: "Cost Analysis",
        url: "/dashboard/cost-analysis",
      },
    ],
  },
];
