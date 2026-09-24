import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import {
  Activity,
  ArrowRight,
  ChartNoAxesCombined,
  Fingerprint,
  Workflow,
} from "lucide-react";
import { useId } from "react";

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

const demoBarClassName =
  "flex flex-wrap justify-between gap-2 border-b border-border px-7 py-4 text-xs text-muted-foreground max-[700px]:px-4";
const demoBodyClassName = "px-7 py-6 max-[700px]:p-4";
const requestClassName =
  "flex flex-wrap items-center justify-between gap-3 text-sm";
const traceRowClassName =
  "grid grid-cols-[130px_minmax(0,1fr)_82px] items-center gap-5 p-3 font-mono text-[0.8125rem] max-[700px]:grid-cols-[88px_minmax(0,1fr)_52px] max-[700px]:gap-2 max-[700px]:px-0 max-[700px]:text-xs";

function TraceExample() {
  return (
    <div className="min-h-[388px] bg-card">
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
        <div className="my-7">
          <div className={`${traceRowClassName} pt-0 text-muted-foreground`}>
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
              className={`${traceRowClassName} ${row.label === "Database" ? "rounded-md bg-[#32c8cc]/10" : ""}`}
              key={row.label}
            >
              <span>{row.label}</span>
              <div className="h-2.5 bg-border">
                <span
                  className="block h-full rounded-[2px] bg-[#32c8cc]"
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
        <p className="flex items-center gap-2 text-sm text-[#32c8cc]">
          <Activity size={16} aria-hidden="true" /> The database accounts for
          97% of request time.
        </p>
      </div>
    </div>
  );
}

function TrafficExample() {
  const chartTitle = useId();
  return (
    <div className="min-h-[388px] bg-card">
      <div className={demoBarClassName}>
        <span className="text-foreground">Traffic overview</span>
        <span>Illustrative example</span>
      </div>
      <div className={demoBodyClassName}>
        <div className={requestClassName}>
          <strong>
            Request rate{" "}
            <small className="font-normal text-muted-foreground">req/s</small>
          </strong>
          <span className="text-muted-foreground">10:00 - 10:15</span>
        </div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_160px] items-center gap-6 max-[700px]:grid-cols-1">
          <svg
            className="h-auto w-full overflow-visible text-muted-foreground"
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
                stroke="currentColor"
                strokeOpacity="0.25"
              />
            ))}
            <g fill="currentColor" fontSize="12">
              <text x="0" y="35">
                800
              </text>
              <text x="0" y="115">
                400
              </text>
              <text x="20" y="195">
                0
              </text>
              <text x="45" y="220">
                10:00
              </text>
              <text x="310" y="220" textAnchor="middle">
                10:07
              </text>
              <text x="580" y="220" textAnchor="end">
                10:15
              </text>
            </g>
            <path
              d="M45 187 L80 185 L110 184 L145 185 L175 180 L195 112 L215 172 L240 182 L275 174 L300 30 L325 86 L345 178 L380 183 L415 179 L450 184 L490 181 L535 185 L580 182 L580 190 L45 190 Z"
              fill="#32c8cc"
              fillOpacity="0.12"
            />
            <path
              d="M45 187 L80 185 L110 184 L145 185 L175 180 L195 112 L215 172 L240 182 L275 174 L300 30 L325 86 L345 178 L380 183 L415 179 L450 184 L490 181 L535 185 L580 182"
              fill="none"
              stroke="#32c8cc"
              strokeWidth="3"
            />
          </svg>
          <div className="grid gap-8 max-[700px]:grid-cols-2 max-[700px]:gap-4">
            <div>
              <p className="text-xs text-muted-foreground">P95 response time</p>
              <strong className="mt-2 block text-2xl font-normal">
                420 <span className="text-sm text-muted-foreground">ms</span>
              </strong>
              <meter
                className="mt-3 w-full accent-primary"
                min={0}
                max={1000}
                value={420}
                aria-label="P95 response time: 420 milliseconds on a 0 to 1000 millisecond scale"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0 ms</span>
                <span>1,000 ms</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Error rate</p>
              <strong className="mt-2 block text-2xl font-normal">
                0.7<span className="text-sm text-muted-foreground">%</span>
              </strong>
              <meter
                className="mt-3 w-full accent-primary"
                min={0}
                max={10}
                value={0.7}
                aria-label="Error rate: 0.7 percent on a 0 to 10 percent scale"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
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
    <div className="min-h-[388px] bg-card">
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
        <div className="mt-7 rounded-md border border-border bg-background p-5 max-[700px]:p-3">
          <strong className="block text-sm font-medium text-[#fb978b]">
            PaymentProviderError: upstream returned 503
          </strong>
          <pre className="mt-4 overflow-x-auto text-xs leading-6 text-muted-foreground">
            <code>
              {
                "at chargeCustomer (payments.ts:84)\nat checkout       (checkout.ts:37)"
              }
            </code>
          </pre>
        </div>
        <div className="mt-7 flex justify-between border-b border-border pb-3 text-xs text-muted-foreground">
          <span>Related logs</span>
          <code>req_demo_42</code>
        </div>
        <div className="flex gap-5 border-b border-border py-3 text-sm max-[700px]:gap-3">
          <time className="font-mono text-xs text-muted-foreground">
            10:12:07
          </time>
          <span>Payment request started</span>
        </div>
        <div className="flex gap-5 py-3 text-sm max-[700px]:gap-3">
          <time className="font-mono text-xs text-muted-foreground">
            10:12:08
          </time>
          <span>Payment provider returned 503</span>
        </div>
      </div>
    </div>
  );
}

export function ObservabilityExamples() {
  return (
    <section
      className="border-t border-border"
      aria-labelledby="monitor-examples-title"
    >
      <div className="mx-auto max-w-[1280px] px-6 py-20 max-[700px]:py-14">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-primary">
          01 / What monitoring reveals
        </p>
        <h2
          id="monitor-examples-title"
          className="mt-8 max-w-[790px] text-balance text-[clamp(2rem,3.7vw,3rem)] font-normal leading-[1.12] tracking-[-0.025em]"
        >
          An app can be up and still let users down.
        </h2>
        <p className="mt-6 max-w-[720px] text-[1.0625rem] leading-[1.65] text-muted-foreground">
          Monitoring goes beyond error reporting. See where your app slows down,
          how it responds to demand, and what led to a failure.
        </p>
        <Tabs
          defaultValue="performance"
          orientation="vertical"
          className="mt-12 grid grid-cols-[280px_minmax(0,1fr)] items-start gap-8 max-[900px]:grid-cols-1"
        >
          <TabsList
            className="!grid !h-auto w-full !gap-0 rounded-none border-t border-border bg-transparent p-0"
            aria-label="Explore production monitoring"
          >
            {examples.map(({ id, label, icon: Icon }, index) => (
              <TabsTrigger
                className="!flex min-h-24 !w-full !flex-none !justify-start gap-4 !rounded-none !border-0 border-b! border-border! bg-transparent! px-0! py-5! text-left! text-base! font-normal! whitespace-normal! text-foreground! data-active:text-primary! [&:after]:hidden"
                key={id}
                value={id}
              >
                <Icon
                  size={21}
                  strokeWidth={1.5}
                  className="text-primary"
                  aria-hidden="true"
                />
                <span className="flex-1">
                  <span className="mb-1 block font-mono text-xs text-muted-foreground">
                    0{index + 1}
                  </span>
                  {label}
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </TabsTrigger>
            ))}
          </TabsList>
          {examples.map(({ id, description, view: View }) => (
            <TabsContent className="min-w-0" key={id} value={id}>
              <figure className="m-0 overflow-hidden rounded-md border border-border bg-card">
                <View />
                <figcaption className="border-t border-border px-7 py-5 text-sm leading-[1.6] text-muted-foreground max-[700px]:px-4">
                  {description}
                </figcaption>
              </figure>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
