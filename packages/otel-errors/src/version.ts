// The OTel instrumentation scope stamped on every record this package emits.
// Renamed from @everr/auto-otel-errors in 0.1.0: queries filtering on the old
// scope name see no rows after upgrading.
export const PKG_NAME = "@everr/otel-errors";

declare const __PACKAGE_VERSION__: string | undefined;

export const PKG_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
