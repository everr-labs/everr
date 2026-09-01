import { createFileRoute } from "@tanstack/react-router";
import { TrustPageView } from "@/components/trust-page";
import { CONTACT_PAGE } from "@/content/trust-pages";
import { pageSeoTags } from "@/lib/seo";
import { jsonLdScript, sitewideJsonLd } from "@/lib/structured-data";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => {
    const { meta, links } = pageSeoTags({
      title: CONTACT_PAGE.metaTitle,
      description: CONTACT_PAGE.description,
      path: CONTACT_PAGE.path,
    });

    return { meta, links, scripts: [jsonLdScript(sitewideJsonLd())] };
  },
});

function ContactPage() {
  return <TrustPageView page={CONTACT_PAGE} />;
}
