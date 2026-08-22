import { getRequestURL } from "nitro/h3";
import { EVERR_SUMMARY } from "../src/lib/agent-guide";
import { getLLMText, markdownDocsLinks, textResponse } from "../src/lib/llms";
import { readOnlyRoute } from "../src/lib/machine-routes";
import { source } from "../src/lib/source";

/**
 * Every documentation page concatenated into one file, for an agent that
 * would rather read the whole thing once than follow links.
 */
export default function handler(event: Parameters<typeof getRequestURL>[0]) {
  return readOnlyRoute(event.req.method, async () => {
    const siteUrl = getRequestURL(event).origin;
    const bodies = await Promise.all(
      source.getPages().map((page) => getLLMText(page)),
    );

    const document = [
      "# Everr documentation",
      "",
      `> ${EVERR_SUMMARY}`,
      "",
      `Source: ${siteUrl}/docs`,
      "",
      ...bodies.map((body) => `${body.trimEnd()}\n\n---\n`),
    ].join("\n");

    return textResponse(markdownDocsLinks(document));
  });
}
