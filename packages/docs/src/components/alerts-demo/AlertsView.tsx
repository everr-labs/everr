import { ArrowUpRight, BellOff, Circle, Clock, Flame, Send, TriangleAlert, X } from "lucide-react";
import { Roll } from "../monitoring-demo/kit";
import "./alerts-demo.css";

// Everr's Triage screen, from the app's own triage list and detail panel: a
// rule goes pending, then firing, the on-call channel is notified, and the
// alert opens on its breaching instances and runbook. The player drives it.

export type AlertPhase = "ok" | "pending" | "firing";

/** The Triage screen's part of the player's scene state. */
export type AlertState = { phase: AlertPhase; sent: boolean; panel: boolean };

// Past stretches on each rule's lane, as fractions of the hour shown
type Stretch = { from: number; to: number; state: "firing" | "pending" };

const RULES: { name: string; severity: "critical" | "warning" | "info"; past: Stretch[] }[] = [
  { name: "Checkout latency", severity: "critical", past: [] },
  {
    name: "Payment errors",
    severity: "critical",
    past: [{ from: 0.18, to: 0.24, state: "firing" }],
  },
  { name: "Queue depth", severity: "warning", past: [{ from: 0.52, to: 0.55, state: "pending" }] },
  { name: "Disk usage", severity: "info", past: [] },
  { name: "API error rate", severity: "warning", past: [] },
  {
    name: "Worker restarts",
    severity: "info",
    past: [{ from: 0.71, to: 0.73, state: "pending" }],
  },
  { name: "Login failures", severity: "warning", past: [] },
];

const INSTANCES = [
  { label: "service=payments", value: "1,118.9", breach: true },
  { label: "service=checkout-api", value: "720.8", breach: true },
  { label: "service=search", value: "263.3", breach: false },
];

const AXIS = ["60m", "45m", "30m", "15m", "now"];

function StatusIcon({ phase }: { phase: AlertPhase }) {
  const Icon = phase === "pending" ? Clock : phase === "firing" ? Flame : Circle;
  return (
    <span className="al-status" data-phase={phase}>
      <Icon key={phase} size={14} aria-hidden="true" />
    </span>
  );
}

// The Triage screen, mounted in the player as its fourth view.
export function AlertsView({ s }: { s: AlertState }) {
  const firing = s.phase === "firing";
  return (
    <>
      <div className="al-body">
        {/* The firing band opens above the list, carrying the alert */}
        <div className="al-band" data-open={firing || undefined}>
          <div>
            <div className="al-band-head">
              <Flame size={13} aria-hidden="true" />
              FIRING <span>1</span>
            </div>
            <div className="al-card" data-target="alert-card">
              <div className="al-card-title">
                <strong>Checkout latency</strong>
                <span className="al-sent" data-sent={s.sent || undefined}>
                  <Send size={11} aria-hidden="true" />
                  <Roll variant="fade">{s.sent ? "sent to #incidents" : "sending"}</Roll>
                </span>
              </div>
              <div className="al-worst mo-hide-c">
                <small>worst of 2 breaching · 3 rows</small>
                <span>
                  <b>1,118.9</b> value &gt;= 500
                </span>
              </div>
              <div className="al-for">
                <small>firing for</small>
                <b>just now</b>
              </div>
              <span className="al-silence mo-hide-c">Silence</span>
            </div>
          </div>
        </div>

        <div className="al-legend mo-hide-c">
          <span>
            <Flame size={11} className="al-red" aria-hidden="true" /> Firing
          </span>
          <span>
            <Clock size={11} className="al-amber" aria-hidden="true" /> Pending
          </span>
          <span>
            <BellOff size={11} className="al-red" aria-hidden="true" /> Silenced
          </span>
          <span>
            <TriangleAlert size={11} aria-hidden="true" /> Not evaluating
          </span>
          <span>
            <Circle size={11} aria-hidden="true" /> Inactive
          </span>
        </div>

        <div className="al-row al-row--head">
          <strong>All rules</strong>
          <span className="al-axis">
            {AXIS.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </span>
          <span className="mo-hide-c">SEVERITY</span>
          <span className="mo-hide-c">EVERY</span>
        </div>
        {RULES.map((r, i) => {
          const phase = i === 0 ? s.phase : "ok";
          return (
            <div key={r.name} className="al-row">
              <span className="al-name">
                <StatusIcon phase={phase} />
                {r.name}
              </span>
              <span className="al-lane">
                {r.past.map((p) => (
                  <i
                    key={p.from}
                    data-state={p.state}
                    style={{
                      left: `${p.from * 100}%`,
                      width: `${(p.to - p.from) * 100}%`,
                    }}
                  />
                ))}
                {i === 0 && (
                  <>
                    <i
                      className="al-tail al-tail--pending"
                      data-state="pending"
                      data-on={phase !== "ok" || undefined}
                    />
                    <i
                      className="al-tail al-tail--firing"
                      data-state="firing"
                      data-on={phase === "firing" || undefined}
                    />
                  </>
                )}
              </span>
              <span className="al-sev mo-hide-c" data-sev={r.severity}>
                <i /> {r.severity}
              </span>
              <span className="al-every mo-hide-c">1m</span>
            </div>
          );
        })}
      </div>

      {/* The alert, opened beside the list */}
      <aside className="al-panel" data-open={s.panel || undefined}>
        <div className="al-p-head">
          <code>api/checkout-latency</code>
          <span className="al-close" data-target="close">
            <X size={14} aria-hidden="true" />
          </span>
          <strong>Checkout latency</strong>
          <span className="al-p-status">
            <Flame size={12} aria-hidden="true" />
            <b>Firing just now</b>
            <code>sent to #incidents</code>
          </span>
        </div>
        <div className="al-p-sec">
          <p>p95 latency of the checkout API, per service, over its 500ms budget.</p>
          <div className="al-p-meta">
            <code>severity critical · every 1m · for 2m</code>
            <span className="al-runbook" data-target="runbook">
              Runbook <ArrowUpRight size={12} aria-hidden="true" />
            </span>
          </div>
        </div>
        <div className="al-p-sec">
          <div className="al-p-label">
            <span>Instances · 2 of 3 breaching</span>
            <code>value &gt;= 500</code>
          </div>
          {INSTANCES.map((inst) => (
            <div key={inst.label} className="al-inst">
              <code>{inst.label}</code>
              <span className="al-inst-lane" data-breach={inst.breach || undefined} />
              <b data-breach={inst.breach || undefined}>{inst.value}</b>
            </div>
          ))}
        </div>
        <div className="al-p-sec">
          <div className="al-p-label">
            <span>History</span>
          </div>
          <div className="al-hist">
            <code>12:26</code> <code>instance_pending · payments</code>
          </div>
          <div className="al-hist">
            <code>12:28</code> <code>instance_fired · payments</code>
          </div>
          <div className="al-hist">
            <code>12:28</code> <code>notification_sent · #incidents</code>
          </div>
        </div>
      </aside>
    </>
  );
}
