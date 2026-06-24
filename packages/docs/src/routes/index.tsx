import { createFileRoute } from "@tanstack/react-router";
import { Community } from "@/components/community";
import { FAQ } from "@/components/faq";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import {
  BusinessObservability,
  Features,
  Integrations,
  LogoCloud,
  PricingTeaser,
  ProblemToolSprawl,
  Testimonials,
  TimeToValue,
} from "@/components/placeholder-sections";
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
      <LogoCloud />
      <Species />
      <ProblemToolSprawl />
      <VideoSection />
      <Features />
      <ToolsExplainer />
      <TimeToValue />
      <HowItWorks />
      <BusinessObservability />
      <Integrations />
      <PricingTeaser />
      <Testimonials />
      <FAQ />
      <Community />
      <FinalCTA />
      <Footer />
    </div>
  );
}
