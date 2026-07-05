import { getClient } from "./core.js";
import { stripUrlQueryAndFragment } from "./scrub.js";

interface FastifyLikeRequest {
  method: string;
  url: string;
  routeOptions?: { url?: string };
}

interface FastifyLikeInstance {
  addHook(
    name: "onError",
    hook: (request: FastifyLikeRequest, reply: unknown, error: Error, done: () => void) => void,
  ): void;
}

export function errorTrackingPlugin(
  instance: FastifyLikeInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  instance.addHook("onError", (request, _reply, error, hookDone) => {
    getClient()?.capture({
      error,
      mechanism: "fastify",
      handled: true,
      severity: "error",
      attributes: {
        "http.request.method": request.method,
        "url.path": stripUrlQueryAndFragment(request.url),
        ...(request.routeOptions?.url ? { "http.route": request.routeOptions.url } : {}),
      },
    });
    hookDone();
  });
  done();
}

(errorTrackingPlugin as unknown as Record<symbol, boolean>)[Symbol.for("skip-override")] = true;
