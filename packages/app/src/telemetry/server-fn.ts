import { createMiddleware } from "@tanstack/react-start";

export const serverFnTelemetryMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next, serverFnMeta }) => {
  const [{ getRequest }, { instrumentServerFunction }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("./server-fn-runtime"),
  ]);

  return instrumentServerFunction(getRequest(), serverFnMeta, () => next());
});
