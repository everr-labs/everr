import browserCollections from "fumadocs-mdx:collections/browser";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { LandingShell } from "@/components/landing-shell";

export const legalClientLoader = browserCollections.legal.createClientLoader({
  component({ default: MDX }) {
    return (
      <article className="prose prose-invert mt-12 min-w-0 max-w-3xl prose-headings:scroll-mt-24 prose-a:text-primary prose-p:text-fd-muted-foreground prose-li:text-fd-muted-foreground">
        <MDX components={defaultMdxComponents} />
      </article>
    );
  },
});

export function LegalPage({
  title,
  description,
  updated,
  children,
}: {
  title: string;
  description: string;
  updated: string;
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

        <Suspense>{children}</Suspense>
      </main>
    </LandingShell>
  );
}
