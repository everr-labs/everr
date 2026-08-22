import { getRequestURL } from "nitro/h3";
import { readOnlyRoute } from "../src/lib/machine-routes";
import { getSitePages } from "../src/lib/site-pages";
import { buildSitemapXml } from "../src/lib/sitemap";

export default function handler(event: Parameters<typeof getRequestURL>[0]) {
  return readOnlyRoute(event.req.method, () => {
    const xml = buildSitemapXml(getRequestURL(event).origin, getSitePages());

    return new Response(xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  });
}
