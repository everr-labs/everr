import { CapabilityMarquee } from "@/components/capability-marquee";

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

export function CapabilitiesSection() {
  return (
    <section className="border-y border-border bg-background text-foreground">
      <div className="overflow-hidden py-12 sm:py-[72px]">
        <h2 className="mx-auto mb-8 max-w-[850px] px-6 text-center text-balance text-[32px] leading-[1.14] tracking-[-0.03em] sm:mb-12 sm:text-[clamp(30px,3.5vw,46px)]">
          Everything you expect from a modern observability platform.
        </h2>
        <CapabilityMarquee features={platformFeatures} />
      </div>
    </section>
  );
}
