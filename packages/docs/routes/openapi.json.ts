import { getRequestURL } from "nitro/h3";
import { readOnlyRoute } from "../src/lib/machine-routes";
import { openApiResponse } from "../src/lib/openapi";

export default function handler(event: Parameters<typeof getRequestURL>[0]) {
  return readOnlyRoute(event.req.method, () =>
    openApiResponse(getRequestURL(event).origin, "application/json"),
  );
}
