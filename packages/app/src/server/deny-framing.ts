import { createMiddleware } from "@tanstack/react-start";

export async function denyFraming<T extends { response: Response }>(next: () => T | Promise<T>) {
  const result = await next();
  try {
    result.response.headers.set("X-Frame-Options", "DENY");
    result.response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  } catch {
    // Redirect responses have immutable headers; the browser follows them and frames nothing.
  }
  return result;
}

export const denyFramingMiddleware = createMiddleware({ type: "request" }).server(({ next }) =>
  denyFraming(next),
);
