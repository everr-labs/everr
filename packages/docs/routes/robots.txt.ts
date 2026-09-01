import { getRequestURL } from "nitro/h3";
import { textResponse } from "../src/lib/llms";
import { readOnlyRoute } from "../src/lib/machine-routes";
import { buildRobotsTxt } from "../src/lib/sitemap";

export default function handler(event: Parameters<typeof getRequestURL>[0]) {
  return readOnlyRoute(event.req.method, () =>
    textResponse(buildRobotsTxt(getRequestURL(event).origin)),
  );
}
