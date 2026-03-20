import browserCollections from "fumadocs-mdx:collections/browser";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { ArrowLeft } from "lucide-react";
import { Suspense } from "react";
import { blogposts } from "@/lib/source";

export const Route = createFileRoute("/blog/$slug")({
  component: BlogPost,
  loader: async ({ params: { slug } }) => {
    const data = await serverLoader({ data: slug });
    await clientLoader.preload(data.path);
    return data;
  },
});

const serverLoader = createServerFn({ method: "GET" })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const page = blogposts.getPage([slug]);

    if (!page) throw notFound();

    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      date: page.data.date,
      author: page.data.author,
    };
  });

const clientLoader = browserCollections.blog.createClientLoader({
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

function BlogPost() {
  const data = Route.useLoaderData();

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-7xl px-6">
        <article className="mx-auto max-w-3xl pb-20 pt-12 md:pb-32 md:pt-16">
          {/* Back link */}
          <Link
            to="/blog"
            className="group mb-10 inline-flex items-center gap-2 font-heading text-[11px] font-bold uppercase tracking-[0.2em] text-fd-muted-foreground/60 transition-colors hover:text-primary md:mb-14"
          >
            <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-1" />
            All posts
          </Link>

          {/* Post header */}
          <header className="mb-10 border-b-2 border-fd-border pb-10 md:mb-14 md:pb-14">
            <div className="mb-4 flex items-center gap-3">
              <time className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground/60">
                {new Date(data.date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
              {data.author && (
                <>
                  <span className="text-fd-border">&middot;</span>
                  <span className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground/60">
                    {data.author}
                  </span>
                </>
              )}
            </div>
            <h1 className="font-heading text-3xl font-bold uppercase leading-[0.95] sm:text-4xl md:text-5xl everr-decoration everr-decoration-primary">
              {data.title}
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-fd-muted-foreground">
              {data.description}
            </p>
          </header>

          {/* Post body */}
          <div className="prose prose-invert prose-lg max-w-none prose-headings:font-heading prose-headings:font-bold prose-headings:uppercase prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-fd-foreground prose-p:text-fd-muted-foreground prose-li:text-fd-muted-foreground">
            <Suspense>{clientLoader.useContent(data.path)}</Suspense>
          </div>
        </article>
      </div>
    </main>
  );
}
