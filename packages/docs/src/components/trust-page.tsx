import { Fragment, type ReactNode } from "react";
import { Footer } from "@/components/footer";
import { SITE_URL, type TrustPage } from "@/content/trust-pages";

/**
 * The shared layout for /about, /contact and /privacy. It renders the same
 * text the Markdown twin serves, so the two never disagree.
 */
export function TrustPageView({ page }: { page: TrustPage }) {
  return (
    <div className="overflow-x-clip">
      <article className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
          {page.headline}
        </h1>

        {page.intro.map((paragraph) => (
          <p
            key={paragraph}
            className="mt-6 text-lg leading-relaxed text-fd-muted-foreground"
          >
            <Linked text={paragraph} />
          </p>
        ))}

        {page.sections.map((section) => (
          <section key={section.heading} className="mt-12">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {section.heading}
            </h2>

            {section.paragraphs?.map((paragraph) => (
              <p
                key={paragraph}
                className="mt-4 leading-relaxed text-fd-muted-foreground"
              >
                <Linked text={paragraph} />
              </p>
            ))}

            {section.bullets ? (
              <ul className="mt-4 list-disc space-y-2 ps-5 text-fd-muted-foreground">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="leading-relaxed">
                    <Linked text={bullet} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </article>

      <Footer />
    </div>
  );
}

/**
 * URLs and email addresses appear as bare text in the content, because that is
 * how they read in Markdown. On the rendered page they have to be clickable,
 * so they are turned into links here rather than duplicated as link markup.
 */
const LINKABLE = /(https?:\/\/[^\s),]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g;

function Linked({ text }: { text: string }): ReactNode {
  const parts = text.split(LINKABLE);

  return parts.map((part, index) => {
    // Odd indexes are the captured URLs and addresses.
    if (index % 2 === 0) return <Fragment key={part + index}>{part}</Fragment>;

    // A sentence-ending period sits inside the match; it is punctuation, not
    // part of the address.
    const trailing = part.match(/[.,;:!?]+$/)?.[0] ?? "";
    const target = trailing ? part.slice(0, -trailing.length) : part;
    const href = target.includes("@") ? `mailto:${target}` : target;
    const external = href.startsWith("http") && !href.startsWith(SITE_URL);

    return (
      <Fragment key={part + index}>
        <a
          href={href}
          {...(external
            ? { target: "_blank", rel: "noopener noreferrer" }
            : undefined)}
          className="text-fd-foreground underline underline-offset-4 transition-colors hover:text-primary"
        >
          {target}
        </a>
        {trailing}
      </Fragment>
    );
  });
}
