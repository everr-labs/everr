export const PKG_NAME = "@everr/otel-profiler";

declare const __PACKAGE_VERSION__: string | undefined;

export const PKG_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
