import type { ReactNode } from "react";

/** Inline monospace chip for a CLI command or identifier in prose. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.85em] text-fd-foreground">
      {children}
    </code>
  );
}
