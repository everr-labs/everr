import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { Footer } from "@/components/footer";
import { sectionLead, sectionWrap } from "@/components/ui/type";
import { formatBlogDate } from "@/lib/blog-format";
import { blogPosts } from "@/lib/blog";
import { pageHead } from "@/lib/page-head";
import { m } from "@/paraglide/messages";
import { getLocale, isLocale } from "@/paraglide/runtime";

export const Route = createFileRoute("/blog/")({
  component: BlogIndex,
  // /blog and /it/blog are the same route once the locale is stripped: the locale keeps
  // their loader data apart, so switching language never shows the other one
  loaderDeps: () => ({ locale: getLocale() }),
  loader: ({ deps: { locale } }) => loadBlogPosts({ data: locale }),
  head: () => pageHead("/blog", `${m.blog_heading()} - Everr`, m.blog_lead()),
});

// The server function's own URL carries no locale: pass the page's
const loadBlogPosts = createServerFn({ method: "GET" })
  .validator((locale: string) => {
    if (!isLocale(locale)) throw notFound();
    return locale;
  })
  .handler(({ data: locale }) => blogPosts(locale));

function BlogIndex() {
  const posts = Route.useLoaderData();
  const locale = getLocale();

  return (
    <>
      <div className="flex-1 text-foreground">
        <div className={sectionWrap}>
          <section className="pt-14 pb-16 md:pt-20 md:pb-24">
            <h1 className="display max-w-[12ch] text-[clamp(2.75rem,6.6vw,6.5rem)]">
              {m.blog_heading()}
            </h1>
            <div className={`${sectionLead} mt-7 max-w-[58ch]`}>
              <p>{m.blog_lead()}</p>
            </div>
          </section>

          <section className="pb-20 md:pb-32">
            <ul className="border-t border-border">
              {posts.map((post) => (
                <li key={post.slug} className="border-b border-border">
                  <Link
                    to="/blog/$slug"
                    params={{ slug: post.slug }}
                    className="group grid grid-cols-1 gap-3 py-8 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:grid-cols-[11rem_1fr_auto] md:items-baseline md:gap-8 md:py-10"
                    viewTransition
                  >
                    <div className="flex gap-2 text-[15px] text-muted-foreground md:flex-col md:gap-1">
                      <time
                        className="tabular-nums"
                        style={{ viewTransitionName: `blog-date-${post.slug}` }}
                      >
                        {formatBlogDate(post.date, locale, "short")}
                      </time>
                      {post.author && (
                        <span
                          className="text-muted-foreground/70"
                          style={{ viewTransitionName: `blog-author-${post.slug}` }}
                        >
                          {post.author}
                        </span>
                      )}
                    </div>

                    <div>
                      <h2
                        className="text-2xl leading-[1.2] font-medium tracking-[-0.02em] text-balance transition-colors group-hover:text-primary md:text-[28px]"
                        style={{ viewTransitionName: `blog-title-${post.slug}` }}
                      >
                        {post.title}
                      </h2>
                      <p
                        className="mt-3 line-clamp-2 max-w-[70ch] text-[17px] leading-[1.6] text-muted-foreground"
                        style={{ viewTransitionName: `blog-desc-${post.slug}` }}
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
