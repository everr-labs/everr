import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { blogposts } from "@/lib/source";

export const Route = createFileRoute("/blog/")({
  component: BlogIndex,
  loader: async () => {
    return await loadBlogPosts();
  },
});

const loadBlogPosts = createServerFn({ method: "GET" }).handler(async () => {
  return await blogposts
    .getPages()
    .map((post) => ({
      slug: post.slugs.join("/"),
      title: post.data.title,
      description: post.data.description,
      date: post.data.date,
      author: post.data.author,
    }))
    .filter((post) => !post.draft);
});

function BlogIndex() {
  const posts = Route.useLoaderData();

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-7xl px-6">
        {/* Header */}
        <section className="pb-16 pt-20 md:pb-20 md:pt-28">
          <p className="mb-3 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            Blog
          </p>
          <h1 className="font-heading text-3xl uppercase leading-[0.95] sm:text-4xl md:text-5xl lg:text-6xl everr-decoration everr-decoration-primary">
            Updates & insights
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
            Product updates, engineering deep dives, and CI/CD best practices
            from the Everr team.
          </p>
        </section>

        {/* Posts */}
        <section className="pb-20 md:pb-32">
          <div className="flex flex-col">
            {posts.map((post, i) => (
              <Link
                key={post.slug}
                to="/blog/$slug"
                params={{ slug: post.slug }}
                className="group"
              >
                <div
                  className={`grid grid-cols-1 gap-4 py-8 transition-colors md:grid-cols-[180px_1fr_auto] md:items-center md:gap-8 ${
                    i > 0 ? "border-t-2 border-fd-border" : ""
                  }`}
                >
                  <div className="flex flex-col gap-1">
                    <time className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground/60">
                      {new Date(post.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                    {post.author && (
                      <span className="font-heading text-[11px] uppercase tracking-wider text-fd-muted-foreground/40">
                        {post.author}
                      </span>
                    )}
                  </div>

                  <div>
                    <h2 className="font-heading text-xl font-bold transition-colors group-hover:text-primary md:text-2xl everr-decoration everr-decoration-primary">
                      {post.title}
                    </h2>
                    <p className="mt-2 text-fd-muted-foreground line-clamp-2">
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
