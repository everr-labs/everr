// One method to write the identity of the SDK for the two entries, client.ts
// and server.ts. This module contains only constants. Thus it causes no problem
// in the two module graphs.
declare const __PACKAGE_VERSION__: string | undefined;

export const SDK_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
export const SDK_NAME = "@everr/otel-web";
