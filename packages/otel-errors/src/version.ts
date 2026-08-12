// The OTel instrumentation scope on each record that this package sends. In
// version 0.1.0 the name changed from @everr/auto-otel-errors. Thus after an
// upgrade, a query that filters on the old scope name finds no rows.
export const PKG_NAME = "@everr/otel-errors";

declare const __PACKAGE_VERSION__: string | undefined;

export const PKG_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
