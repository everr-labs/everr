import { createFileRoute } from "@tanstack/react-router";
import { Community } from "@/components/community";
import { FAQ } from "@/components/faq";
import { FeaturedTestimonial } from "@/components/featured-testimonial";
import { FeaturesAccordion } from "@/components/features-accordion";
import { FeaturesBento } from "@/components/features-bento";
import { FeaturesCarousel } from "@/components/features-carousel";
import { FeaturesScrolly } from "@/components/features-scrolly";
import { FeaturesStack } from "@/components/features-stack";
import { FeaturesTabs } from "@/components/features-tabs";
import { FeaturesZigzag } from "@/components/features-zigzag";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import {
  AIAssistant,
  OpenStandards,
  PricingTeaser,
  ProblemToolSprawl,
  TimeToValue,
} from "@/components/placeholder-sections";
import { PricingCalculator } from "@/components/pricing-calculator";
import { PricingMatrix } from "@/components/pricing-matrix";
import { PricingNarrative } from "@/components/pricing-narrative";
import { PricingSingle } from "@/components/pricing-single";
import { PricingTco } from "@/components/pricing-tco";
import { PricingTiers } from "@/components/pricing-tiers";
import { PricingToggle } from "@/components/pricing-toggle";
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
      {/* Features section — layout candidates, pick one then delete the rest. */}
      <FeaturesBento />
      <FeaturesTabs />
      <FeaturesScrolly />
      <FeaturesZigzag />
      <FeaturesCarousel />
      <FeaturesStack />
      <FeaturesAccordion />
      <AIAssistant />
      <ToolsExplainer />
      <TimeToValue />
      <HowItWorks />
      <PricingTeaser />
      {/* Pricing section — layout candidates, pick one then delete the rest. */}
      <PricingTiers />
      <PricingMatrix />
      <PricingCalculator />
      <PricingTco />
      <PricingSingle />
      <PricingToggle />
      <PricingNarrative />
      <FeaturedTestimonial />
      <FAQ />
      <Community />
      <FinalCTA />
      <Footer />
    </div>
  );
}
