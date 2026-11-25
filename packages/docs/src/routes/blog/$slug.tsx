import browserCollections from "fumadocs-mdx:collections/browser";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { ArrowLeft } from "lucide-react";
import { Suspense } from "react";
import { Footer } from "@/components/footer";
import { Mermaid } from "@/components/mermaid";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";
import { SITE_URL } from "@/constants";
import { blogPost } from "@/lib/blog";
import { blogPageTitle, formatBlogDate, OG_LOCALES } from "@/lib/blog-format";
import { pageHead } from "@/lib/page-head";
import { blogPostingStructuredData, jsonLdScript } from "@/lib/structured-data";
import { m } from "@/paraglide/messages";
import { getLocale, isLocale, localizeHref, locales } from "@/paraglide/runtime";

export const Route = createFileRoute("/blog/$slug")({
  component: BlogPost,
  // /blog/x and /it/blog/x are the same route once the locale is stripped: the locale keeps
  // their loader data apart, so switching language never shows the other one
  loaderDeps: () => ({ locale: getLocale() }),
  loader: async ({ params: { slug }, deps: { locale } }) => {
    // The server function's own URL carries no locale: pass the page's
    const data = await serverLoader({ data: { slug, locale } });
    await clientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { slug, title, description, date, author } = loaderData;
    const updated = loaderData.updated ?? date;
    const locale = getLocale();
    const image = SITE_URL + localizeHref(`/api/og/blog/${slug}`, { locale });
    const head = pageHead(
      `/blog/${slug}`,
      blogPageTitle(title, m.blog_title_suffix()),
      description,
      { type: "article", image },
    );
    return {
      ...head,
      meta: [
        ...head.meta,
        { property: "og:image:alt", content: description },
        { property: "og:locale", content: OG_LOCALES[locale] },
        ...locales
          .filter((other) => other !== locale)
          .map((other) => ({ property: "og:locale:alternate", content: OG_LOCALES[other] })),
        { property: "article:published_time", content: date },
        { property: "article:modified_time", content: updated },
        ...(author ? [{ property: "article:author", content: author }] : []),
      ],
      scripts: [
        jsonLdScript(
          blogPostingStructuredData({
            url: SITE_URL + localizeHref(`/blog/${slug}`, { locale }),
            headline: title,
            description,
            datePublished: date,
            dateModified: updated,
            author,
            image,
            inLanguage: locale,
          }),
        ),
      ],
    };
  },
});

const serverLoader = createServerFn({ method: "GET" })
  .validator((data: { slug: string; locale: string }) => {
    if (!isLocale(data.locale)) throw notFound();
    return { slug: data.slug, locale: data.locale };
  })
  .handler(({ data: { slug, locale } }) => {
    const page = blogPost(slug, locale);
    if (!page) throw notFound();

    return {
      slug,
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      date: page.data.date,
      updated: page.data.updated,
      author: page.data.author,
    };
  });

const clientLoader = browserCollections.blog.createClientLoader({
  component({ default: MDX }) {
    return (
      <MDX
        components={{
          ...defaultMdxComponents,
          Mermaid,
        }}
      />
    );
  },
});

function BlogPost() {
  const data = Route.useLoaderData();
  const locale = getLocale();

  return (
    <>
      <div className="flex-1 text-foreground">
        <div className={sectionWrap}>
          <article className="mx-auto max-w-3xl pt-10 pb-20 md:pt-14 md:pb-32">
            <Link
              to="/blog"
              className="group mb-10 inline-flex items-center gap-2 text-[15px] text-muted-foreground transition-colors hover:text-primary md:mb-14"
              viewTransition
            >
              <ArrowLeft className="size-4 transition-[translate] duration-300 ease-out-expo group-hover:-translate-x-1" />
              {m.blog_all_posts()}
            </Link>

            <header className="mb-10 border-b border-border pb-10 md:mb-14 md:pb-14">
              <div className="mb-5 flex items-center gap-2 text-[15px] text-muted-foreground">
                <time
                  className="tabular-nums"
                  style={{ viewTransitionName: `blog-date-${data.slug}` }}
                >
                  {formatBlogDate(data.date, locale, "long")}
                </time>
                {data.author && (
                  <>
                    <span aria-hidden>&middot;</span>
                    <span style={{ viewTransitionName: `blog-author-${data.slug}` }}>
                      {data.author}
                    </span>
                  </>
                )}
              </div>
              <h1
                className={sectionHeading}
                style={{ viewTransitionName: `blog-title-${data.slug}` }}
              >
                {data.title}
              </h1>
              <p
                className={`${sectionLead} mt-6`}
                style={{ viewTransitionName: `blog-desc-${data.slug}` }}
              >
                {data.description}
              </p>
            </header>

            <div className="prose prose-invert prose-lg max-w-none prose-headings:font-heading prose-headings:font-semibold prose-headings:tracking-[-0.03em] [&_:not(h1,h2,h3,h4,h5,h6)>a]:text-primary [&_:not(h1,h2,h3,h4,h5,h6)>a]:no-underline [&_:not(h1,h2,h3,h4,h5,h6)>a:hover]:underline prose-headings:text-fd-foreground prose-strong:text-fd-foreground prose-p:text-fd-muted-foreground prose-li:text-fd-muted-foreground">
              <Suspense>{clientLoader.useContent(data.path)}</Suspense>
            </div>
          </article>
        </div>
      </div>
      <Footer />
    </>
  );
}
