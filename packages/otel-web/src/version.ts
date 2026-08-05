// One spelling of the SDK's identity for both entries (client.ts and
// server.ts): pure constants, so it is harmless to either module graph.
declare const __PACKAGE_VERSION__: string | undefined;

export const SDK_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
export const SDK_NAME = "@everr/otel-web";
