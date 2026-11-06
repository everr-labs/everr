import { type Act, Caret, Collapse, Stage, Stream, Window } from "../monitoring-demo/kit";
import "../monitoring-demo/monitoring-demo.css";
import "./agent-demo.css";

// A coding agent in a terminal, asked the three questions monitoring raises:
// what to instrument, why something is slow, and what to update when the app
// changes. Each answer runs through one of Everr's skills and its CLI. The
// session clears itself with /clear before it starts over.

type Block =
  | { kind: "user"; text: string }
  | { kind: "skill"; text: string }
  | { kind: "edit"; text: string; delta: string }
  | { kind: "run"; text: string }
  | { kind: "ok"; text: string }
  | { kind: "answer"; text: string };

type Step = { block: Block; after: number };

const CHAPTERS: Step[][] = [
  [
    { block: { kind: "user", text: "What should we instrument in checkout?" }, after: 600 },
    { block: { kind: "skill", text: "everr-setup-telemetry" }, after: 700 },
    { block: { kind: "edit", text: "src/instrumentation.ts", delta: "+34" }, after: 800 },
    {
      block: { kind: "run", text: 'everr local query "SELECT SpanName, count() FROM traces"' },
      after: 900,
    },
    { block: { kind: "ok", text: "12 spans from POST /checkout" }, after: 400 },
    {
      block: {
        kind: "answer",
        text: "Traced HTTP, Postgres and the payment client, the path every checkout takes. Verified locally before you deploy.",
      },
      after: 0,
    },
  ],
  [
    { block: { kind: "user", text: "Why is checkout slow since yesterday?" }, after: 600 },
    { block: { kind: "skill", text: "everr-use-telemetry" }, after: 700 },
    {
      block: {
        kind: "run",
        text: 'everr cloud query "SELECT quantile(0.95)(Duration) FROM traces"',
      },
      after: 900,
    },
    { block: { kind: "ok", text: "p95 went from 310ms to 1.1s" }, after: 400 },
    {
      block: {
        kind: "answer",
        text: "SELECT projects takes 2.0s since Tuesday's deploy. It stopped using the org_id index.",
      },
      after: 0,
    },
  ],
  [
    {
      block: { kind: "user", text: "We split out a payments service. Update the alerts." },
      after: 600,
    },
    { block: { kind: "skill", text: "everr-setup-resources" }, after: 700 },
    {
      block: { kind: "edit", text: "everr/alerts/checkout-latency.yaml", delta: "+6" },
      after: 500,
    },
    { block: { kind: "edit", text: "everr/dashboards/checkout.yaml", delta: "+18" }, after: 800 },
    { block: { kind: "run", text: "everr apply ./everr" }, after: 900 },
    { block: { kind: "ok", text: "Applied 1 alert rule and 1 dashboard" }, after: 400 },
    {
      block: {
        kind: "answer",
        text: "The latency alert and the checkout dashboard now cover payments too.",
      },
      after: 0,
    },
  ],
];

const SKILLS = ["everr-setup-telemetry", "everr-use-telemetry", "everr-setup-resources"];
// From about here on the session runs past the top of the terminal
const FULL = 4;
const BLOCKS = CHAPTERS.flat().map((s) => s.block);
const words = (text: string) => text.split(" ").length;

type S = {
  /** What is in the input box */
  typed: string;
  /** How many blocks of the session are on screen */
  shown: number;
  /** The answer streaming in, and how many of its words show */
  streaming: number;
  words: number;
  busy: boolean;
  /** The transcript fading out after /clear */
  clearing: boolean;
};

const initial: S = {
  typed: "",
  shown: 0,
  streaming: -1,
  words: 0,
  busy: false,
  clearing: false,
};

// The poster: the slow checkout explained, the setup above it
const POSTER: S = {
  ...initial,
  shown: CHAPTERS[0].length + CHAPTERS[1].length,
};

async function script(a: Act<S>) {
  await a.wait(700);
  let at = 0;
  for (const chapter of CHAPTERS) {
    const [ask, ...rest] = chapter;
    await a.type("typed", ask.block.text);
    await a.wait(450);
    at += 1;
    await a.set({ typed: "", shown: at, busy: true });
    await a.wait(ask.after);
    for (const step of rest) {
      at += 1;
      if (step.block.kind === "answer") {
        await a.set({ busy: false, shown: at, streaming: at - 1, words: 0 });
        await a.wait(380);
        for (let n = 1; n <= words(step.block.text); n++) {
          await a.set({ words: n });
          await a.wait(55);
        }
        await a.wait(2400);
      } else {
        await a.set({ shown: at });
        await a.wait(step.after);
      }
    }
  }
  // Start over the way a person would: clear the session
  await a.type("typed", "/clear");
  await a.wait(500);
  await a.set({ typed: "", clearing: true });
  await a.wait(320);
  await a.snap({ shown: 0, streaming: -1, words: 0 });
  await a.wait(600);
  await a.set({ clearing: false });
  await a.wait(300);
}

function Line({ block, count }: { block: Block; count: number }) {
  switch (block.kind) {
    case "user":
      return (
        <div className="ag-user">
          <span className="ag-sigil">›</span>
          <span>{block.text}</span>
        </div>
      );
    case "skill":
      return (
        <div className="ag-step">
          <span className="ag-dot" />
          <span className="dim">Skill</span>
          <span className="ag-skill">{block.text}</span>
        </div>
      );
    case "edit":
      return (
        <div className="ag-step">
          <span className="ag-dot ag-dot--mute" />
          <span className="dim">Edit</span>
          <span className="ag-cut">{block.text}</span>
          <span className="ok">{block.delta}</span>
        </div>
      );
    case "run":
      return (
        <div className="ag-step">
          <span className="ag-dot ag-dot--mute" />
          <span className="dim">Run</span>
          <span className="ag-cut ag-cmd">{block.text}</span>
        </div>
      );
    case "ok":
      return (
        <div className="ag-step ag-result">
          <span className="ok">✓</span>
          <span className="ag-cut">{block.text}</span>
        </div>
      );
    case "answer":
      return (
        <div className="ag-answer">
          <Stream text={block.text} count={count} />
        </div>
      );
  }
}

export function AgentDemo() {
  return (
    <Stage<S>
      width={920}
      height={400}
      compact={{ below: 640, width: 358, height: 480 }}
      theme="dark"
      initial={initial}
      poster={POSTER}
      script={script}
      fill
      className="mo ag"
    >
      {(s) => (
        <Window chrome="terminal" lights="grey" title="checkout-api" className="ag-win">
          <div className="ag-log" data-full={s.shown > FULL || undefined}>
            <div className="ag-scroll">
              <div className="ag-hello">
                <span className="ag-hello-title">Everr skills</span>
                <span className="dim">
                  {SKILLS.map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </span>
              </div>
              <div className="ag-blocks" data-clearing={s.clearing || undefined}>
                {BLOCKS.map((block, i) => (
                  <Collapse
                    key={`${block.kind}-${block.text}`}
                    open={i < s.shown}
                    reveal={block.kind === "answer" ? "drop" : "clip"}
                    from="below"
                  >
                    <Line block={block} count={i === s.streaming ? s.words : 999} />
                  </Collapse>
                ))}
              </div>
            </div>
          </div>
          <div className="ag-status" data-on={s.busy || undefined}>
            <span className="ag-spin" />
            Working
          </div>
          <div className="ag-input">
            <span className="ag-sigil">›</span>
            <span className="ag-typed">
              {s.typed}
              <Caret still={s.typed.length > 0} />
            </span>
          </div>
        </Window>
      )}
    </Stage>
  );
}
