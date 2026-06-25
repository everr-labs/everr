import { createFileRoute } from "@tanstack/react-router";
import { AgentsCompare } from "@/components/agents-compare";
import { Community } from "@/components/community";
import { FAQ } from "@/components/faq";
import { FeaturedTestimonial } from "@/components/featured-testimonial";
import { FeaturesZigzag } from "@/components/features-zigzag";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import {
  OpenStandards,
  ProblemToolSprawl,
} from "@/components/placeholder-sections";
import { PricingToggle } from "@/components/pricing-toggle";
import { QuickstartFriction } from "@/components/quickstart-friction";
import { Species } from "@/components/species";
import { ToolsExplainer } from "@/components/tools-explainer";
import { VideoSection } from "@/components/video-section";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="overflow-x-clip">
      <Hero />
      <Species />
      <ProblemToolSprawl />
      <OpenStandards />
      <VideoSection />
      <FeaturesZigzag />
      <AgentsCompare />
      <ToolsExplainer />
      <QuickstartFriction />
      <HowItWorks />
      <PricingToggle />
      <FeaturedTestimonial />
      <FAQ />
      <Community />
      <FinalCTA />
      <Footer />
    </div>
  );
}
