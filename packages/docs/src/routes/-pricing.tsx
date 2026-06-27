import { createFileRoute } from "@tanstack/react-router";
import { FAQ } from "@/components/faq";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { PricingMatrix } from "@/components/pricing-matrix";

/**
 * Detailed pricing — the full plan-comparison matrix on its own page,
 * linked from the homepage's pricing section for buyers who want the
 * feature-by-feature breakdown.
 */
export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

function PricingPage() {
  return (
    <div className="overflow-x-clip">
      <PricingMatrix />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
