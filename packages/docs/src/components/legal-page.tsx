import browserCollections from "fumadocs-mdx:collections/browser";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { LandingShell } from "@/components/landing-shell";

export const legalClientLoader = browserCollections.legal.createClientLoader({
  component({ toc, default: MDX }) {
    return (
      <div className="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <nav
          aria-label="Document contents"
          className="rounded-xl border border-fd-border p-5 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto"
        >
          <p className="text-sm font-medium">On this page</p>
          <ul className="mt-4 space-y-3 text-sm">
            {toc
              .filter((item) => item.depth === 2)
              .map((item) => (
                <li key={item.url}>
                  <a
                    href={item.url}
                    className="text-fd-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4"
                  >
                    {item.title}
                  </a>
                </li>
              ))}
          </ul>
        </nav>
        <article className="prose prose-invert min-w-0 max-w-none prose-headings:scroll-mt-24 prose-a:text-primary prose-p:text-fd-muted-foreground prose-li:text-fd-muted-foreground lg:col-start-1 lg:row-start-1">
          <MDX components={defaultMdxComponents} />
        </article>
      </div>
    );
  },
});

export function LegalPage({
  title,
  description,
  updated,
  draft,
  children,
}: {
  title: string;
  description: string;
  updated: string;
  draft: boolean;
  children: ReactNode;
}) {
  return (
    <LandingShell>
      <main className="mx-auto max-w-6xl px-6 py-12 md:py-20">
        <header className="max-w-3xl">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-primary">
            Legal
          </p>
          <h1 className="mt-5 text-4xl font-medium tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-fd-muted-foreground">{description}</p>
          <p className="mt-4 text-sm text-fd-muted-foreground">
            Last updated: <time dateTime={updated}>{updated}</time>
          </p>
        </header>

        {draft && (
          <aside
            aria-label="Draft document"
            className="mt-8 max-w-3xl rounded-xl border border-primary/30 bg-primary/5 p-5 text-sm leading-relaxed"
          >
            <p className="font-medium">Draft for review</p>
            <p className="mt-2 text-fd-muted-foreground">
              This document is a draft. Some details and operational procedures still need
              confirmation.
            </p>
          </aside>
        )}

        <Suspense>{children}</Suspense>
      </main>
    </LandingShell>
  );
}
