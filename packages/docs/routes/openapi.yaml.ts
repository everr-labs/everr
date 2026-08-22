import { getRequestURL } from "nitro/h3";
import { readOnlyRoute } from "../src/lib/machine-routes";
import { openApiResponse } from "../src/lib/openapi";

/**
 * The same document, for tools that only look for a `.yaml` spec. YAML 1.2 is
 * a superset of JSON, so the JSON text parses as YAML: no second serializer,
 * and no chance of the two forms drifting.
 */
export default function handler(event: Parameters<typeof getRequestURL>[0]) {
  return readOnlyRoute(event.req.method, () =>
    openApiResponse(getRequestURL(event).origin, "application/yaml"),
  );
}
