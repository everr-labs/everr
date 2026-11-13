import { DISCORD_URL, SITE_URL } from "@/constants";

export function notFoundMarkdown(pathname: string) {
  return `# 404: Not found

There is no page at \`${pathname}\` on ${SITE_URL}.

Where to look next:

- [llms.txt](/llms.txt): an index of every docs page as Markdown, with guidance on when and how to use Everr
- [Sitemap](/sitemap.xml): every page on this site
- [Docs](/docs.md): the documentation home
- [CLI reference](/docs/reference/cli.md)
- [Home](/)

Docs pages are available as Markdown by appending \`.md\` to their URL. Questions: [Discord](${DISCORD_URL}).
`;
}
