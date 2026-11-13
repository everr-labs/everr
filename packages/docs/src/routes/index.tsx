import { createFileRoute } from "@tanstack/react-router";
import { AskAiSection } from "@/components/ask-ai-section";
import { FAQ } from "@/components/faq";
import { FeaturedTestimonial } from "@/components/featured-testimonial";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { MonitoringSection } from "@/components/monitoring-section";
import { UnderTheHood } from "@/components/under-the-hood";
import { pageHead } from "@/lib/page-head";
import { jsonLdScript, siteStructuredData } from "@/lib/structured-data";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/")({
  component: RouteComponent,
  head: () => ({
    ...pageHead("/", "Everr - Observability made simple", m.hero_lead()),
    scripts: [jsonLdScript(siteStructuredData())],
  }),
});

function RouteComponent() {
  return (
    <div className="overflow-x-clip">
      <Hero />
      <MonitoringSection />
      <HowItWorks />
      <FeaturedTestimonial />
      <UnderTheHood />
      <AskAiSection />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
