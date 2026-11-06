import { NotebookText, Search } from "lucide-react";
import { Chart } from "../monitoring-demo/kit";
import "./alerts-demo.css";

// Everr's runbook page, as in packages/app's runbooks route: the list of
// runbooks beside a Markdown article with live query panels in it. Opened
// from the firing alert's Runbook button, it walks to the query to fix.

/** 0: opened, 1: its latency panel drawn, 2: scrolled to the slow queries. */
export type RunbookStep = 0 | 1 | 2;

const RUNBOOKS = ["Checkout latency", "Payment errors", "Queue depth"];

// p95 latency of payments over the last hour, crossing the 500ms budget
const LATENCY = [310, 330, 320, 340, 330, 350, 360, 340, 380, 420, 520, 760, 980, 1120, 1090, 1118];
const FLAT = LATENCY.map(() => 0);
const MAX = 1300;
const BUDGET = 500;

const QUERIES = [
  { sql: "SELECT projects", ms: "2.0s" },
  { sql: "UPDATE invoices", ms: "640ms" },
  { sql: "SELECT customers", ms: "210ms" },
];

export function RunbookView({
  step,
  show,
  chart,
}: {
  step: RunbookStep;
  show: boolean;
  chart: { w: number; h: number };
}) {
  return (
    <div className="rb">
      <aside className="rb-list mo-hide-c">
        <span className="rb-search">
          <Search size={12} aria-hidden="true" /> Search runbooks...
        </span>
        {RUNBOOKS.map((name, i) => (
          <span key={name} className="rb-item" data-on={i === 0 || undefined}>
            <NotebookText size={13} aria-hidden="true" />
            {name}
          </span>
        ))}
      </aside>
      <article className="rb-doc">
        <div className="rb-scroll" data-step={step}>
          <h3>Checkout latency</h3>
          <p>
            Fires when checkout p95 stays over 500ms for two minutes. Start with the service that
            breaches most.
          </p>
          <h4>1. Find the breaching service</h4>
          <div className="rb-panel">
            <b>p95 latency · payments</b>
            <div className="mo-chart rb-chart" style={{ width: chart.w, height: chart.h }}>
              <Chart
                data={step >= 1 ? LATENCY : FLAT}
                width={chart.w}
                height={chart.h}
                max={MAX}
                dot={false}
                show={show}
                className="rb-c-red"
              />
              <i className="rb-budget" style={{ top: `${(1 - BUDGET / MAX) * 100}%` }}>
                <span>500ms</span>
              </i>
            </div>
          </div>
          <h4>2. Check its slowest queries</h4>
          <div className="rb-panel">
            <b>Slowest queries · payments</b>
            {QUERIES.map((q, i) => (
              <div
                key={q.sql}
                className="rb-row"
                data-hot={(step === 2 && i === 0) || undefined}
                data-target={i === 0 ? "rb-row" : undefined}
              >
                <code>{q.sql}</code>
                <code>{q.ms}</code>
              </div>
            ))}
          </div>
          <h4>3. Roll back or scale out</h4>
          <span className="rb-filler" />
          <span className="rb-filler rb-filler--short" />
        </div>
      </article>
    </div>
  );
}
