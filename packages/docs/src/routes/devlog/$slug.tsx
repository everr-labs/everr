import browserCollections from "fumadocs-mdx:collections/browser";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import defaultMdxComponents from "fumadocs-ui/mdx";
import {
  ArrowLeft,
  GitCommitHorizontal,
  GitPullRequest,
  Minus,
  Plus,
} from "lucide-react";
import { Suspense } from "react";
import { devlogposts } from "@/lib/source";

export const Route = createFileRoute("/devlog/$slug")({
  component: DevlogPost,
  loader: async ({ params: { slug } }) => {
    const data = await serverLoader({ data: slug });
    await clientLoader.preload(data.path);
    return data;
  },
});

const serverLoader = createServerFn({ method: "GET" })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const page = devlogposts.getPage([slug]);

    if (!page || page.data.draft) throw notFound();

    return {
      slug,
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      date: page.data.date,
      author: page.data.author,
      commits: page.data.commits,
      prs: page.data.prs,
      additions: page.data.additions,
      deletions: page.data.deletions,
    };
  });

const clientLoader = browserCollections.devlog.createClientLoader({
  component({ default: MDX }) {
    return (
      <MDX
        components={{
          ...defaultMdxComponents,
        }}
      />
    );
  },
});

function DevlogPost() {
  const data = Route.useLoaderData();

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-7xl px-6">
        <article className="mx-auto max-w-3xl pb-20 pt-12 md:pb-32 md:pt-16">
          {/* Back link */}
          <Link
            to="/devlog"
            className="group mb-10 inline-flex items-center gap-2 font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground/60 transition-colors hover:text-primary md:mb-14"
            viewTransition
          >
            <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-1" />
            All devlogs
          </Link>

          {/* Post header */}
          <header className="mb-10 border-b-2 border-fd-border pb-10 md:mb-14 md:pb-14">
            <div className="mb-4 flex items-center gap-3">
              <time
                className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground/60"
                style={{ viewTransitionName: `devlog-date-${data.slug}` }}
              >
                {new Date(data.date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
              {data.author && (
                <>
                  <span className="text-fd-border">&middot;</span>
                  <span
                    className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground/60"
                    style={{ viewTransitionName: `devlog-author-${data.slug}` }}
                  >
                    {data.author}
                  </span>
                </>
              )}
            </div>
            <h1
              className="font-heading text-2xl font-bold leading-[0.95] sm:text-3xl md:text-4xl everr-decoration everr-decoration-primary"
              style={{ viewTransitionName: `devlog-title-${data.slug}` }}
            >
              {data.title}
            </h1>
            <p
              className="mt-4 text-lg leading-relaxed text-fd-muted-foreground"
              style={{ viewTransitionName: `devlog-desc-${data.slug}` }}
            >
              {data.description}
            </p>
            {(data.commits || data.prs || data.additions || data.deletions) && (
              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {data.commits != null && (
                  <div className="flex items-center gap-2.5">
                    <GitCommitHorizontal className="size-5 text-primary" />
                    <div>
                      <p className="font-heading text-xl font-bold">
                        {data.commits.toLocaleString()}
                      </p>
                      <p className="font-heading text-[10px] uppercase tracking-wider text-fd-muted-foreground/50">
                        Commits
                      </p>
                    </div>
                  </div>
                )}
                {data.prs != null && (
                  <div className="flex items-center gap-2.5">
                    <GitPullRequest className="size-5 text-purple-500/70" />
                    <div>
                      <p className="font-heading text-xl font-bold">
                        {data.prs.toLocaleString()}
                      </p>
                      <p className="font-heading text-[10px] uppercase tracking-wider text-fd-muted-foreground/50">
                        PRs merged
                      </p>
                    </div>
                  </div>
                )}
                {data.additions != null && (
                  <div className="flex items-center gap-2.5">
                    <Plus className="size-5 text-green-500/70" />
                    <div>
                      <p className="font-heading text-xl font-bold text-green-500">
                        {data.additions.toLocaleString()}
                      </p>
                      <p className="font-heading text-[10px] uppercase tracking-wider text-fd-muted-foreground/50">
                        Additions
                      </p>
                    </div>
                  </div>
                )}
                {data.deletions != null && (
                  <div className="flex items-center gap-2.5">
                    <Minus className="size-5 text-red-500/70" />
                    <div>
                      <p className="font-heading text-xl font-bold text-red-500">
                        {data.deletions.toLocaleString()}
                      </p>
                      <p className="font-heading text-[10px] uppercase tracking-wider text-fd-muted-foreground/50">
                        Deletions
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </header>

          {/* Post body */}
          <div className="prose prose-invert prose-lg max-w-none prose-headings:font-heading prose-headings:font-bold [&_:not(h1,h2,h3,h4,h5,h6)>a]:text-primary [&_:not(h1,h2,h3,h4,h5,h6)>a]:no-underline [&_:not(h1,h2,h3,h4,h5,h6)>a:hover]:underline prose-headings:text-fd-foreground prose-strong:text-fd-foreground prose-p:text-fd-muted-foreground prose-li:text-fd-muted-foreground">
            <Suspense>{clientLoader.useContent(data.path)}</Suspense>
          </div>
        </article>
      </div>
    </main>
  );
}
