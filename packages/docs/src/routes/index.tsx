import { createFileRoute } from "@tanstack/react-router";
import { AskAiSection } from "@/components/ask-ai-section";
import { CapabilitiesSection } from "@/components/capabilities-section";
import { FAQ } from "@/components/faq";
import { FeaturedTestimonial } from "@/components/featured-testimonial";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { MonitoringSection } from "@/components/monitoring-section";
import { ObservabilityVision } from "@/components/observability-vision";
import { SkepticSection } from "@/components/skeptic-section";
import { TechnologySection } from "@/components/technology-section";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="overflow-x-clip">
      <Hero />
      <MonitoringSection />
      <ObservabilityVision />
      <SkepticSection />
      <CapabilitiesSection />
      <TechnologySection />
      <FeaturedTestimonial />
      <AskAiSection />
      <FinalCTA />
      <FAQ />
      <Footer />
    </div>
  );
}
