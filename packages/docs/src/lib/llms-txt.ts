import {
  AGENT_ENTRY_POINTS,
  EVERR_SUMMARY,
  NOT_FOR,
  WHEN_TO_USE,
} from "./agent-guide";
import { markdownDocsLinks } from "./llms";
import {
  getBlogPages,
  getDevlogPages,
  getStaticPages,
  type SitePage,
} from "./site-pages";

/**
 * The llms.txt document, in the shape llmstxt.org defines: an H1, a
 * blockquote summary, free-form content with no headings, then H2 file lists.
 *
 * The generated fumadocs index is folded in as the "Documentation" list, so
 * new documentation pages still appear without editing this file.
 */

export function buildLlmsTxt(siteUrl: string, docsIndex: string): string {
  const sections = [
    "# Everr",
    "",
    `> ${EVERR_SUMMARY}`,
    "",
    whenToUseParagraphs(),
    "",
    "## Start here",
    "",
    ...AGENT_ENTRY_POINTS.map(
      (entry) => `- [${entry.path}](${siteUrl}${entry.path}): ${entry.label}`,
    ),
    `- [/llms-full.txt](${siteUrl}/llms-full.txt): The whole documentation as one Markdown file`,
    `- [/sitemap.xml](${siteUrl}/sitemap.xml): Every indexable URL on this site`,
    "",
    docsSection(docsIndex, siteUrl),
    "",
    "## Company",
    "",
    ...linkList(getStaticPages().filter(isCompanyPage), siteUrl),
    "",
    "## Optional",
    "",
    ...linkList(getDevlogPages().slice(0, 10), siteUrl),
    ...linkList(getBlogPages().slice(0, 10), siteUrl),
    "",
  ];

  return sections.join("\n");
}

/**
 * The "when to use" guidance, written as prose lines rather than a heading
 * plus a list: llms.txt allows free-form content before the first H2, but not
 * further headings.
 */
function whenToUseParagraphs(): string {
  const lines = ["Reach for Everr when:", ""];

  for (const useCase of WHEN_TO_USE) {
    lines.push(`- ${useCase.when} ${useCase.how}`);
  }

  lines.push("", "Everr is the wrong tool when:", "");

  for (const limit of NOT_FOR) {
    lines.push(`- ${limit}`);
  }

  lines.push(
    "",
    "Authenticate with an Everr API key sent as `Authorization: Bearer <key>` or `X-Api-Key: <key>`. Install the CLI with `curl -fsSL https://everr.dev/install.sh | sh` and run `everr setup`.",
  );

  return lines.join("\n");
}

/**
 * Re-heads the fumadocs index, which starts at `# Docs`, so it becomes one H2
 * file list among the others. Links are absolute like every other list here,
 * so the file still works when an agent reads it away from its origin.
 */
function docsSection(docsIndex: string, siteUrl: string): string {
  const body = markdownDocsLinks(docsIndex)
    .replace(/^# Docs\n*/, "")
    .replace(/\]\(\/docs/g, `](${siteUrl}/docs`)
    .trimEnd();

  return ["## Documentation", "", body].join("\n");
}

function isCompanyPage(page: SitePage): boolean {
  return ["/about", "/contact", "/privacy", "/pricing"].includes(page.path);
}

function linkList(pages: SitePage[], siteUrl: string): string[] {
  return pages.map((page) => {
    const description = page.description ? `: ${page.description}` : "";
    return `- [${page.title}](${siteUrl}${page.path}.md)${description}`;
  });
}
