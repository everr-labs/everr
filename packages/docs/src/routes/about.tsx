import { createFileRoute } from "@tanstack/react-router";
import { TrustPageView } from "@/components/trust-page";
import { ABOUT_PAGE } from "@/content/trust-pages";
import { pageSeoTags } from "@/lib/seo";
import { jsonLdScript, sitewideJsonLd } from "@/lib/structured-data";

export const Route = createFileRoute("/about")({
  component: AboutPage,
  head: () => {
    const { meta, links } = pageSeoTags({
      title: ABOUT_PAGE.metaTitle,
      description: ABOUT_PAGE.description,
      path: ABOUT_PAGE.path,
    });

    return { meta, links, scripts: [jsonLdScript(sitewideJsonLd())] };
  },
});

function AboutPage() {
  return <TrustPageView page={ABOUT_PAGE} />;
}
