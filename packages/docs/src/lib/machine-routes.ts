import { JSON_CONTENT_TYPE } from "./content-negotiation";

/**
 * Guards the machine-readable files at the site root.
 *
 * They are registered without a method suffix so `HEAD` reaches them too: RFC
 * 9110 requires a server that answers `GET` to answer `HEAD`, and crawlers do
 * probe these files with `HEAD` before fetching them. Everything else gets a
 * JSON 405 rather than an HTML page.
 */
export function readOnlyRoute(
  method: string,
  handler: () => Response | Promise<Response>,
): Response | Promise<Response> {
  if (method === "GET" || method === "HEAD") return handler();

  return new Response(
    JSON.stringify(
      {
        error: {
          code: "method_not_allowed",
          message: `${method} is not allowed here. This file is read-only.`,
          status: 405,
        },
      },
      null,
      2,
    ),
    {
      status: 405,
      headers: {
        "content-type": JSON_CONTENT_TYPE,
        allow: "GET, HEAD",
      },
    },
  );
}
