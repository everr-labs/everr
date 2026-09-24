import {
  SiDjango,
  SiDjangoHex,
  SiExpress,
  SiExpressHex,
  SiFastapi,
  SiFastapiHex,
  SiGo,
  SiGoHex,
  SiLaravel,
  SiLaravelHex,
  SiNestjs,
  SiNestjsHex,
  SiNextdotjs,
  SiNextdotjsHex,
  SiNodedotjs,
  SiNodedotjsHex,
  SiPhp,
  SiPhpHex,
  SiRust,
  SiRustHex,
  SiSymfony,
  SiSymfonyHex,
  SiTanstack,
  SiTanstackHex,
  SiTypescript,
  SiTypescriptHex,
} from "@icons-pack/react-simple-icons";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import elixirLogo from "@/assets/logos/elixir.svg?url";
import javaLogo from "@/assets/logos/java.svg?url";
import pythonLogo from "@/assets/logos/python.svg?url";
import { AskAiComposer } from "@/components/ask-ai-composer";
import { CapabilityMarquee } from "@/components/capability-marquee";
import { Community } from "@/components/community";
import { FAQ } from "@/components/faq";
import { FeaturedTestimonial } from "@/components/featured-testimonial";
import { FeaturesZigzag } from "@/components/features-zigzag";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { ObservabilityVision } from "@/components/observability-vision";
import { TechnologyBackdrop } from "@/components/technology-backdrop";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

const platformFeatures = [
  { label: "APM", planned: false },
  { label: "Frontend observability", planned: false },
  { label: "Session replay", planned: true },
  { label: "Database observability", planned: false },
  { label: "Kubernetes observability", planned: false },
  { label: "Error tracking", planned: false },
  { label: "Metrics", planned: false },
  { label: "Logs", planned: false },
  { label: "Distributed tracing", planned: false },
  { label: "Alerting", planned: false },
  { label: "Dashboards", planned: false },
  { label: "CI observability", planned: false },
  { label: "Synthetic monitoring", planned: true },
  { label: "Hosted status pages", planned: true },
  { label: "Uptime monitoring", planned: true },
  { label: "Infrastructure monitoring", planned: false },
  { label: "Serverless observability", planned: false },
  { label: "Real user monitoring", planned: false },
  { label: "Mobile observability", planned: false },
  { label: "Service maps", planned: false },
  { label: "SLO monitoring", planned: false },
  { label: "Anomaly detection", planned: true },
  { label: "Deployment tracking", planned: true },
  { label: "LLM observability", planned: true },
  { label: "AI-assisted investigation", planned: false },
  { label: "Observability as code", planned: false },
];

type Technology =
  | { label: string; image: string }
  | { label: string; icon: typeof SiGo; color: string };

const languages: Technology[] = [
  { label: "Elixir", image: elixirLogo },
  { label: "Node.js", icon: SiNodedotjs, color: SiNodedotjsHex },
  { label: "Rust", icon: SiRust, color: SiRustHex },
  { label: "Go", icon: SiGo, color: SiGoHex },
  { label: "Python", image: pythonLogo },
  { label: "TypeScript", icon: SiTypescript, color: SiTypescriptHex },
  { label: "PHP", icon: SiPhp, color: SiPhpHex },
  { label: "Java", image: javaLogo },
];

const frameworks: Technology[] = [
  { label: "Symfony", icon: SiSymfony, color: SiSymfonyHex },
  { label: "Laravel", icon: SiLaravel, color: SiLaravelHex },
  { label: "TanStack", icon: SiTanstack, color: SiTanstackHex },
  { label: "Next.js", icon: SiNextdotjs, color: SiNextdotjsHex },
  { label: "Express", icon: SiExpress, color: SiExpressHex },
  { label: "NestJS", icon: SiNestjs, color: SiNestjsHex },
  { label: "Django", icon: SiDjango, color: SiDjangoHex },
  { label: "FastAPI", icon: SiFastapi, color: SiFastapiHex },
];

function RouteComponent() {
  return (
    <div className="overflow-x-clip">
      <Hero />
      <FeaturesZigzag />
      <ObservabilityVision />
      <section className="everr-skeptic">
        <div className="skeptic-note">
          <h2>Still don't believe it can be that simple?</h2>
          <div>
            <p>If the effort feels bigger than the payoff, start here.</p>
            <a className="skeptic-link" href="/why-observability">
              A case for the skeptics
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
      <section className="everr-capabilities">
        <div className="cap-motion">
          <h2 className="cap-motion-title">
            Everything you expect from a modern observability platform.
          </h2>
          <CapabilityMarquee features={platformFeatures} />
        </div>
      </section>
      <section className="technology-section bg-fd-card/40">
        <div className="technology-scene">
          <TechnologyBackdrop items={[...languages, ...frameworks]} />
          <h2>Everr works with the stack you already run.</h2>
          <span className="sr-only">
            Languages and runtimes:{" "}
            {languages.map((item) => item.label).join(", ")}. Frameworks:{" "}
            {frameworks.map((item) => item.label).join(", ")}.
          </span>
        </div>
      </section>
      <FeaturedTestimonial />
      <section className="everr-local">
        <div className="ask-layout">
          <div className="ask-intro">
            <h2>Let your AI kick the tires.</h2>
            <p>
              Ask it to read the docs, question the fit, and tell you where
              Everr could help your project.
            </p>
          </div>
          <div className="ask-chat">
            <AskAiComposer />
          </div>
        </div>
      </section>
      <FinalCTA />
      <FAQ />
      <Footer />
    </div>
  );
}
