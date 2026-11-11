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
import elixirLogo from "@/assets/logos/elixir.svg?url";
import javaLogo from "@/assets/logos/java.svg?url";
import pythonLogo from "@/assets/logos/python.svg?url";
import { CapabilityMarquee } from "@/components/capability-marquee";
import { TechnologyBackdrop } from "@/components/technology-backdrop";
import { sectionHeading, sectionLead, sectionWrap } from "@/components/ui/type";
import { m } from "@/paraglide/messages";

const CAPABILITIES = [
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

const STACK: Technology[] = [
  { label: "Elixir", image: elixirLogo },
  { label: "Node.js", icon: SiNodedotjs, color: SiNodedotjsHex },
  { label: "Rust", icon: SiRust, color: SiRustHex },
  { label: "Go", icon: SiGo, color: SiGoHex },
  { label: "Python", image: pythonLogo },
  { label: "TypeScript", icon: SiTypescript, color: SiTypescriptHex },
  { label: "PHP", icon: SiPhp, color: SiPhpHex },
  { label: "Java", image: javaLogo },
  { label: "Symfony", icon: SiSymfony, color: SiSymfonyHex },
  { label: "Laravel", icon: SiLaravel, color: SiLaravelHex },
  { label: "TanStack", icon: SiTanstack, color: SiTanstackHex },
  { label: "Next.js", icon: SiNextdotjs, color: SiNextdotjsHex },
  { label: "Express", icon: SiExpress, color: SiExpressHex },
  { label: "NestJS", icon: SiNestjs, color: SiNestjsHex },
  { label: "Django", icon: SiDjango, color: SiDjangoHex },
  { label: "FastAPI", icon: SiFastapi, color: SiFastapiHex },
];

// The one part of the page written for people who already know the field,
// in the field's own terms.
export function UnderTheHood() {
  return (
    <section className="border-t border-border text-foreground">
      <div className="relative isolate overflow-hidden bg-fd-card/40">
        <div
          className={`${sectionWrap} isolate grid min-h-[560px] content-start py-14 sm:min-h-[520px] sm:content-center md:py-28`}
        >
          <TechnologyBackdrop items={STACK} />
          <h2 className={`${sectionHeading} pointer-events-none relative z-10 max-w-[12ch]`}>
            {m.engineers_heading()}
          </h2>
          <p className={`${sectionLead} pointer-events-none relative z-10 mt-7 max-w-[40ch]`}>
            {m.engineers_lead()}
          </p>
          <span className="sr-only">
            {m.engineers_stack({ list: STACK.map((item) => item.label).join(", ") })}
          </span>
        </div>
      </div>

      <div className="overflow-hidden border-t border-border bg-background py-12 sm:py-16">
        <CapabilityMarquee features={CAPABILITIES} />
      </div>
    </section>
  );
}
