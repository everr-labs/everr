import { cn } from "@everr/ui/lib/utils";
import { ChartNoAxesCombined, Fingerprint, Workflow } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { MonitoringDemo } from "@/components/monitoring-demo/MonitoringDemo";

const examples = [
  {
    id: "performance",
    label: "How your application performs",
    icon: Workflow,
    description:
      "A successful request can still be too slow. Follow its trace to see where time goes, from application code to database queries and external services.",
  },
  {
    id: "traffic",
    label: "How it handles traffic spikes",
    icon: ChartNoAxesCombined,
    description:
      "More traffic is only part of the picture. Read request volume alongside response times and error rates to see how your application behaves under load.",
  },
  {
    id: "failures",
    label: "Why requests fail",
    icon: Fingerprint,
    description:
      "An error message is a starting point. Read the stack trace and related logs in the context of the failed request to understand what happened and where to investigate.",
  },
];

// The list follows the demo: each item opens while its screen is on show.
function MonitoringShowcase() {
  const [screen, setScreen] = useState(0);
  return (
    <div className="grid overflow-hidden rounded-xl border border-border bg-card min-[900px]:grid-cols-[minmax(0,30%)_minmax(0,1fr)]">
      <ol className="flex min-w-0 flex-col max-[899px]:border-b max-[899px]:border-border min-[900px]:border-r min-[900px]:border-border">
        {examples.map(({ id, label, description, icon: Icon }, i) => {
          const active = screen === i;
          return (
            <li key={id} className="border-b border-border last:border-b-0">
              <h3
                className={cn(
                  "flex items-center gap-2.5 px-6 py-5 text-[15px] font-medium leading-[1.45] text-muted-foreground transition-colors duration-200 max-sm:p-[18px] [&>svg]:size-[18px] [&>svg]:shrink-0",
                  active && "text-foreground",
                )}
              >
                <Icon className={active ? "text-primary" : undefined} aria-hidden="true" />
                {label}
              </h3>
              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                  active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <p className="overflow-hidden px-6 pl-[52px] text-sm leading-[1.65] text-muted-foreground max-sm:pr-[18px] max-sm:pl-[46px]">
                  <span className="block pb-6 max-sm:pb-5">{description}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <figure className="min-w-0 overflow-hidden">
        <MonitoringDemo onScreen={setScreen} />
      </figure>
    </div>
  );
}

export function MonitoringSection() {
  return (
    <section className="relative overflow-hidden border-y-2 border-fd-border bg-fd-background">
      <div className="mx-auto max-w-7xl px-6 py-10 text-foreground sm:py-[72px]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mb-8 grid items-end gap-5 min-[900px]:grid-cols-2 min-[900px]:gap-16"
        >
          <h2 className="max-w-[18ch] text-balance text-[clamp(30px,3.5vw,44px)] leading-[1.12] tracking-[-0.025em]">
            An app can be up and still let users down
          </h2>
          <p className="max-w-[62ch] text-base leading-[1.65] text-muted-foreground">
            Monitoring goes beyond error reporting. See where your app slows down, how it responds
            to demand, and what led to a failure.
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <MonitoringShowcase />
        </motion.div>
      </div>
    </section>
  );
}
