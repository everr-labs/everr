import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { devlogposts } from "@/lib/source";
import { getBaseUrl } from "@/lib/url";

const DEVLOG_TITLE = "Devlog - Everr";
const DEVLOG_DESCRIPTION =
  "Weekly updates on what we're building, success stories, and use cases from the Everr team.";

export const Route = createFileRoute("/devlog/")({
  component: DevlogIndex,
  head: () => {
    const base = getBaseUrl();
    return {
      meta: [
        { title: DEVLOG_TITLE },
        { name: "description", content: DEVLOG_DESCRIPTION },
        { name: "og:title", content: DEVLOG_TITLE },
        { name: "og:description", content: DEVLOG_DESCRIPTION },
        { name: "og:type", content: "website" },
        { name: "og:url", content: `${base}/devlog` },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:url", content: `${base}/devlog` },
        { name: "twitter:title", content: DEVLOG_TITLE },
        { name: "twitter:description", content: DEVLOG_DESCRIPTION },
      ],
    };
  },
  loader: async () => {
    return await loadDevlogPosts();
  },
});

const loadDevlogPosts = createServerFn({ method: "GET" }).handler(async () => {
  return await devlogposts
    .getPages()
    .filter((post) => !post.data.draft)
    .map((post) => ({
      slug: post.slugs.join("/"),
      title: post.data.title,
      description: post.data.description,
      date: post.data.date,
      author: post.data.author,
    }));
});

function DevlogIndex() {
  const posts = Route.useLoaderData();

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-7xl px-6">
        {/* Header */}
        <section className="pb-16 pt-20 md:pb-20 md:pt-28">
          <p className="mb-3 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Devlog
          </p>
          <h1 className="font-heading text-3xl leading-[0.95] sm:text-4xl md:text-5xl lg:text-6xl everr-decoration everr-decoration-primary">
            Building in the open
          </h1>
          <div className="mt-6 max-w-2xl space-y-4 text-fd-muted-foreground">
            <p>
              We're building a CI observability platform for developers and AI
              agents, because debugging CI pipelines is still harder than it
              should be, whether you're a person staring at a failed run or an
              agent trying to validate the code it just shipped.
            </p>
            <p>
              A growing share of code is written by AI. But when that code
              breaks in CI, the feedback loop is slow and lossy. Agents don't
              have good access to pipeline data, log structure, or test history.
              Everr gives both humans and agents a fast, structured way to
              understand what happened, why it failed, and what to do about it.
            </p>
            <p>
              We use Everr on our own CI every day, and when something slows us
              down, it becomes a fix the same week.
            </p>
          </div>
        </section>

        {/* Posts */}
        <section className="pb-20 md:pb-32">
          <div className="flex flex-col">
            {posts.map((post, i) => (
              <Link
                key={post.slug}
                to="/devlog/$slug"
                params={{ slug: post.slug }}
                className="group"
                viewTransition
              >
                <div
                  className={`grid grid-cols-1 gap-4 py-8 transition-colors md:grid-cols-[140px_1fr_auto] md:items-center md:gap-6 ${
                    i > 0 ? "border-t-2 border-fd-border" : ""
                  }`}
                >
                  <div className="flex flex-col gap-1">
                    <time
                      className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground/60"
                      style={{ viewTransitionName: `devlog-date-${post.slug}` }}
                    >
                      {new Date(post.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                    {post.author && (
                      <span
                        className="font-heading text-[11px] uppercase tracking-wider text-fd-muted-foreground/40"
                        style={{
                          viewTransitionName: `devlog-author-${post.slug}`,
                        }}
                      >
                        {post.author}
                      </span>
                    )}
                  </div>

                  <div>
                    <h2
                      className="font-heading text-xl font-bold transition-colors group-hover:text-primary md:text-2xl everr-decoration everr-decoration-primary"
                      style={{
                        viewTransitionName: `devlog-title-${post.slug}`,
                      }}
                    >
                      {post.title}
                    </h2>
                    <p
                      className="mt-2 text-fd-muted-foreground line-clamp-2"
                      style={{ viewTransitionName: `devlog-desc-${post.slug}` }}
                    >
                      {post.description}
                    </p>
                  </div>

                  <ArrowRight className="hidden size-5 text-fd-muted-foreground/40 transition-all group-hover:translate-x-1 group-hover:text-primary md:block" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
