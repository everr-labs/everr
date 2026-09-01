import { llms } from "fumadocs-core/source";
import { getRequestURL } from "nitro/h3";
import { textResponse } from "../src/lib/llms";
import { buildLlmsTxt } from "../src/lib/llms-txt";
import { readOnlyRoute } from "../src/lib/machine-routes";
import { source } from "../src/lib/source";

export default function handler(event: Parameters<typeof getRequestURL>[0]) {
  return readOnlyRoute(event.req.method, () => {
    const siteUrl = getRequestURL(event).origin;
    return textResponse(buildLlmsTxt(siteUrl, llms(source).index()));
  });
}
