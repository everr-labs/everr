import { CircleAlert, Image, Search } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Mascot } from "@/components/mascot";
import { m } from "@/paraglide/messages";
import { type Act, Chart, Check, Meter, Stage, Toggle } from "../monitoring-demo/kit";
import "../monitoring-demo/monitoring-demo.css";
import "./hero-watch.css";

// Three pieces of somebody's app, and what Everr says when each one goes wrong
const NOTICES = [
  { time: "09:41", what: m.hero_notice_1_what, why: m.hero_notice_1_why },
  { time: "14:02", what: m.hero_notice_2_what, why: m.hero_notice_2_why },
  { time: "22:17", what: m.hero_notice_3_what, why: m.hero_notice_3_why },
];
const PAY = 0;
const SIGN_UP = 1;
const UPLOAD = 2;

const CALM = 0;
const BUSY = 1;
const FLAGGED = 2;
const TOLD = 3;
const FIXED = 4;
const CLEARING = 5;

type S = { part: number; step: number };
const INITIAL: S = { part: PAY, step: CALM };
const POSTER: S = { part: PAY, step: TOLD };

// A part struggles, Everr notices and says why, the part recovers
const script = async (a: Act<S>) => {
  for (const part of [PAY, SIGN_UP, UPLOAD]) {
    await a.set({ part, step: CALM });
    await a.wait(900);
    await a.set({ step: BUSY });
    await a.wait(1300);
    await a.set({ step: FLAGGED });
    await a.wait(350);
    await a.set({ step: TOLD });
    await a.wait(3800);
    await a.set({ step: FIXED });
    await a.wait(1100);
    await a.set({ step: CLEARING });
    await a.wait(600);
  }
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
  const wrong = step === FLAGGED || step === TOLD;
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
function Action({ label, step, className }: { label: ReactNode; step: number; className: string }) {
  const idle = step === CALM || step === CLEARING;
  return (
    <span
      className={`hw-action ${className}`}
      data-wrong={step === FLAGGED || step === TOLD || undefined}
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
      compact={{ below: 470, width: 374, height: 640 }}
      fill
      theme="dark"
      initial={INITIAL}
      poster={POSTER}
      script={script}
      className="mo hw"
    >
      {(s, _rect, layout) => {
        const compact = layout === "compact";
        const stepOf = (part: number) => (s.part === part ? s.step : CALM);
        const noticing = s.step >= FLAGGED && s.step <= FIXED;
        const upload = stepOf(UPLOAD);
        return (
          <div className="hw-scene">
            {!compact && (
              <div className="hw-card hw-form" style={at(24, 24, 250, 196)}>
                <span className="hw-field">
                  <i style={{ width: 96 }} />
                </span>
                <span className="hw-field">
                  <i style={{ width: 132 }} />
                </span>
                <Action className="hw-quiet" label={m.hero_ui_signup()} step={stepOf(SIGN_UP)} />
              </div>
            )}
            {compact && (
              <Action
                className="hw-quiet hw-float"
                label={m.hero_ui_signup()}
                step={stepOf(SIGN_UP)}
              />
            )}

            <div
              className="hw-card hw-upload"
              style={compact ? at(16, 92, 342, 76) : at(298, 24, 300, 80)}
            >
              <span className="hw-thumb">
                <Image size={22} aria-hidden="true" />
              </span>
              <span className="hw-upload-body">
                <span className="hw-file">IMG_2041.jpg</span>
                <Meter
                  value={upload === CALM || upload === FIXED ? 1 : upload === CLEARING ? 1 : 0.62}
                  tone={
                    upload === FLAGGED || upload === TOLD
                      ? "danger"
                      : upload === FIXED
                        ? "success"
                        : "ink"
                  }
                />
              </span>
              <Status step={upload === CALM || upload === CLEARING ? FIXED : upload} />
            </div>

            <span className="hw-pay" style={compact ? at(16, 16, 190, 60) : at(298, 128, 230, 68)}>
              <Action className="hw-solid" label={m.hero_ui_pay()} step={stepOf(PAY)} />
            </span>

            {!compact && (
              <>
                <div className="hw-card hw-switch" style={at(552, 128, 124, 68)}>
                  <i style={{ width: 34 }} />
                  <Toggle on />
                </div>
                <div className="hw-card hw-chart" style={at(622, 24, 220, 80)}>
                  <Chart
                    data={[12, 18, 14, 22, 19, 27, 24, 31, 28, 36, 33, 40]}
                    width={220}
                    height={56}
                    dot={false}
                    show
                  />
                </div>
                <div className="hw-card hw-search" style={at(24, 244, 250, 56)}>
                  <Search size={18} aria-hidden="true" />
                  <i style={{ width: 88 }} />
                </div>
              </>
            )}
            {compact && (
              <div className="hw-card hw-search" style={at(222, 16, 220, 60)}>
                <Search size={18} aria-hidden="true" />
                <i style={{ width: 160 }} />
              </div>
            )}
            <div
              className="hw-slider"
              style={compact ? at(270, 211, 160, 6) : at(700, 159, 140, 6)}
            >
              <span />
              <i />
            </div>

            <Mascot
              glow
              faceClassName="fill-[oklch(0.13_0_0)]"
              eyesClassName="fill-primary"
              raysClassName={noticing ? "fill-primary" : "fill-foreground/20"}
              className="hw-mascot"
              style={compact ? at(110, 388, 300, 300) : at(452, 226, 350, 350)}
            />

            <div className="hw-notices" style={compact ? at(16, 262, 342) : at(24, 328, 400)}>
              {NOTICES.map((notice, part) => (
                <div
                  key={notice.time}
                  className="hw-notice"
                  data-on={(s.part === part && (s.step === TOLD || s.step === FIXED)) || undefined}
                >
                  <span className="hw-time">{notice.time}</span>
                  <span className="hw-what">{notice.what()}</span>
                  <span className="hw-why">{notice.why()}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }}
    </Stage>
  );
}
