import { createFileRoute } from "@tanstack/react-router";
import { Footer } from "@/components/footer";
import { PricingCalculator } from "@/components/pricing-calculator";
import { PricingCards } from "@/components/pricing-cards";
import { pageSeoTags } from "@/lib/seo";
import { jsonLdScript, sitewideJsonLd } from "@/lib/structured-data";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => {
    const { meta, links } = pageSeoTags({
      title: "Pricing - Everr",
      description:
        "Everr pricing: a free plan with 30 day retention, and Pro with 90 day traces and logs and 13 month metrics. Includes an ingest cost calculator.",
      path: "/pricing",
      ogType: "product",
    });

    return { meta, links, scripts: [jsonLdScript(sitewideJsonLd())] };
  },
});

function PricingPage() {
  return (
    <div className="overflow-x-clip">
      <PricingCards />
      <PricingCalculator />
      <Footer />
    </div>
  );
}
