import browserCollections from "fumadocs-mdx:collections/browser";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Suspense } from "react";
import { Footer } from "@/components/footer";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";
import { pageHead, seoHead } from "@/lib/page-head";
import { getSitePage } from "@/lib/source";
import { isTranslatedPath } from "@/lib/translated";
import { getLocale } from "@/paraglide/runtime";

// About, Contact, Privacy: one MDX file each in content/pages
export const Route = createFileRoute("/$page")({
  component: SitePage,
  // /contact and /it/contatti are the same route once the locale is stripped: the locale
  // keeps their loader data apart, so switching language never shows the other one
  loaderDeps: () => ({ locale: getLocale() }),
  loader: async ({ params: { page }, deps: { locale } }) => {
    // The server function's own URL carries no locale: pass the page's
    const data = await serverLoader({ data: { slug: page, locale } });
    await clientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const path = `/${loaderData.slug}`;
    const { title, description } = loaderData;
    return isTranslatedPath(path)
      ? pageHead(path, title, description)
      : seoHead({ path, title, description });
  },
});

const serverLoader = createServerFn({ method: "GET" })
  .validator((data: { slug: string; locale: string }) => data)
  .handler(async ({ data: { slug, locale } }) => {
    const page = getSitePage(slug, locale);
    if (!page) throw notFound();

    return {
      slug,
      path: page.path,
      title: page.data.title,
      description: page.data.description,
    };
  });

const clientLoader = browserCollections.pages.createClientLoader({
  component({ default: MDX }) {
    return <MDX components={{ ...defaultMdxComponents }} />;
  },
});

function SitePage() {
  const data = Route.useLoaderData();

  return (
    <>
      <div className="flex-1 text-foreground">
        <div className={sectionWrap}>
          <article className="mx-auto max-w-3xl pt-10 pb-20 md:pt-14 md:pb-32">
            <header className="mb-10 border-b border-border pb-10 md:mb-14 md:pb-14">
              <h1 className={sectionHeading}>{data.title}</h1>
              <p className={`${sectionLead} mt-6`}>{data.description}</p>
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
