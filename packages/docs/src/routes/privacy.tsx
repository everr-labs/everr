import { createFileRoute } from "@tanstack/react-router";
import { TrustPageView } from "@/components/trust-page";
import { PRIVACY_PAGE } from "@/content/trust-pages";
import { pageSeoTags } from "@/lib/seo";
import { jsonLdScript, sitewideJsonLd } from "@/lib/structured-data";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => {
    const { meta, links } = pageSeoTags({
      title: PRIVACY_PAGE.metaTitle,
      description: PRIVACY_PAGE.description,
      path: PRIVACY_PAGE.path,
    });

    return { meta, links, scripts: [jsonLdScript(sitewideJsonLd())] };
  },
});

function PrivacyPage() {
  return <TrustPageView page={PRIVACY_PAGE} />;
}
