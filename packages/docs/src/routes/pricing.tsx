import { createFileRoute } from "@tanstack/react-router";
import { Footer } from "@/components/footer";
import { PricingCalculator } from "@/components/pricing-calculator";
import { PricingCards } from "@/components/pricing-cards";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
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
