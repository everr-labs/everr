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
import {
  Activity,
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  Clapperboard,
  ListFilter,
  Monitor,
} from "lucide-react";
import elixirLogo from "@/assets/logos/elixir.svg?url";
import javaLogo from "@/assets/logos/java.svg?url";
import pythonLogo from "@/assets/logos/python.svg?url";
import { Community } from "@/components/community";
import { FAQ } from "@/components/faq";
import { FeaturedTestimonial } from "@/components/featured-testimonial";
import { FeaturesZigzag } from "@/components/features-zigzag";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { TechnologyBackdrop } from "@/components/technology-backdrop";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

const observabilityFeatures = [
  { label: "Metrics", icon: ChartNoAxesCombined },
  { label: "Logs", icon: ListFilter },
  { label: "Traces", icon: Activity },
  { label: "Alerting", icon: Bell },
];

const additionalFeatures = [
  { label: "Session replay", icon: Clapperboard, planned: true },
  { label: "Frontend observability", icon: Monitor, planned: false },
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
        <div className="capabilities-inner">
          <div className="capabilities-heading">
            <h2>Everything you expect from a modern observability platform.</h2>
          </div>
          <ul className="capabilities-core">
            TODO: more keywords.
            {observabilityFeatures.map(({ label, icon: Icon }) => (
              <li key={label}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <div className="capabilities-browser">
            <h3>For the work happening in your browser.</h3>
            <ul>
              {additionalFeatures.map(({ label, icon: Icon, planned }) => (
                <li key={label}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  {planned && <small>Planned</small>}
                </li>
              ))}
            </ul>
          </div>
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
        <div className="local-inner">
          <div className="local-copy">
            <h2>
              Let your own code
              <br />
              convince you.
            </h2>
            <p className="local-description">
              Run Everr on your machine. Explore your telemetry and give your
              coding agent an immediate feedback loop.
            </p>
          </div>
          <div className="local-action">Ask your AI about us.</div>
        </div>
      </section>
      <FAQ />
      <Community />
      <FinalCTA />
      <Footer />
    </div>
  );
}
