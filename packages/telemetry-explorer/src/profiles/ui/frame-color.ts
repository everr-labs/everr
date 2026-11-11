import { serviceColor } from "../../traces/ui/shared/service-color";

/**
 * The package or class part of a function name, so frames of one module share a
 * color: `github.com/acme/api.(*Server).Serve` and `runtime.mallocgc` (Go),
 * `com.acme.Server.serve` (JVM), `tokio::runtime::park` (Rust, C++).
 */
export function framePackage(name: string): string {
  const base = name.split("(")[0] ?? name;
  const slash = base.lastIndexOf("/");
  if (slash >= 0) {
    const dot = base.indexOf(".", slash);
    return dot >= 0 ? base.slice(0, dot) : base;
  }
  const scope = base.lastIndexOf("::");
  if (scope > 0) return base.slice(0, scope);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** A stable theme token for the frame, shared with the trace service palette. */
export function frameColor(name: string): string {
  return serviceColor(framePackage(name));
}
