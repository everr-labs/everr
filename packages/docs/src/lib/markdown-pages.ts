import { findTrustPage, trustPageMarkdown } from "../content/trust-pages";
import {
  AGENT_ENTRY_POINTS,
  EVERR_SUMMARY,
  howToCallMarkdown,
  whenToUseMarkdown,
} from "./agent-guide";
import { getLLMText, markdownDocsLinks } from "./llms";
import {
  getBlogPages,
  getDevlogPages,
  normalizePagePath,
  type SitePage,
} from "./site-pages";
import { blogposts, devlogposts, source } from "./source";

/**
 * The Markdown twin of every page on everr.dev.
 *
 * `/docs` pages already carry their processed Markdown, so those are served
 * verbatim. The marketing and index pages are React, so they get a written
 * summary here instead: an agent asking for Markdown wants the facts and the
 * links, not a transcription of the hero section.
 */

type PostSource = {
  getPage: (slugs: string[]) => PostPage | undefined;
};

type PostPage = {
  url: string;
  data: {
    title: string;
    description: string;
    date?: string;
    draft?: boolean;
    getText: (type: "processed") => Promise<string>;
  };
};

export async function renderPageMarkdown(
  pathname: string,
  siteUrl: string,
): Promise<string | null> {
  const path = normalizePagePath(pathname);

  if (path === "/") return homeMarkdown(siteUrl);
  if (path === "/pricing") return pricingMarkdown(siteUrl);

  const trustPage = findTrustPage(path);
  if (trustPage) return trustPageMarkdown(trustPage);

  if (path === "/blog") {
    return postIndexMarkdown(
      "Everr blog",
      "Announcements and long-form writing from the Everr team.",
      getBlogPages(),
      siteUrl,
    );
  }

  if (path === "/devlog") {
    return postIndexMarkdown(
      "Everr devlog",
      "What shipped in Everr, week by week.",
      getDevlogPages(),
      siteUrl,
    );
  }

  const post = await postMarkdown(path, "/blog", blogposts as PostSource);
  if (post) return post;

  const devlogPost = await postMarkdown(
    path,
    "/devlog",
    devlogposts as PostSource,
  );
  if (devlogPost) return devlogPost;

  return docsMarkdown(path);
}

async function docsMarkdown(path: string): Promise<string | null> {
  if (path !== "/docs" && !path.startsWith("/docs/")) return null;

  const slugs =
    path === "/docs"
      ? []
      : path.slice("/docs/".length).split("/").filter(Boolean);
  const page = source.getPage(slugs);
  if (!page) return null;

  return markdownDocsLinks(await getLLMText(page));
}

async function postMarkdown(
  path: string,
  baseUrl: string,
  posts: PostSource,
): Promise<string | null> {
  if (!path.startsWith(`${baseUrl}/`)) return null;

  const slug = path.slice(baseUrl.length + 1);
  if (!slug || slug.includes("/")) return null;

  const page = posts.getPage([slug]);
  if (!page || page.data.draft) return null;

  const heading = `# ${page.data.title} (${page.url})`;
  const dateLine = page.data.date ? `\n_${page.data.date}_\n` : "";

  return markdownDocsLinks(
    `${heading}\n${dateLine}\n${await page.data.getText("processed")}`,
  );
}

function homeMarkdown(siteUrl: string): string {
  return [
    "# Everr",
    "",
    `> ${EVERR_SUMMARY}`,
    "",
    whenToUseMarkdown(),
    "",
    howToCallMarkdown(siteUrl),
    "",
    "## Machine-readable entry points",
    "",
    ...AGENT_ENTRY_POINTS.map(
      (entry) => `- [${entry.path}](${siteUrl}${entry.path}): ${entry.label}`,
    ),
    `- [/llms.txt](${siteUrl}/llms.txt): This site, condensed for agents`,
    `- [/sitemap.xml](${siteUrl}/sitemap.xml): Every indexable URL`,
    "",
    "## Other pages",
    "",
    `- [Pricing](${siteUrl}/pricing)`,
    `- [About](${siteUrl}/about)`,
    `- [Contact](${siteUrl}/contact)`,
    `- [Privacy](${siteUrl}/privacy)`,
    "",
  ].join("\n");
}

function pricingMarkdown(siteUrl: string): string {
  return [
    "# Everr pricing",
    "",
    "Everr has a free plan and a Pro plan. The plans differ in how much telemetry you can ingest and how long it is kept: 30 days for traces, logs and metrics on Free; 90 days for traces and logs and 13 months for metrics on Pro.",
    "",
    `The current prices, the included volume, and a calculator that turns your ingest volume into a monthly figure are on the pricing page itself: ${siteUrl}/pricing`,
    "",
    `The exact retention rules, including what happens when you change plan, are at ${siteUrl}/docs/reference/retention.md`,
    "",
    `For a plan, a retention window or an invoicing arrangement the published plans do not cover, see ${siteUrl}/contact`,
    "",
  ].join("\n");
}

function postIndexMarkdown(
  title: string,
  description: string,
  pages: SitePage[],
  siteUrl: string,
): string {
  const entries = pages.map((page) => {
    const date = page.lastModified ? `${page.lastModified}: ` : "";
    return `- [${page.title}](${siteUrl}${page.path}.md): ${date}${page.description ?? ""}`.trimEnd();
  });

  return [
    `# ${title}`,
    "",
    description,
    "",
    ...(entries.length > 0 ? entries : ["Nothing published yet."]),
    "",
  ].join("\n");
}
