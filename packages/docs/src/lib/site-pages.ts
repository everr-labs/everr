import { blogposts, devlogposts, source } from "./source";

/**
 * One canonical inventory of every public page on everr.dev.
 *
 * The sitemap, llms.txt and the Markdown middleware all read from here, so a
 * new page shows up in every machine-readable surface at once instead of
 * drifting between three hand-kept lists.
 */
export type SitePage = {
  /** Path with a leading slash and no trailing slash, except the root. */
  path: string;
  title: string;
  description?: string;
  /** ISO 8601 date, only when the content actually records one. */
  lastModified?: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};

type PostPage = {
  url: string;
  data: {
    title: string;
    description: string;
    date: string;
    draft?: boolean;
  };
};

const STATIC_PAGES: SitePage[] = [
  {
    path: "/",
    title: "Everr - Observability made simple",
    description:
      "Everr is an OpenTelemetry observability platform for logs, traces, metrics, dashboards, alerts and runbooks, driven from a CLI and from code.",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/pricing",
    title: "Pricing - Everr",
    description: "Everr pricing plans and an ingest cost calculator.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/about",
    title: "About Everr",
    description: "Who builds Everr and why.",
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    path: "/contact",
    title: "Contact Everr",
    description: "How to reach the Everr team for support, security or sales.",
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    path: "/privacy",
    title: "Privacy policy - Everr",
    description: "What data Everr collects, why, and how to have it removed.",
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    path: "/blog",
    title: "Blog - Everr",
    description: "Announcements and long-form writing from the Everr team.",
    changeFrequency: "weekly",
    priority: 0.6,
  },
  {
    path: "/devlog",
    title: "Devlog - Everr",
    description: "What shipped in Everr, week by week.",
    changeFrequency: "weekly",
    priority: 0.6,
  },
];

function getDocsPages(): SitePage[] {
  return source.getPages().map((page) => ({
    path: page.url,
    title: page.data.title,
    description: page.data.description,
    changeFrequency: "weekly" as const,
    priority: page.url === "/docs" ? 0.9 : 0.7,
  }));
}

export function getBlogPages(): SitePage[] {
  return postPages(blogposts.getPages() as PostPage[], 0.5);
}

export function getDevlogPages(): SitePage[] {
  return postPages(devlogposts.getPages() as PostPage[], 0.5);
}

export function getStaticPages(): SitePage[] {
  return STATIC_PAGES;
}

/** Every indexable page, in a stable order. */
export function getSitePages(): SitePage[] {
  return [
    ...getStaticPages(),
    ...getDocsPages(),
    ...getBlogPages(),
    ...getDevlogPages(),
  ];
}

export function isKnownPagePath(pathname: string): boolean {
  const normalized = normalizePagePath(pathname);
  return getSitePages().some((page) => page.path === normalized);
}

/** Strips a trailing slash so `/pricing/` and `/pricing` are one page. */
export function normalizePagePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function postPages(pages: PostPage[], priority: number): SitePage[] {
  return pages
    .filter((page) => !page.data.draft)
    .sort((a, b) => b.data.date.localeCompare(a.data.date))
    .map((page) => ({
      path: page.url,
      title: page.data.title,
      description: page.data.description,
      lastModified: page.data.date,
      changeFrequency: "yearly" as const,
      priority,
    }));
}
