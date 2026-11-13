import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { Footer } from "@/components/footer";
import { sectionLead, sectionWrap } from "@/components/ui/type";
import { devlogposts } from "@/lib/source";
import { seoHead } from "@/lib/page-head";

const DEVLOG_TITLE = "Devlog - Everr";
const DEVLOG_DESCRIPTION =
  "Weekly updates on what we're building, success stories, and use cases from the Everr team.";

export const Route = createFileRoute("/devlog/")({
  component: DevlogIndex,
  loader: async () => {
    return await loadDevlogPosts();
  },
  head: () => seoHead({ path: "/devlog", title: DEVLOG_TITLE, description: DEVLOG_DESCRIPTION }),
});

const loadDevlogPosts = createServerFn({ method: "GET" }).handler(async () => {
  // oxlint-disable-next-line typescript/await-thenable -- Preserve the existing async handler's settlement timing.
  return await devlogposts
    .getPages()
    .filter((post) => !post.data.draft)
    .map((post) => ({
      slug: post.slugs.join("/"),
      title: post.data.title,
      description: post.data.description,
      date: post.data.date,
      author: post.data.author,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
});

function DevlogIndex() {
  const posts = Route.useLoaderData();

  return (
    <>
      <div className="flex-1 text-foreground">
        <div className={sectionWrap}>
          <section className="pt-14 pb-16 md:pt-20 md:pb-24">
            <h1 className="display max-w-[12ch] text-[clamp(2.75rem,6.6vw,6.5rem)]">
              Building in the open
            </h1>
            <div className={`${sectionLead} mt-7 max-w-[58ch] space-y-5`}>
              <p>
                We want to bring AI into the software development lifecycle, making observability a
                natural part of your stack instead of a separate discipline, and guiding your team
                toward the best practices that have always been too complicated to apply everywhere.
              </p>
              <p>
                We use Everr on our own systems every day, and honestly we don&apos;t know how we
                used to live without it.
              </p>
            </div>
          </section>

          <section className="pb-20 md:pb-32">
            <ul className="border-t border-border">
              {posts.map((post) => (
                <li key={post.slug} className="border-b border-border">
                  <Link
                    to="/devlog/$slug"
                    params={{ slug: post.slug }}
                    className="group grid grid-cols-1 gap-3 py-8 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:grid-cols-[11rem_1fr_auto] md:items-baseline md:gap-8 md:py-10"
                    viewTransition
                  >
                    <div className="flex gap-2 text-[15px] text-muted-foreground md:flex-col md:gap-1">
                      <time
                        className="tabular-nums"
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
                          className="text-muted-foreground/70"
                          style={{ viewTransitionName: `devlog-author-${post.slug}` }}
                        >
                          {post.author}
                        </span>
                      )}
                    </div>

                    <div>
                      <h2
                        className="text-2xl leading-[1.2] font-medium tracking-[-0.02em] text-balance transition-colors group-hover:text-primary md:text-[28px]"
                        style={{ viewTransitionName: `devlog-title-${post.slug}` }}
                      >
                        {post.title}
                      </h2>
                      <p
                        className="mt-3 line-clamp-2 max-w-[70ch] text-[17px] leading-[1.6] text-muted-foreground"
                        style={{ viewTransitionName: `devlog-desc-${post.slug}` }}
                      >
                        {post.description}
                      </p>
                    </div>

                    <ArrowRight
                      aria-hidden
                      className="hidden size-5 self-center text-muted-foreground transition-[translate,color] duration-300 ease-out-expo group-hover:translate-x-1 group-hover:text-primary md:block"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <Footer />
    </>
  );
}
