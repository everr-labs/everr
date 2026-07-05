import type { ReactNode } from "react";

/**
 * Branded shell for the MCP OAuth interstitials (org picker + consent). These
 * routes live outside the `_auth` split-screen layout but are the same kind of
 * trust moment, so they carry the Everr wordmark, heading scale, and the
 * `fade-up` brand motion rather than rendering as a bare card.
 */
export function OAuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm animate-fade-up motion-reduce:animate-none">
        <header className="mb-6 text-center">
          <span className="everr-decoration everr-decoration-primary font-heading text-sm font-bold uppercase tracking-[0.25em] text-foreground">
            Everr
          </span>
          <h1 className="mt-6 text-balance font-heading text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        </header>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
