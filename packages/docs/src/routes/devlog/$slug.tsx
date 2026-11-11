import browserCollections from "fumadocs-mdx:collections/browser";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { ArrowLeft, GitCommitHorizontal, GitPullRequest, Minus, Plus } from "lucide-react";
import { Suspense } from "react";
import { Footer } from "@/components/footer";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";
import { devlogposts } from "@/lib/source";
import { getBaseUrl } from "@/lib/url";

export const Route = createFileRoute("/devlog/$slug")({
  component: DevlogPost,
  loader: async ({ params: { slug } }) => {
    const data = await serverLoader({ data: slug });
    await clientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const title = `${loaderData.title} - Everr Devlog`;
    const description = loaderData.description;
    const base = getBaseUrl();
    const url = `${base}/devlog/${loaderData.slug}`;
    const image = `${base}/api/og/devlog/${loaderData.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "og:image", content: image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: description },
        { property: "og:site_name", content: "Everr" },
        { property: "article:published_time", content: loaderData.date },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:url", content: url },
        { name: "twitter:image", content: image },
      ],
    };
  },
});

const serverLoader = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
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

const STAT_VALUE = "text-2xl font-medium tracking-[-0.02em] tabular-nums";
const STAT_LABEL = "text-sm text-muted-foreground";

function DevlogPost() {
  const data = Route.useLoaderData();

  return (
    <>
      <main className="flex-1 text-foreground">
        <div className={sectionWrap}>
          <article className="mx-auto max-w-3xl pt-10 pb-20 md:pt-14 md:pb-32">
            <Link
              to="/devlog"
              className="group mb-10 inline-flex items-center gap-2 text-[15px] text-muted-foreground transition-colors hover:text-primary md:mb-14"
              viewTransition
            >
              <ArrowLeft className="size-4 transition-[translate] duration-300 ease-out-expo group-hover:-translate-x-1" />
              All devlogs
            </Link>

            <header className="mb-10 border-b border-border pb-10 md:mb-14 md:pb-14">
              <div className="mb-5 flex items-center gap-2 text-[15px] text-muted-foreground">
                <time
                  className="tabular-nums"
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
                    <span aria-hidden>&middot;</span>
                    <span style={{ viewTransitionName: `devlog-author-${data.slug}` }}>
                      {data.author}
                    </span>
                  </>
                )}
              </div>
              <h1
                className={sectionHeading}
                style={{ viewTransitionName: `devlog-title-${data.slug}` }}
              >
                {data.title}
              </h1>
              <p
                className={`${sectionLead} mt-6`}
                style={{ viewTransitionName: `devlog-desc-${data.slug}` }}
              >
                {data.description}
              </p>
              {(data.commits || data.prs || data.additions || data.deletions) && (
                <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                  {data.commits != null && (
                    <div className="flex items-center gap-3">
                      <GitCommitHorizontal className="size-5 text-primary" aria-hidden />
                      <div className="flex flex-col-reverse">
                        <dt className={STAT_LABEL}>Commits</dt>
                        <dd className={STAT_VALUE}>{data.commits.toLocaleString()}</dd>
                      </div>
                    </div>
                  )}
                  {data.prs != null && (
                    <div className="flex items-center gap-3">
                      <GitPullRequest className="size-5 text-purple-400" aria-hidden />
                      <div className="flex flex-col-reverse">
                        <dt className={STAT_LABEL}>PRs merged</dt>
                        <dd className={STAT_VALUE}>{data.prs.toLocaleString()}</dd>
                      </div>
                    </div>
                  )}
                  {data.additions != null && (
                    <div className="flex items-center gap-3">
                      <Plus className="size-5 text-green-500" aria-hidden />
                      <div className="flex flex-col-reverse">
                        <dt className={STAT_LABEL}>Additions</dt>
                        <dd className={`${STAT_VALUE} text-green-500`}>
                          {data.additions.toLocaleString()}
                        </dd>
                      </div>
                    </div>
                  )}
                  {data.deletions != null && (
                    <div className="flex items-center gap-3">
                      <Minus className="size-5 text-red-500" aria-hidden />
                      <div className="flex flex-col-reverse">
                        <dt className={STAT_LABEL}>Deletions</dt>
                        <dd className={`${STAT_VALUE} text-red-500`}>
                          {data.deletions.toLocaleString()}
                        </dd>
                      </div>
                    </div>
                  )}
                </dl>
              )}
            </header>

            <div className="prose prose-invert prose-lg max-w-none prose-headings:font-heading prose-headings:font-semibold prose-headings:tracking-[-0.03em] [&_:not(h1,h2,h3,h4,h5,h6)>a]:text-primary [&_:not(h1,h2,h3,h4,h5,h6)>a]:no-underline [&_:not(h1,h2,h3,h4,h5,h6)>a:hover]:underline prose-headings:text-fd-foreground prose-strong:text-fd-foreground prose-p:text-fd-muted-foreground prose-li:text-fd-muted-foreground">
              <Suspense>{clientLoader.useContent(data.path)}</Suspense>
            </div>
          </article>
        </div>
      </main>
      <Footer />
    </>
  );
}
