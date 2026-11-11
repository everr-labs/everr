import { CircleAlert, GitCommitHorizontal, GitPullRequest, Image, Search } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Mascot } from "@/components/mascot";
import { m } from "@/paraglide/messages";
import { type Act, Chart, Check, Collapse, Meter, Stage, Toggle } from "../monitoring-demo/kit";
import "../monitoring-demo/monitoring-demo.css";
import "./hero-watch.css";

// Three pieces of somebody's app, and how Everr gets from the symptom to the cause and a fix
const CASES = [
  {
    what: m.hero_notice_1_what,
    steps: [m.hero_notice_1_step_1, m.hero_notice_1_step_2],
    why: m.hero_notice_1_why,
    change: { icon: GitPullRequest, id: "#482", file: "orders.sql" },
    fix: [
      { add: true, code: "CREATE INDEX orders_by_customer" },
      { add: true, code: "  ON orders (customer_id);" },
    ],
  },
  {
    what: m.hero_notice_2_what,
    steps: [m.hero_notice_2_step_1, m.hero_notice_2_step_2],
    why: m.hero_notice_2_why,
    change: { icon: GitCommitHorizontal, id: "a3f9c1e", file: "signup.ts:42" },
    fix: [
      { add: false, code: "/^[\\w.]+@[\\w.]+$/" },
      { add: true, code: "/^[\\w.+-]+@[\\w.-]+$/" },
    ],
  },
  {
    what: m.hero_notice_3_what,
    steps: [m.hero_notice_3_step_1, m.hero_notice_3_step_2],
    why: m.hero_notice_3_why,
    change: { icon: GitPullRequest, id: "#467", file: "upload.ts:7" },
    fix: [
      { add: false, code: 'maxSize: "10mb",' },
      { add: true, code: 'maxSize: "25mb",' },
    ],
  },
];
const PAY = 0;
const SIGN_UP = 1;
const UPLOAD = 2;

const TARGETS = ["pay", "sign-up", "upload"];
const AIM = [
  { x: 0.84, y: 0.66 },
  { x: 0.86, y: 0.7 },
  { x: 0.1, y: 0.72 },
];
// Empty ground, close to the first thing the pointer presses
const REST = { wide: { x: 560, y: 236 }, compact: { x: 210, y: 170 } };

const CALM = 0;
const BUSY = 1;
const FLAGGED = 2;
// The card is up with the symptom, then one step of the investigation at a time
const TOLD = 3;
const FIRST_STEP = 4;
// Both steps are ticked and it holds a beat, then says what it found and how to fix it
const CHECKED = 6;
const FOUND = 7;
const PROPOSED = 8;
const FIXED = 9;
const CLEARING = 10;

type S = { part: number; step: number };
const INITIAL: S = { part: PAY, step: CALM };
const POSTER: S = { part: PAY, step: PROPOSED };

// A part struggles, Everr notices, looks into it and says why, the part recovers
const script = async (a: Act<S>) => {
  for (const part of [PAY, SIGN_UP, UPLOAD]) {
    await a.set({ part, step: CALM });
    await a.wait(500);
    // Off the label, so the pointer never covers what it presses
    await a.click({ at: TARGETS[part], ...AIM[part] });
    await a.set({ step: BUSY });
    await a.wait(1300);
    await a.set({ step: FLAGGED });
    await a.wait(350);
    await a.set({ step: TOLD });
    await a.wait(1000);
    await a.set({ step: FIRST_STEP });
    await a.wait(1300);
    await a.set({ step: FIRST_STEP + 1 });
    await a.wait(1400);
    await a.set({ step: CHECKED });
    await a.wait(500);
    await a.set({ step: FOUND });
    await a.wait(1500);
    await a.set({ step: PROPOSED });
    await a.wait(3600);
    await a.set({ step: FIXED });
    await a.wait(1100);
    await a.set({ step: CLEARING });
    await a.wait(600);
  }
  await a.move(a.layout === "compact" ? REST.compact : REST.wide, { duration: 700 });
  await a.set(INITIAL);
};

const at = (left: number, top: number, width?: number, height?: number): CSSProperties => ({
  left,
  top,
  width,
  height,
});

/** One slot, three marks: still working, something is wrong, done */
function Status({ step, size = 26 }: { step: number; size?: number }) {
  const wrong = step >= FLAGGED && step < FIXED;
  return (
    <span className="hw-status" style={{ width: size, height: size }}>
      <span className="hw-layer" data-on={!wrong || undefined}>
        <Check on={step === FIXED} pending={step === BUSY} size={size} />
      </span>
      <span className="hw-layer hw-wrong" data-on={wrong || undefined}>
        <CircleAlert size={size} strokeWidth={2.2} aria-hidden="true" />
      </span>
    </span>
  );
}

/** A button whose label gives way to its status while it works */
function Action({
  label,
  step,
  target,
  className,
  aside,
}: {
  label: ReactNode;
  step: number;
  target: string;
  className: string;
  aside?: boolean;
}) {
  const idle = step === CALM || step === CLEARING;
  return (
    <span
      className={`hw-action ${className}`}
      data-target={target}
      data-aside={aside || undefined}
      data-wrong={(step >= FLAGGED && step < FIXED) || undefined}
    >
      <span className="hw-layer" data-on={idle || undefined}>
        {label}
      </span>
      <span className="hw-layer" data-on={!idle || undefined}>
        <Status step={step} />
      </span>
    </span>
  );
}

export function HeroWatch() {
  return (
    <Stage<S>
      width={760}
      height={540}
      compact={{ below: 470, width: 374, height: 428 }}
      fill
      theme="dark"
      initial={INITIAL}
      poster={POSTER}
      script={script}
      cursor={{ at: REST, style: "arrow", ripple: true }}
      className="mo hw"
    >
      {(s, _rect, layout) => {
        const compact = layout === "compact";
        const stepOf = (part: number) => (s.part === part ? s.step : CALM);
        // Red while the alert is fresh, its own color while it is on the case, green once fixed
        const rays =
          s.step === FLAGGED || s.step === TOLD
            ? "fill-destructive"
            : s.step === FIXED
              ? "fill-[oklch(0.72_0.19_150)]"
              : s.step > TOLD && s.step < FIXED
                ? "fill-primary"
                : "fill-foreground/20";
        const upload = stepOf(UPLOAD);
        return (
          <div className="hw-scene" data-told={(s.step >= TOLD && s.step <= FIXED) || undefined}>
            {!compact && (
              <div
                className="hw-card hw-form"
                data-aside={s.part !== SIGN_UP || undefined}
                style={at(24, 24, 250, 166)}
              >
                <span className="hw-field">
                  <i style={{ width: 96 }} />
                </span>
                <span className="hw-field">
                  <i style={{ width: 132 }} />
                </span>
                <Action
                  className="hw-quiet"
                  target="sign-up"
                  label={m.hero_ui_signup()}
                  step={stepOf(SIGN_UP)}
                />
              </div>
            )}
            {compact && (
              <Action
                className="hw-quiet hw-float"
                aside={s.part !== SIGN_UP}
                target="sign-up"
                label={m.hero_ui_signup()}
                step={stepOf(SIGN_UP)}
              />
            )}

            <div
              className="hw-card hw-upload"
              data-target="upload"
              data-aside={s.part !== UPLOAD || undefined}
              style={compact ? at(16, 116, 190, 48) : at(298, 24, 300, 80)}
            >
              <span className="hw-thumb">
                <Image size={22} aria-hidden="true" />
              </span>
              <span className="hw-upload-body">
                <span className="hw-file">IMG_2041.jpg</span>
                <Meter
                  value={upload === CALM || upload === FIXED ? 1 : upload === CLEARING ? 1 : 0.62}
                  tone={
                    upload >= FLAGGED && upload < FIXED
                      ? "danger"
                      : upload === FIXED
                        ? "success"
                        : "ink"
                  }
                />
              </span>
              <Status step={upload === CALM || upload === CLEARING ? FIXED : upload} />
            </div>

            <span
              className="hw-pay"
              data-aside={s.part !== PAY || undefined}
              style={compact ? at(16, 12, 190, 44) : at(298, 128, 230, 68)}
            >
              <Action
                className="hw-solid"
                target="pay"
                label={m.hero_ui_pay()}
                step={stepOf(PAY)}
              />
            </span>

            {!compact && (
              <>
                <div className="hw-card hw-switch" data-aside style={at(552, 128, 124, 68)}>
                  <i style={{ width: 34 }} />
                  <Toggle on />
                </div>
                <div className="hw-card hw-chart" data-aside style={at(622, 24, 220, 80)}>
                  <Chart
                    data={[12, 18, 14, 22, 19, 27, 24, 31, 28, 36, 33, 40]}
                    width={220}
                    height={56}
                    dot={false}
                    show
                  />
                </div>
                <div className="hw-card hw-search" data-aside style={at(24, 206, 250, 52)}>
                  <Search size={18} aria-hidden="true" />
                  <i style={{ width: 88 }} />
                </div>
              </>
            )}
            {compact && (
              <>
                <div className="hw-card hw-search" data-aside style={at(16, 180, 206, 52)}>
                  <Search size={18} aria-hidden="true" />
                  <i style={{ width: 96 }} />
                </div>
                <div className="hw-card hw-switch" data-aside style={at(234, 180, 124, 52)}>
                  <i style={{ width: 30 }} />
                  <Toggle on />
                </div>
                <div className="hw-card hw-chart" data-aside style={at(16, 244, 342, 112)}>
                  <Chart
                    data={[12, 18, 14, 22, 19, 27, 24, 31, 28, 36, 33, 40]}
                    width={342}
                    height={76}
                    dot={false}
                    show
                  />
                </div>
              </>
            )}
            {!compact && (
              <div className="hw-slider" data-aside style={at(700, 159, 140, 6)}>
                <span />
                <i />
              </div>
            )}

            <Mascot
              mirrored
              glow
              faceClassName="fill-[oklch(0.13_0_0)]"
              eyesClassName="fill-primary"
              raysClassName={rays}
              className="hw-mascot"
              style={compact ? at(214, 6, 148, 148) : at(404, 258, 328, 328)}
            />

            <div className="hw-cases" style={compact ? at(16, 172, 342) : at(24, 276, 360)}>
              {CASES.map((item, part) => {
                const step = s.part === part ? s.step : CALM;
                return (
                  <div
                    key={item.what.name}
                    className="hw-case"
                    data-on={(step >= TOLD && step <= FIXED) || undefined}
                  >
                    <span className="hw-what">{item.what()}</span>
                    {/* The title stays put; what follows rises under it as more arrives */}
                    <div className="hw-body">
                      <div className="hw-flow">
                        {item.steps.map((text, i) => (
                          <Collapse key={text.name} open={step >= FIRST_STEP + i && step <= FIXED}>
                            <span className="hw-step">
                              <Check on={step > FIRST_STEP + i} pending size={16} />
                              {text()}
                            </span>
                          </Collapse>
                        ))}
                        <Collapse open={step >= FOUND && step <= FIXED}>
                          <span className="hw-why">{item.why()}</span>
                        </Collapse>
                        <Collapse open={step >= PROPOSED && step <= FIXED}>
                          <div className="hw-patch">
                            <span className="hw-patch-head">
                              <item.change.icon size={14} aria-hidden="true" />
                              <span>{item.change.id}</span>
                              <span className="hw-path">{item.change.file}</span>
                              <b>{m.hero_fix_label()}</b>
                            </span>
                            {item.fix.map((line) => (
                              <code key={line.code} data-add={line.add || undefined}>
                                <i>{line.add ? "+" : "-"}</i>
                                {line.code}
                              </code>
                            ))}
                          </div>
                        </Collapse>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }}
    </Stage>
  );
}
