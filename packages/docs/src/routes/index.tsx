import { createFileRoute } from "@tanstack/react-router";
import { Community } from "@/components/community";
import { FAQ } from "@/components/faq";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { Species } from "@/components/species";
import { ToolsExplainer } from "@/components/tools-explainer";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="overflow-x-clip">
      <Hero />
      <Species />
      <ToolsExplainer />
      <HowItWorks />
      <FAQ />
      <Community />
      <FinalCTA />
      <Footer />
    </div>
  );
}
