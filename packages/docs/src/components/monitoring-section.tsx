import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { cn } from "@everr/ui/lib/utils";
import {
  Activity,
  ChartNoAxesCombined,
  ChevronDown,
  Fingerprint,
  Workflow,
} from "lucide-react";
import { motion } from "motion/react";
import { useId, useState } from "react";

const demoClassName =
  "min-h-[388px] overflow-hidden bg-card max-[1100px]:min-h-[430px] max-[700px]:min-h-[425px]";
const demoBarClassName =
  "flex flex-wrap justify-between gap-2 border-b border-[var(--color-fd-border)] px-7 py-4 text-xs text-muted-foreground max-[700px]:p-4";
const demoBodyClassName = "px-7 py-6 max-[700px]:p-4";
const requestClassName =
  "flex flex-wrap items-center justify-between gap-3 text-sm";
const traceRowClassName =
  "grid grid-cols-[130px_minmax(0,1fr)_82px] items-center gap-5 p-3 font-mono text-[0.8125rem] max-[700px]:grid-cols-[88px_minmax(0,1fr)_52px] max-[700px]:gap-2 max-[700px]:px-0 max-[700px]:text-xs";

const examples = [
  {
    id: "performance",
    label: "How your application performs",
    icon: Workflow,
    view: TraceExample,
    description:
      "A successful request can still be too slow. Follow its trace to see where time goes, from application code to database queries and external services.",
  },
  {
    id: "traffic",
    label: "How it handles traffic spikes",
    icon: ChartNoAxesCombined,
    view: TrafficExample,
    description:
      "More traffic is only part of the picture. Read request volume alongside response times and error rates to see how your application behaves under load.",
  },
  {
    id: "failures",
    label: "Why requests fail",
    icon: Fingerprint,
    view: ErrorExample,
    description:
      "An error message is a starting point. Read the stack trace and related logs in the context of the failed request to understand what happened and where to investigate.",
  },
];

function TraceExample() {
  return (
    <div className={demoClassName}>
      <div className={demoBarClassName}>
        <span className="text-foreground">Trace detail</span>
        <span>Illustrative example</span>
      </div>
      <div className={demoBodyClassName}>
        <div className={requestClassName}>
          <div>
            <span className="mr-2 text-[#32c8cc]">GET</span>{" "}
            <code>/projects</code>
          </div>
          <span className="text-muted-foreground">
            200 OK <strong className="ml-3 text-foreground">2.10 s</strong>
          </span>
        </div>
        <div className="mt-7 mb-[22px]">
          <div
            className={cn(
              traceRowClassName,
              "pt-0 text-xs text-muted-foreground",
            )}
          >
            <span>Operation</span>
            <div className="flex justify-between">
              <span>0 s</span>
              <span className="max-[700px]:hidden">1 s</span>
              <span>2.1 s</span>
            </div>
            <span className="text-right">Duration</span>
          </div>
          {[
            { label: "Request", duration: "2.10 s", start: 0, width: 100 },
            { label: "Authenticate", duration: "20 ms", start: 0, width: 0.95 },
            {
              label: "Database",
              duration: "2.04 s",
              start: 0.95,
              width: 97.14,
            },
            { label: "Response", duration: "40 ms", start: 98.09, width: 1.91 },
          ].map((row) => (
            <div
              className={cn(
                traceRowClassName,
                row.label === "Database" &&
                  "rounded-md bg-[color-mix(in_srgb,#32c8cc_7%,transparent)]",
              )}
              key={row.label}
            >
              <span>{row.label}</span>
              <div className="h-2.5 bg-[var(--color-fd-border)]">
                <span
                  className="block h-full rounded-sm bg-[#32c8cc]"
                  style={{
                    marginLeft: `${row.start}%`,
                    width: `${row.width}%`,
                  }}
                />
              </div>
              <span className="text-right">{row.duration}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2.5 text-[0.8125rem] text-[#32c8cc] max-[700px]:items-start">
          <Activity className="shrink-0" size={16} aria-hidden="true" /> The
          database accounts for 97% of request time.
        </div>
      </div>
    </div>
  );
}

function TrafficExample() {
  const chartTitle = useId();
  return (
    <div className={demoClassName}>
      <div className={demoBarClassName}>
        <span className="text-foreground">Traffic overview</span>
        <span>Illustrative example</span>
      </div>
      <div className={demoBodyClassName}>
        <div className={requestClassName}>
          <strong className="text-foreground">
            Request rate{" "}
            <small className="ml-1.5 font-normal text-muted-foreground">
              req/s
            </small>
          </strong>
          <span className="text-muted-foreground">10:00 - 10:15</span>
        </div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_160px] items-center gap-6 max-[1100px]:grid-cols-1 max-[1100px]:gap-4">
          <svg
            className="h-auto w-full fill-muted-foreground font-mono text-[20px] max-[1100px]:text-[24px] max-[700px]:text-[28px]"
            viewBox="0 0 600 230"
            role="img"
            aria-labelledby={chartTitle}
          >
            <title id={chartTitle}>
              Request rate from 10:00 to 10:15, with two spikes reaching
              approximately 400 and 800 requests per second.
            </title>
            {[30, 110, 190].map((y) => (
              <line
                key={y}
                x1="45"
                y1={y}
                x2="580"
                y2={y}
                className="stroke-[var(--color-fd-border)] [stroke-dasharray:4_4]"
              />
            ))}
            <text x="0" y="35">
              800
            </text>
            <text x="0" y="115">
              400
            </text>
            <text x="20" y="195">
              0
            </text>
            <path
              d="M45 187 L80 185 L110 184 L145 185 L175 180 L195 112 L215 172 L240 182 L275 174 L300 30 L325 86 L345 178 L380 183 L415 179 L450 184 L490 181 L535 185 L580 182 L580 190 L45 190 Z"
              className="fill-[color-mix(in_srgb,#32c8cc_10%,transparent)]"
            />
            <path
              d="M45 187 L80 185 L110 184 L145 185 L175 180 L195 112 L215 172 L240 182 L275 174 L300 30 L325 86 L345 178 L380 183 L415 179 L450 184 L490 181 L535 185 L580 182"
              className="fill-none stroke-[#32c8cc] stroke-[2.5] [stroke-linejoin:round]"
            />
            <text x="45" y="220">
              10:00
            </text>
            <text x="310" y="220" textAnchor="middle">
              10:07
            </text>
            <text x="580" y="220" textAnchor="end">
              10:15
            </text>
          </svg>
          <div className="grid gap-6 max-[1100px]:grid-cols-2 max-[700px]:gap-5">
            <div>
              <p className="text-[0.8125rem]">P95 response time</p>
              <strong className="text-[2rem] font-medium">
                420 <span className="text-base text-muted-foreground">ms</span>
              </strong>
              <meter
                className="mt-2 block h-3 w-full [&::-moz-meter-bar]:bg-primary [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-[var(--color-fd-border)] [&::-webkit-meter-optimum-value]:bg-primary"
                min={0}
                max={1000}
                value={420}
                aria-label="P95 response time: 420 milliseconds on a 0 to 1000 millisecond scale"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>0 ms</span>
                <span>1,000 ms</span>
              </div>
            </div>
            <div>
              <p className="text-[0.8125rem]">Error rate</p>
              <strong className="text-[2rem] font-medium">
                0.7<span className="text-base text-muted-foreground">%</span>
              </strong>
              <meter
                className="mt-2 block h-3 w-full [&::-moz-meter-bar]:bg-primary [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-[var(--color-fd-border)] [&::-webkit-meter-optimum-value]:bg-primary"
                min={0}
                max={10}
                value={0.7}
                aria-label="Error rate: 0.7 percent on a 0 to 10 percent scale"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span>10%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorExample() {
  return (
    <div className={demoClassName}>
      <div className={demoBarClassName}>
        <span className="text-foreground">Error detail</span>
        <span>Illustrative example</span>
      </div>
      <div className={demoBodyClassName}>
        <div className={requestClassName}>
          <div>
            <span className="mr-2 text-[#fb978b]">ERROR</span>{" "}
            <code>POST /checkout</code>
          </div>
          <span className="text-muted-foreground">10:12:08</span>
        </div>
        <div className="mt-6 border-l-2 border-[#fb978b] bg-[color-mix(in_srgb,#fb978b_5%,transparent)] px-5 py-[18px] max-[700px]:p-3">
          <strong className="font-mono text-sm leading-[1.6] text-[#fb978b] [overflow-wrap:anywhere]">
            PaymentProviderError: upstream returned 503
          </strong>
          <pre className="mt-2.5 whitespace-pre-wrap font-mono text-[0.8125rem] leading-[1.8] [overflow-wrap:anywhere]">
            <code>
              {
                "at chargeCustomer (payments.ts:84)\nat checkout       (checkout.ts:37)"
              }
            </code>
          </pre>
        </div>
        <div className="mt-5 mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>Related logs</span>
          <code>req_demo_42</code>
        </div>
        <div className="flex gap-6 border-t border-[var(--color-fd-border)] py-2 font-mono text-[0.8125rem] leading-[1.6] max-[700px]:gap-3">
          <time className="text-muted-foreground">10:12:07</time>
          <span>Payment request started</span>
        </div>
        <div className="flex gap-6 border-t border-[var(--color-fd-border)] py-2 font-mono text-[0.8125rem] leading-[1.6] max-[700px]:gap-3">
          <time className="text-muted-foreground">10:12:08</time>
          <span>Payment provider returned 503</span>
        </div>
      </div>
    </div>
  );
}

function ConnectedMonitoringExamples() {
  const [selection, setSelection] = useState("performance");
  const selected =
    examples.find((example) => example.id === selection) ?? examples[0];

  return (
    <div className="grid overflow-hidden rounded-xl border border-border bg-card min-[900px]:grid-cols-[minmax(0,32%)_minmax(0,1fr)]">
      <section
        className="flex h-full min-h-0 min-w-0 flex-col max-[899px]:h-auto min-[900px]:border-r min-[900px]:border-border"
        aria-label="Explore monitoring examples"
      >
        {examples.map(({ id, label, description, icon: Icon }) => (
          <Collapsible
            key={id}
            className={cn(
              "flex min-h-0 flex-col border-b border-border last:border-b-0 transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none",
              selection === id && "grow",
            )}
            open={selection === id}
            onOpenChange={(expanded) => {
              if (expanded) setSelection(id);
            }}
          >
            <h3 className="shrink-0">
              <CollapsibleTrigger
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-6 py-5 text-left text-[15px] font-medium leading-[1.45] text-muted-foreground hover:text-foreground aria-expanded:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary max-sm:p-[18px] [&>svg]:size-[18px] [&>svg]:shrink-0"
                aria-disabled={selection === id}
              >
                <Icon
                  className={selection === id ? "text-primary" : undefined}
                  aria-hidden="true"
                />
                <span>{label}</span>
                <ChevronDown
                  className={cn(
                    "ml-auto transition-transform duration-200 ease-out motion-reduce:transition-none",
                    selection === id && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </CollapsibleTrigger>
            </h3>
            {/* A pixel flex basis keeps intrinsic content height out of the row animation. */}
            <CollapsibleContent
              className="flex h-0 min-h-0 flex-[1_1_0px] flex-col overflow-hidden transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 max-[899px]:h-[var(--collapsible-panel-height)] max-[899px]:flex-none max-[899px]:transition-[height,opacity] max-[899px]:data-[starting-style]:h-0 max-[899px]:data-[ending-style]:h-0 motion-reduce:transition-none"
              keepMounted
            >
              <p className="px-6 pt-0.5 pb-6 pl-[52px] text-sm leading-[1.65] text-muted-foreground max-sm:pt-0 max-sm:pr-[18px] max-sm:pb-5 max-sm:pl-[46px]">
                {description}
              </p>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </section>
      <figure
        className="grid min-w-0 overflow-hidden max-[899px]:border-t max-[899px]:border-border"
        aria-label={selected.label}
      >
        {examples.map(({ id, view: View }) => (
          <div
            className="pointer-events-none invisible min-w-0 opacity-0 transition-opacity duration-150 [grid-area:1/1] data-[active]:pointer-events-auto data-[active]:visible data-[active]:opacity-100 [&>div]:min-h-full motion-reduce:transition-none"
            key={id}
            data-active={selection === id ? "" : undefined}
            aria-hidden={selection !== id}
            inert={selection !== id}
          >
            <View />
          </div>
        ))}
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
            Monitoring goes beyond error reporting. See where your app slows
            down, how it responds to demand, and what led to a failure.
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <ConnectedMonitoringExamples />
        </motion.div>
      </div>
    </section>
  );
}
