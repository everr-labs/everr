import { ArrowUp, FolderClosed, Settings, SquarePen } from "lucide-react";
import { useMemo, useRef } from "react";
import {
  type Act,
  Chart,
  Collapse,
  type Playhead,
  Stage,
  Stream,
  Window,
} from "../monitoring-demo/kit";
import "../monitoring-demo/monitoring-demo.css";
import "./agent-demo.css";

// A coding agent's desktop app: threads down the side, the open thread in the
// middle, a composer at its foot. Each chapter is a new thread running one of
// Everr's skills the way its SKILL.md tells the agent to: plan, instrument and
// verify locally; discover the data before writing a dashboard and stage it
// in a preview; read the alert's history, then narrow down through traces.

type Block =
  | { kind: "user"; text: string }
  | {
      kind: "tool";
      verb: string;
      text: string;
      out?: string;
      /** The link a command prints, which the demo then clicks */
      link?: string;
      add?: number;
      del?: number;
    }
  | { kind: "plan"; text: string; items: [string, string][] }
  | { kind: "say"; text: string };

type Thread = {
  title: string;
  skill: string;
  prompt: string;
  /** What the thread shows in the list once it is not the open one */
  meta: string;
  /** The thread ends by opening its link in the app */
  opens?: boolean;
  blocks: Block[];
};

const PREVIEW_URL = "app.everr.dev/dashboards/robots-ecommerce?preview=checkout-dashboard";

const THREADS: Thread[] = [
  {
    title: "Instrument the checkout",
    skill: "everr-setup-telemetry",
    prompt: "Instrument the checkout, cover the whole stack",
    meta: "+86 -3",
    blocks: [
      { kind: "tool", verb: "Explored", text: "apps/web, apps/api, 9 files" },
      { kind: "tool", verb: "Ran", text: "everr local status", out: "running, otlp and ui ready" },
      {
        kind: "plan",
        text: "apps/web calls apps/api, which talks to Postgres and Stripe. The plan, exporting to the local collector:",
        items: [
          ["web", "frontend errors, page loads, web vitals, traces joined to the API"],
          ["api", "/checkout timing, Postgres and Stripe spans, correlated logs"],
        ],
      },
      { kind: "tool", verb: "Edited", text: "4 files", add: 86, del: 3 },
      {
        kind: "tool",
        verb: "Ran",
        text: "everr local query \"SELECT SpanName FROM traces WHERE TraceId = '4bf92f…'\"",
        out: "14 rows",
      },
      { kind: "tool", verb: "Ran", text: "pnpm build", out: "built in 8.2s" },
      {
        kind: "say",
        text: "Checkout is traced end to end, from the Pay click to the Stripe charge. Verified locally: trace 4bf92f has 14 spans across web and api. The README's Telemetry section has the production steps.",
      },
    ],
  },
  {
    title: "Checkout dashboard",
    skill: "everr-setup-resources",
    prompt: "Make a dashboard for the checkout API",
    meta: "+72",
    opens: true,
    blocks: [
      {
        kind: "tool",
        verb: "Ran",
        text: 'everr cloud query "DESCRIBE TABLE traces"',
        out: "34 columns",
      },
      {
        kind: "tool",
        verb: "Ran",
        text: 'everr cloud query "SELECT SpanName, count() FROM traces … LIMIT 20"',
        out: "20 rows",
      },
      { kind: "tool", verb: "Created", text: "everr/robots-ecommerce.dashboard.yaml", add: 72 },
      {
        kind: "tool",
        verb: "Ran",
        text: "everr apply ./everr --preview",
        out: "1 dashboard added",
        link: PREVIEW_URL,
      },
      {
        kind: "say",
        text: "The preview has request rate, errors and p95 latency per route, plus the slowest Postgres queries. Open the link to see it. Watch p95 on POST /checkout and failed Stripe calls first: those two move with revenue.",
      },
    ],
  },
  {
    title: "Checkout latency alert",
    skill: "everr-use-telemetry",
    prompt: "The checkout latency alert fired. What happened?",
    meta: "now",
    blocks: [
      {
        kind: "tool",
        verb: "Ran",
        text: 'everr cloud query "SELECT event_type, event_time FROM alert_events … LIMIT 50"',
        out: "fired 14:04, delivered to #oncall",
      },
      {
        kind: "tool",
        verb: "Ran",
        text: 'everr cloud query "SELECT SpanName, quantile(0.95)(Duration) … LIMIT 20"',
        out: "20 rows",
      },
      {
        kind: "tool",
        verb: "Ran",
        text: "everr cloud query \"SELECT … WHERE TraceId = 'a31c07…'\"",
        out: "31 rows",
      },
      {
        kind: "say",
        text: "It fired at 14:04, two minutes after the v2.14 deploy. POST /checkout p95 went from 310ms to 1.1s, and most of that is one span: SELECT projects, now 2.0s. It stopped using the org_id index, so the v2.14 migration is the place to look.",
      },
    ],
  },
];

export type AgentChapter = 0 | 1 | 2;
// How long each chapter plays, its answer held for reading at the end
export const AGENT_CHAPTER_MS = [20000, 23000, 17500] as const;
const NEXT = { 0: 1, 1: 2, 2: 0 } as const satisfies Record<AgentChapter, AgentChapter>;

type S = {
  /** The thread open, and whether it has been sent (a new thread is blank) */
  open: AgentChapter;
  sent: boolean;
  /** Threads listed in the sidebar */
  listed: number;
  /** What is in the composer */
  typed: string;
  /** Blocks of the open thread on screen */
  shown: number;
  /** The answer streaming in, and how many of its words show */
  streaming: number;
  words: number;
  busy: boolean;
  /** The preview link has been opened: the dashboard is on screen */
  dash: boolean;
};

const blank = (c: AgentChapter): S => ({
  open: c,
  sent: false,
  listed: c,
  typed: "",
  shown: 0,
  streaming: -1,
  words: 0,
  busy: false,
  dash: false,
});
const STARTS: readonly S[] = [blank(0), blank(1), blank(2)];
// Each chapter's poster is its answer
const POSTERS: readonly S[] = STARTS.map((start, i) => ({
  ...start,
  sent: true,
  listed: i + 1,
  shown: THREADS[i].blocks.length + 1,
}));

const wordCount = (text: string) => text.split(" ").length;

async function run(a: Act<S>, c: AgentChapter, flowing: boolean) {
  const thread = THREADS[c];
  if (flowing) {
    // A new session for a new question
    // The last chapter may have left its dashboard open: close it before going on
    await a.set({ dash: false });
    await a.wait(500);
    await a.move("new");
    await a.wait(150);
    await a.click();
    await a.set(blank(c));
  }
  await a.move("composer");
  await a.click();
  await a.type("typed", thread.prompt);
  await a.wait(250);
  await a.move("send");
  await a.click();
  await a.set({ typed: "", sent: true, listed: c + 1, shown: 1, busy: true });
  await a.move("rest");
  await a.wait(600);
  for (const [i, block] of thread.blocks.entries()) {
    const at = i + 2;
    if (block.kind === "say") {
      await a.set({ busy: false, shown: at, streaming: at - 1, words: 0 });
      await a.wait(380);
      for (let n = 1; n <= wordCount(block.text); n++) {
        await a.set({ words: n });
        await a.wait(40);
      }
    } else {
      await a.set({ shown: at });
      await a.wait(block.kind === "plan" ? 2200 : block.kind === "tool" && block.out ? 1000 : 700);
    }
  }
  if (thread.opens) {
    // The preview link opens the dashboard in the app
    await a.wait(900);
    await a.move("link");
    await a.wait(200);
    await a.click();
    await a.set({ dash: true });
  }
}

function makeScript(
  from: { current: AgentChapter },
  playhead: Playhead,
  onChapter: (chapter: AgentChapter, startedAt: number) => void,
) {
  return async function script(a: Act<S>) {
    // A restart (the stage left the screen and came back) resumes the chapter on show
    let chapter = from.current;
    await a.snap(STARTS[chapter]);
    for (let flowing = false; ; flowing = true) {
      const t0 = playhead.now();
      from.current = chapter;
      onChapter(chapter, t0);
      await run(a, chapter, flowing);
      await a.wait(Math.max(0, AGENT_CHAPTER_MS[chapter] - (playhead.now() - t0)));
      chapter = NEXT[chapter];
    }
  };
}

function Line({ block, count }: { block: Block; count: number }) {
  switch (block.kind) {
    case "user":
      return (
        <div className="ag-user">
          <span>{block.text}</span>
        </div>
      );
    case "tool":
      return (
        <div className="ag-tool">
          <div className="ag-tool-head">
            <span className="ag-verb">{block.verb}</span>
            <code className="ag-cut">{block.text}</code>
            {block.add !== undefined && <span className="ag-add">+{block.add}</span>}
            {block.del !== undefined && <span className="ag-del">-{block.del}</span>}
          </div>
          {block.out && <div className="ag-out">{block.out}</div>}
          {block.link && (
            <div className="ag-out">
              Preview:{" "}
              <span className="ag-link" data-target="link">
                {block.link}
              </span>
            </div>
          )}
        </div>
      );
    case "plan":
      return (
        <div className="ag-say">
          <p>{block.text}</p>
          <ul>
            {block.items.map(([name, what]) => (
              <li key={name}>
                <code>{name}</code>
                <span>{what}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "say":
      return (
        <div className="ag-say">
          <Stream text={block.text} count={count} />
        </div>
      );
  }
}

const STATS: [string, string, string][] = [
  ["Requests", "1,284", ""],
  ["5xx rate", "0.4%", "mo-red"],
  ["P95 latency", "310 ms", ""],
  ["Stripe failures", "3", "mo-green"],
];
const REQUESTS = [3, 2, 3, 4, 3, 3, 4, 3, 2, 3, 4, 3, 3, 4, 3, 3];
const LATENCY = [9, 10, 9, 11, 10, 10, 9, 10, 11, 10, 9, 10, 11, 10, 10, 9];
const DASH_CHART = { wide: { w: 400, h: 200 }, compact: { w: 300, h: 150 } };

const REST = { wide: { x: 880, y: 250 }, compact: { x: 330, y: 250 } };

export function AgentDemo({
  jump,
  playhead,
  onChapter,
}: {
  /** The chapter to play from. A new object restarts the demo there. */
  jump: { chapter: AgentChapter };
  playhead: Playhead;
  onChapter?: (chapter: AgentChapter, startedAt: number) => void;
}) {
  const report = useRef(onChapter);
  report.current = onChapter;
  const from = useRef<AgentChapter>(jump.chapter);
  const script = useMemo(() => {
    from.current = jump.chapter;
    return makeScript(from, playhead, (chapter, at) => report.current?.(chapter, at));
  }, [jump, playhead]);
  return (
    <Stage<S>
      width={920}
      height={500}
      compact={{ below: 640, width: 358, height: 540 }}
      theme="dark"
      initial={STARTS[jump.chapter]}
      poster={POSTERS[jump.chapter]}
      script={script}
      playhead={playhead}
      play="once"
      fill
      cursor={{ at: REST, style: "arrow", ripple: true }}
      className="mo ag"
    >
      {(s, _rect, layout) => {
        const thread = THREADS[s.open];
        const compact = layout === "compact";
        const dash = DASH_CHART[compact ? "compact" : "wide"];
        const blocks: Block[] = [{ kind: "user", text: thread.prompt }, ...thread.blocks];
        const listed = THREADS.slice(0, s.listed)
          .map((t, i) => ({ t, i }))
          .reverse();
        return (
          <div className="ag-app">
            <aside className="ag-side">
              <span className="ag-side-row" data-target={compact ? undefined : "new"}>
                <SquarePen size={14} aria-hidden="true" />
                New thread
              </span>
              <span className="ag-side-label">
                <FolderClosed size={13} aria-hidden="true" />
                robots-ecommerce
              </span>
              {listed.map(({ t, i }) => {
                const here = i === s.open && s.sent;
                return (
                  <span key={t.title} className="ag-thread" data-on={here || undefined}>
                    <span className="ag-cut">{t.title}</span>
                    {here && s.busy ? (
                      <span className="ag-spin" />
                    ) : (
                      <span className="ag-meta">{t.meta}</span>
                    )}
                  </span>
                );
              })}
              <span className="ag-side-foot">
                <Settings size={13} aria-hidden="true" />
                Settings
              </span>
            </aside>
            <div className="ag-main">
              <header className="ag-head">
                <span className="ag-cut">{s.sent ? thread.title : "New thread"}</span>
                <span className="ag-skill" data-on={s.sent || undefined}>
                  {thread.skill}
                </span>
                {compact && (
                  <span className="ag-new" data-target="new">
                    <SquarePen size={14} aria-hidden="true" />
                  </span>
                )}
              </header>
              <div className="ag-log">
                <div className="ag-scroll" key={s.open}>
                  {blocks.map((block, i) => (
                    <Collapse
                      key={`${block.kind}-${block.text}`}
                      open={i < s.shown}
                      reveal={block.kind === "say" || block.kind === "plan" ? "drop" : "clip"}
                      from="below"
                    >
                      <Line block={block} count={i === s.streaming ? s.words : 999} />
                    </Collapse>
                  ))}
                  <div className="ag-status" data-on={s.busy || undefined}>
                    Working
                  </div>
                </div>
              </div>
              <div className="ag-composer" data-target="composer">
                <span className="ag-typed" data-empty={!s.typed || undefined}>
                  {s.typed || "Ask for anything"}
                </span>
                <span className="ag-send" data-target="send" data-on={!!s.typed || undefined}>
                  <ArrowUp size={14} aria-hidden="true" />
                </span>
              </div>
            </div>
            <div className="ag-dash" data-on={s.dash || undefined} aria-hidden={!s.dash}>
              <Window url={PREVIEW_URL} className="mo-win">
                <div className="ag-dash-body">
                  <div className="ag-dash-head">
                    <strong>Checkout API</strong>
                    <span className="ag-badge">added in preview</span>
                  </div>
                  <div className="mo-stats">
                    {STATS.map(([name, value, tone]) => (
                      <div key={name} className="mo-card">
                        <b>{name}</b>
                        <strong className={tone}>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="mo-charts">
                    <div className="mo-card mo-chartcard">
                      <b>Requests by route</b>
                      <div className="mo-chart" style={{ width: dash.w, height: dash.h }}>
                        <Chart
                          data={REQUESTS}
                          width={dash.w}
                          height={dash.h}
                          max={6}
                          dot={false}
                          show={s.dash}
                          className="mo-c-purple"
                        />
                      </div>
                    </div>
                    <div className="mo-card mo-chartcard mo-hide-c">
                      <b>p95 latency, POST /checkout</b>
                      <div className="mo-chart" style={{ width: dash.w, height: dash.h }}>
                        <Chart
                          data={LATENCY}
                          width={dash.w}
                          height={dash.h}
                          max={14}
                          dot={false}
                          show={s.dash}
                          className="mo-c-purple"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Window>
            </div>
            <span className="ag-rest" data-target="rest" />
          </div>
        );
      }}
    </Stage>
  );
}
