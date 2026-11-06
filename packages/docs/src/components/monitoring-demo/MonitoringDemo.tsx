import { EverrLogoMark } from "@everr/ui/components/everr-logo";
import {
  Bug,
  ChartLine,
  Clock,
  Flame,
  Hash,
  House,
  LayoutDashboard,
  NotebookText,
  PanelLeft,
  Route,
  ScrollText,
  Search,
  BellOff,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useRef } from "react";
import { Chart, Roll, Stage, Window, type Act, type Playhead } from "./kit";
import { AlertsView, type AlertState } from "../alerts-demo/AlertsView";
import { RunbookView, type RunbookStep } from "../alerts-demo/RunbookView";
import "./monitoring-demo.css";

// The real Everr app, in three screens: a slow trace, a dashboard under load,
// an error with its stack trace.

type S = {
  nav: 0 | 1 | 2 | 3 | 4;
  detail: boolean;
  rows: number;
  mark: boolean;
  spike: boolean;
  dialog: boolean;
  alert: AlertState;
  runbook: RunbookStep;
};

const ALERT_OK: AlertState = { phase: "ok", sent: false, panel: false };
const initial: S = {
  nav: 0,
  detail: false,
  rows: 0,
  mark: false,
  spike: false,
  dialog: false,
  alert: ALERT_OK,
  runbook: 0,
};
const POSTER: S = { ...initial, detail: true, rows: 4, mark: true };

const PATHS = [
  "traces",
  "dashboards/http-endpoints",
  "errors",
  "alerts",
  "runbooks/api/checkout-latency",
] as const;

const NAV: { label: string; items: { name: string; icon: LucideIcon; at?: number }[] }[] = [
  { label: "", items: [{ name: "Home", icon: House }] },
  {
    label: "Monitor",
    items: [
      { name: "Dashboards", icon: LayoutDashboard, at: 1 },
      { name: "Runbooks", icon: NotebookText, at: 4 },
    ],
  },
  {
    label: "Alerts",
    items: [
      { name: "Triage", icon: Flame, at: 3 },
      { name: "Silences", icon: BellOff },
      { name: "Notifications", icon: Hash },
    ],
  },
  {
    label: "Explore",
    items: [
      { name: "Logs", icon: ScrollText },
      { name: "Errors", icon: Bug, at: 2 },
      { name: "Traces", icon: Route, at: 0 },
    ],
  },
  {
    label: "CI/CD",
    items: [
      { name: "Runs", icon: Activity },
      { name: "Cost Analysis", icon: ChartLine },
    ],
  },
];

const TRACES = [
  {
    verb: "POST",
    route: "/checkout",
    id: "4d3be684",
    ms: "900ms",
    w: 43,
    status: "500",
    at: "10:46:53 AM",
  },
  {
    verb: "GET",
    route: "/projects",
    id: "b7be600a",
    ms: "2.1s",
    w: 100,
    status: "200",
    at: "10:46:23 AM",
    target: "row-slow",
  },
  {
    verb: "GET",
    route: "/projects",
    id: "acab7f26",
    ms: "234ms",
    w: 11,
    status: "200",
    at: "10:42:23 AM",
  },
  {
    verb: "GET",
    route: "/projects",
    id: "3ab9a852",
    ms: "230ms",
    w: 11,
    status: "200",
    at: "10:38:23 AM",
  },
  {
    verb: "GET",
    route: "/projects",
    id: "f0a618ac",
    ms: "1.9s",
    w: 90,
    status: "200",
    at: "10:34:23 AM",
  },
  {
    verb: "GET",
    route: "/projects",
    id: "dd140ab6",
    ms: "156ms",
    w: 7,
    status: "200",
    at: "10:30:23 AM",
  },
  {
    verb: "GET",
    route: "/projects",
    id: "65ae6452",
    ms: "194ms",
    w: 9,
    status: "200",
    at: "10:26:23 AM",
  },
];

const SPANS = [
  { name: "GET /projects", ms: "2.1s", start: 0, width: 100, tag: "200", depth: 0 },
  { name: "authenticate", ms: "20ms", start: 0, width: 1.5, depth: 1 },
  { name: "SELECT projects", ms: "2.0s", start: 1, width: 97, depth: 1 },
  { name: "serialize response", ms: "40ms", start: 98, width: 2, depth: 1 },
];

const OK = [3, 2, 3, 4, 3, 3, 4, 3, 2, 3, 4, 3, 3, 4, 3, 3];
const OK_SPIKE = [3, 2, 3, 4, 3, 3, 4, 3, 2, 3, 4, 3, 3, 6, 16, 22];
const ERR = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4, 5];

const CHART = { wide: { w: 270, h: 200 }, compact: { w: 272, h: 150 } };
const RUNBOOK_CHART = { wide: { w: 440, h: 110 }, compact: { w: 310, h: 100 } };

export type Chapter = 0 | 1 | 2 | 3 | 4;

/** How long each chapter plays, in ms. A chapter that finishes early holds its last frame. */
export const CHAPTER_MS = [7400, 5600, 6600, 11200, 7600] as const;

const STARTS: readonly S[] = [
  initial,
  { ...initial, nav: 1 },
  { ...initial, nav: 2 },
  { ...initial, nav: 3 },
  { ...initial, nav: 4 },
];
const POSTERS: readonly S[] = [
  POSTER,
  { ...initial, nav: 1, spike: true },
  { ...initial, nav: 2, dialog: true },
  { ...initial, nav: 3, alert: { phase: "firing", sent: true, panel: true } },
  { ...initial, nav: 4, runbook: 2 },
];

// Each chapter runs from its STARTS state, or, when `flowing`, straight on
// from the end of the one before it.
const CHAPTERS: ((a: Act<S>, flowing: boolean) => Promise<void>)[] = [
  // 1. A request that returned 200 and took 2.1 s: open its trace
  async (a, flowing) => {
    if (flowing) {
      await a.snap({ detail: false, rows: 0, mark: false, spike: false });
      await a.move("nav-0");
      await a.click();
      await a.set({ nav: 0 });
      await a.wait(500);
      // The other views have faded out by now: close the error detail and put
      // the alert and runbook back to their start, unseen
      await a.snap({ dialog: false, alert: ALERT_OK, runbook: 0 });
    } else await a.wait(800);
    await a.move("row-slow");
    await a.wait(250);
    await a.click();
    await a.set({ detail: true });
    await a.wait(600);
    await a.stagger([1, 2, 3, 4], (rows) => a.set({ rows }), 340);
    await a.wait(400);
    await a.set({ mark: true });
    await a.wait(2600);
  },
  // 2. The dashboard under a traffic spike
  async (a, flowing) => {
    if (flowing) {
      await a.move("nav-1");
      await a.click();
      await a.set({ nav: 1 });
    }
    await a.wait(1700);
    await a.set({ spike: true });
    await a.wait(2800);
  },
  // 3. The failure: its stack trace and occurrences
  async (a, flowing) => {
    if (flowing) {
      await a.move("nav-2");
      await a.click();
      await a.set({ nav: 2 });
    }
    await a.wait(800);
    await a.move("err-card");
    await a.wait(250);
    await a.click();
    await a.set({ dialog: true });
    await a.wait(3200);
  },
  // 4. An alert fires: pending, firing, the on-call channel told, then opened
  async (a, flowing) => {
    if (flowing) {
      await a.move("nav-3");
      await a.click();
      await a.set({ nav: 3 });
    }
    await a.wait(1000);
    await a.set((s) => ({ alert: { ...s.alert, phase: "pending" } }));
    await a.wait(1700);
    await a.set((s) => ({ alert: { ...s.alert, phase: "firing" } }));
    await a.wait(1000);
    await a.set((s) => ({ alert: { ...s.alert, sent: true } }));
    await a.wait(1100);
    await a.move("alert-card");
    await a.wait(200);
    await a.click();
    await a.set((s) => ({ alert: { ...s.alert, panel: true } }));
    await a.wait(1300);
    await a.move("runbook");
    await a.wait(2000);
  },
  // 5. The runbook it links to: find the breaching service, then its slow query
  async (a, flowing) => {
    if (flowing) {
      // The cursor rests on the alert's Runbook button
      await a.click();
      await a.set({ nav: 4 });
    }
    await a.wait(900);
    await a.set({ runbook: 1 });
    await a.wait(1900);
    await a.set({ runbook: 2 });
    await a.wait(1000);
    await a.move("rb-row");
    await a.wait(2400);
  },
];

const NEXT = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 0 } as const satisfies Record<Chapter, Chapter>;

function makeScript(
  from: { current: Chapter },
  playhead: Playhead,
  onChapter: (chapter: Chapter, startedAt: number) => void,
) {
  return async function script(a: Act<S>) {
    // A restart (the stage left the screen and came back) resumes the chapter on show
    let chapter = from.current;
    await a.snap(STARTS[chapter]);
    for (let flowing = false; ; flowing = true) {
      const t0 = playhead.now();
      from.current = chapter;
      onChapter(chapter, t0);
      await CHAPTERS[chapter](a, flowing);
      await a.wait(Math.max(0, CHAPTER_MS[chapter] - (playhead.now() - t0)));
      chapter = NEXT[chapter];
    }
  };
}

const TITLES = ["Traces", "Dashboards", "Errors", "Triage", "Runbooks"] as const;

export function MonitoringDemo({
  jump,
  playhead,
  onChapter,
}: {
  /** The chapter to play from. A new object restarts the demo there. */
  jump: { chapter: Chapter };
  playhead: Playhead;
  onChapter?: (chapter: Chapter, startedAt: number) => void;
}) {
  const report = useRef(onChapter);
  report.current = onChapter;
  const from = useRef<Chapter>(jump.chapter);
  const script = useMemo(() => {
    from.current = jump.chapter;
    return makeScript(from, playhead, (chapter, at) => report.current?.(chapter, at));
  }, [jump, playhead]);
  return (
    <Stage<S>
      width={880}
      height={560}
      compact={{ below: 640, width: 358, height: 560 }}
      theme="dark"
      initial={STARTS[jump.chapter]}
      poster={POSTERS[jump.chapter]}
      script={script}
      playhead={playhead}
      play="once"
      fill
      cursor={{
        at: { wide: { x: 820, y: 420 }, compact: { x: 250, y: 420 } },
        style: "arrow",
        ripple: true,
      }}
      className="mo al"
    >
      {(s, _rect, layout) => {
        const chart = CHART[layout === "compact" ? "compact" : "wide"];
        return (
          <Window
            url={
              <>
                app.everr.dev/<Roll variant="fade">{PATHS[s.nav]}</Roll>
              </>
            }
            className="mo-win"
          >
            <div className="mo-app">
              <aside className="mo-side">
                <div className="mo-logo">
                  <EverrLogoMark aria-hidden="true" />
                  <span>
                    <b>everr</b>
                    <small>Observability made simple</small>
                  </span>
                </div>
                {NAV.map((g) => (
                  <div key={g.label || "home"} className="mo-group">
                    {g.label && <span className="mo-glabel">{g.label}</span>}
                    {g.items.map(({ name, icon: Icon, at }) => (
                      <span
                        key={name}
                        className="mo-item"
                        data-on={at === s.nav || undefined}
                        data-target={at === undefined ? undefined : `nav-${at}`}
                      >
                        <Icon size={15} aria-hidden="true" />
                        {name}
                      </span>
                    ))}
                  </div>
                ))}
              </aside>

              <div className="mo-main">
                <header className="mo-head">
                  <PanelLeft size={15} aria-hidden="true" />
                  <span className="mo-crumb">
                    {s.nav === 1 ? (
                      <>
                        <span className="mo-dim">Dashboards</span>{" "}
                        <span className="mo-dim">&gt;</span> HTTP Endpoints
                      </>
                    ) : s.nav === 4 ? (
                      <>
                        <span className="mo-dim">Runbooks</span>{" "}
                        <span className="mo-dim">&gt;</span> Checkout latency
                      </>
                    ) : s.nav === 0 && s.detail ? (
                      "Trace"
                    ) : (
                      TITLES[s.nav]
                    )}
                  </span>
                  <span className="mo-spacer" />
                  <span className="mo-pill mo-pill--search">
                    <Search size={13} aria-hidden="true" /> Search...
                  </span>
                  <span className="mo-pill">
                    <Clock size={13} aria-hidden="true" />{" "}
                    {s.nav === 1 ? "Last 6 hours" : s.nav >= 3 ? "Last 1 hour" : "Last 7 days"}
                  </span>
                </header>

                <div className="mo-views">
                  {/* Traces: list, then one trace */}
                  <section className="mo-view" data-on={s.nav === 0 || undefined}>
                    <div className="mo-list" data-off={s.detail || undefined}>
                      <div className="mo-trow mo-trow--head">
                        <span>Trace</span>
                        <span className="mo-hide-c">Service</span>
                        <span className="mo-right">Duration</span>
                        <span className="mo-center">Status</span>
                        <span className="mo-right mo-hide-c">Started</span>
                      </div>
                      {TRACES.map((t) => (
                        <div key={t.id} className="mo-trow" data-target={t.target}>
                          <span className="mo-tname">
                            <b className="mo-verb" data-verb={t.verb}>
                              {t.verb}
                            </b>
                            <strong>{t.route}</strong>
                            <code className="mo-id">{t.id}</code>
                          </span>
                          <span className="mo-svc mo-hide-c">
                            <i /> api
                          </span>
                          <span className="mo-dur">
                            <em>{t.ms}</em>
                            <span className="mo-bar">
                              <span style={{ width: `${t.w}%` }} />
                            </span>
                          </span>
                          <span className="mo-center">
                            <b className="mo-code" data-bad={t.status === "500" || undefined}>
                              {t.status}
                            </b>
                          </span>
                          <span className="mo-right mo-dim mo-hide-c">{t.at}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mo-detail" data-on={s.detail || undefined}>
                      <div className="mo-dtitle">
                        <strong>GET /projects</strong>
                        <span>
                          api &nbsp; 2.1s &nbsp; 4 spans &nbsp; 1 services &nbsp;{" "}
                          <code>b7be600aefb38ec95de9b041bb4b114a</code>
                        </span>
                      </div>
                      <div className="mo-wf-head">
                        <span>Waterfall</span>
                      </div>
                      <div className="mo-wf-axis">
                        <span>Service / operation</span>
                        <div>
                          <span>0ms</span>
                          <span>525ms</span>
                          <span className="mo-hide-c">1.1s</span>
                          <span className="mo-hide-c">1.6s</span>
                          <span>2.1s</span>
                        </div>
                      </div>
                      {SPANS.map((sp, i) => (
                        <div
                          key={sp.name}
                          className="mo-wf"
                          data-in={s.rows > i || undefined}
                          data-hot={(s.mark && i === 2) || undefined}
                        >
                          <span className="mo-wf-name" style={{ paddingLeft: sp.depth * 12 }}>
                            <i /> <small>api</small> <span>{sp.name}</span>
                            {sp.tag && <code>{sp.tag}</code>}
                          </span>
                          <div className="mo-wf-track">
                            <span
                              className="mo-wf-bar"
                              style={{ marginLeft: `${sp.start}%`, width: `${sp.width}%` }}
                            >
                              {sp.width > 20 && sp.ms}
                            </span>
                            {i === 2 && (
                              <span className="mo-chip" data-show={s.mark || undefined}>
                                97% of the request
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Dashboard */}
                  <section className="mo-view" data-on={s.nav === 1 || undefined}>
                    <div className="mo-stats">
                      <div className="mo-card">
                        <b>Requests</b>
                        <strong>
                          <Roll stagger={25}>{s.spike ? "1,840" : "412"}</Roll>
                        </strong>
                      </div>
                      <div className="mo-card">
                        <b>5xx rate</b>
                        <strong className="mo-red">
                          <Roll stagger={25}>{s.spike ? "7.69%" : "0.40%"}</Roll>
                        </strong>
                      </div>
                      <div className="mo-card mo-hide-c">
                        <b>4xx rate</b>
                        <strong className="mo-green">0.00%</strong>
                      </div>
                      <div className="mo-card">
                        <b>P95 latency</b>
                        <strong>
                          <Roll stagger={25}>{s.spike ? "1,980 ms" : "420 ms"}</Roll>
                        </strong>
                      </div>
                    </div>
                    <div className="mo-charts">
                      <div className="mo-card mo-chartcard">
                        <b>Requests by status class</b>
                        <div className="mo-chart" style={{ width: chart.w, height: chart.h }}>
                          <Chart
                            data={s.spike ? OK_SPIKE : OK}
                            width={chart.w}
                            height={chart.h}
                            max={24}
                            dot={false}
                            show={s.nav === 1}
                            className="mo-c-purple"
                          />
                          <Chart
                            data={s.spike ? ERR : ERR.map(() => 0)}
                            width={chart.w}
                            height={chart.h}
                            max={24}
                            dot={false}
                            area={false}
                            show={s.nav === 1}
                            className="mo-c-yellow"
                          />
                        </div>
                        <div className="mo-legend">
                          <span>
                            <i className="mo-purple" /> 2xx
                          </span>
                          <span>
                            <i className="mo-yellow" /> 5xx
                          </span>
                        </div>
                      </div>
                      <div className="mo-card mo-chartcard mo-hide-c">
                        <b>P95 latency by route</b>
                        <div className="mo-chart" style={{ width: chart.w, height: chart.h }}>
                          <Chart
                            data={
                              s.spike
                                ? [20, 22, 21, 24, 22, 23, 21, 22, 24, 23, 22, 21, 24, 70, 100, 98]
                                : [20, 22, 21, 24, 22, 23, 21, 22, 24, 23, 22, 21, 24, 23, 22, 21]
                            }
                            width={chart.w}
                            height={chart.h}
                            max={110}
                            dot={false}
                            show={s.nav === 1}
                            className="mo-c-purple"
                          />
                        </div>
                        <div className="mo-legend">
                          <span>
                            <i className="mo-purple" /> /projects
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Errors */}
                  <section className="mo-view" data-on={s.nav === 2 || undefined}>
                    <div className="mo-ecard" data-target="err-card">
                      <strong>PaymentProviderError</strong>
                      <span className="mo-dim">upstream returned 503</span>
                      <div className="mo-tags">
                        <span className="mo-tag">
                          <i /> api
                        </span>
                        <span className="mo-tag">9 occurrences</span>
                        <span className="mo-dim">Last seen 1m ago</span>
                      </div>
                    </div>

                    {[
                      [
                        "TimeoutError",
                        "request to inventory exceeded 5000ms",
                        "4 occurrences",
                        "12m ago",
                      ],
                      ["ValidationError", "email is required", "2 occurrences", "41m ago"],
                    ].map(([name, msg, count, seen]) => (
                      <div key={name} className="mo-ecard mo-ecard--row">
                        <strong>{name}</strong>
                        <span className="mo-dim">{msg}</span>
                        <div className="mo-tags">
                          <span className="mo-tag">
                            <i /> api
                          </span>
                          <span className="mo-tag">{count}</span>
                          <span className="mo-dim">Last seen {seen}</span>
                        </div>
                      </div>
                    ))}

                    <div className="mo-dialog" data-on={s.dialog || undefined}>
                      <div className="mo-dhead">
                        <strong>PaymentProviderError</strong>
                        <span className="mo-dim">upstream returned 503</span>
                        <div className="mo-tags">
                          <span className="mo-tag">
                            <i /> api
                          </span>
                          <span className="mo-tag">9 occurrences</span>
                        </div>
                      </div>
                      <div className="mo-dbody">
                        <div className="mo-dcol">
                          <div className="mo-panel">
                            <b>Stacktrace</b>
                            <pre>
                              {
                                "PaymentProviderError: upstream returned 503\n    at chargeCustomer (payments.ts:84)\n    at checkout (checkout.ts:37)"
                              }
                            </pre>
                          </div>
                          <div className="mo-panel mo-hide-c">
                            <b>Details</b>
                            <div className="mo-kv">
                              <span>Type</span>
                              <code>PaymentProviderError</code>
                              <span>Message</span>
                              <code>upstream returned 503</code>
                              <span>service.name</span>
                              <code>api</code>
                            </div>
                          </div>
                        </div>
                        <div className="mo-panel mo-occ mo-hide-c">
                          <b>Occurrences</b>
                          {["1m ago", "7m ago", "13m ago"].map((t, i) => (
                            <div key={t} className="mo-occ-row">
                              <span>
                                PaymentProviderError
                                <small>upstream returned 503</small>
                              </span>
                              <span className="mo-btn">{i === 0 ? "Selected" : "View"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Alerts: Triage as a rule fires */}
                  <section className="mo-view al-view" data-on={s.nav === 3 || undefined}>
                    <AlertsView s={s.alert} />
                  </section>

                  {/* Runbooks: the one the alert links to */}
                  <section className="mo-view rb-view" data-on={s.nav === 4 || undefined}>
                    <RunbookView
                      step={s.runbook}
                      show={s.nav === 4}
                      chart={RUNBOOK_CHART[layout === "compact" ? "compact" : "wide"]}
                    />
                  </section>
                </div>
              </div>
            </div>
          </Window>
        );
      }}
    </Stage>
  );
}
