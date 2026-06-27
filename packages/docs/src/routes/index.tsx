import { createFileRoute } from "@tanstack/react-router";
import { AgentsCompare } from "@/components/agents-compare";
import { Community } from "@/components/community";
import { FAQ } from "@/components/faq";
import { FeaturedTestimonial } from "@/components/featured-testimonial";
import { FeaturesZigzag } from "@/components/features-zigzag";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { OpenStandardsBento } from "@/components/open-standards-bento";
import { QuickstartFriction } from "@/components/quickstart-friction";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="overflow-x-clip">
      <Hero />
      <FeaturesZigzag />
      <QuickstartFriction />
      <AgentsCompare />
      <OpenStandardsBento />
      <FeaturedTestimonial />
      <FAQ />
      <Community />
      <FinalCTA />
      <Footer />
    </div>
  );
}
