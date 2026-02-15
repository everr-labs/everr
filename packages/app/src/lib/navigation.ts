import {
  ChartLine,
  FlaskConical,
  GitBranch,
  GitFork,
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
      {
        title: "Failures",
        url: "/dashboard/failures",
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
      {
        title: "Flaky Tests",
        url: "/dashboard/flaky-tests",
      },
      {
        title: "Test Performance",
        url: "/dashboard/test-performance",
      },
    ],
  },
  {
    title: "Insights",
    url: "/dashboard/analytics",
    icon: ChartLine,
    isActive: true,
    items: [
      {
        title: "Analytics",
        url: "/dashboard/analytics",
      },
      {
        title: "Cost Analysis",
        url: "/dashboard/cost-analysis",
      },
    ],
  },
  {
    title: "Repositories",
    url: "/dashboard/repos",
    icon: GitFork,
    items: [
      {
        title: "All Repositories",
        url: "/dashboard/repos",
      },
    ],
  },
];
