export function parameterizeTelemetryPath(path: string) {
  if (path.startsWith("/_serverFn/")) {
    return path.replace(/^\/_serverFn\/[^/]+/, "/_serverFn/:id");
  }

  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/[0-9a-f]{16,}/gi, "/:hex")
    .replace(/\/\d+/g, "/:id");
}
