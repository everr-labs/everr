import { defineMiddleware, getRequestURL } from "nitro/h3";
import { handleAgentRequest, varyOnAccept } from "../src/lib/agent-request";

export default defineMiddleware(async (event, next) => {
  const url = getRequestURL(event);

  const handled = await handleAgentRequest({
    url,
    method: event.req.method,
    accept: event.req.headers.get("accept"),
  });

  if (handled) return handled;

  return varyOnAccept(await next());
});
