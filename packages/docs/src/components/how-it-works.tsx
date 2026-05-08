import { motion, useInView } from "motion/react";
import { useRef } from "react";

// type Step = {
//   num: string;
//   title: string;
//   body: ReactNode;
//   illustration: ReactNode;
// };

// const STEPS: Step[] = [
//   {
//     num: "01",
//     title: "Sidecar collector",
//     body: (
//       <>
//         Everr starts as a process that sits right next to your coding agent's
//         terminal. Every command it runs — your test suite, the dev server, an
//         integration script — lands in the collector. Auto-instrumented. No code
//         changes.
//       </>
//     ),
//     illustration: <SidecarIllustration />,
//   },
//   {
//     num: "02",
//     title: "Real behavior, not vibes",
//     body: (
//       <>
//         Before the agent guesses, it queries Everr. Real error rates. Real
//         latency distributions. The spans that actually fired. Not what the code{" "}
//         <em>should</em> do — what it does, on the machine that just ran it.
//       </>
//     ),
//     illustration: <GroundTruthIllustration />,
//   },
//   {
//     num: "03",
//     title: "Sessions, not silos",
//     body: (
//       <>
//         Push a session to a shared cluster and your team — humans and their own
//         agents — pick up the trail. The query that surfaced a bug for you
//         surfaces the fix for the next agent. Investigations compound across time
//         zones.
//       </>
//     ),
//     illustration: <CollaborationIllustration />,
//   },
// ];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-y-2 border-fd-border bg-fd-card/30"
    >
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-4xl"
        >
          <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
            How it works
          </p>
          <h2 className="mt-4 font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
            <span className="text-fd-foreground">
              Your agent shouldn't have to guess.
            </span>{" "}
          </h2>
          <p className="text-fd-muted-foreground/60 mt-4 font-heading text-2xl leading-[1.1] tracking-tight sm:text-3xl md:text-4xl lg:text-5xl">
            Reading the codebase tells half the story. Everr captures the other
            half — what the code actually does the moment it runs — and puts it
            behind a query the agent already knows how to write.
          </p>
        </motion.div>

        {/*<div className="mt-24 grid gap-px overflow-hidden md:mt-32 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <StepBlock key={step.num} step={step} index={i} inView={inView} />
          ))}
        </div>*/}

        {/* Closing tagline */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{
            duration: 0.7,
            delay: 0.9,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="mt-20 max-w-3xl border-l-2 border-primary pl-6 text-base leading-relaxed text-fd-muted-foreground md:text-lg"
        >
          Same primitives, same data, same answers — whether the agent is on
          your laptop, a sandbox in the cloud, or a teammate's machine three
          time zones away.
        </motion.p>
      </div>
    </section>
  );
}

// function StepBlock({
//   step,
//   index,
//   inView,
// }: {
//   step: Step;
//   index: number;
//   inView: boolean;
// }) {
//   return (
//     <motion.div
//       initial={{ opacity: 0, y: 24 }}
//       animate={inView ? { opacity: 1, y: 0 } : undefined}
//       transition={{
//         duration: 0.7,
//         delay: 0.25 + index * 0.15,
//         ease: [0.22, 1, 0.36, 1],
//       }}
//       className="relative flex flex-col px-0 md:border-l md:border-fd-border/60 md:px-10 md:first:border-l-0 md:first:pl-0 md:last:pr-0"
//     >
//       <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fd-muted-foreground/40">
//         STEP {step.num}
//       </span>

//       <motion.div
//         initial={{ opacity: 0, scale: 0.95 }}
//         animate={inView ? { opacity: 1, scale: 1 } : undefined}
//         transition={{
//           duration: 1,
//           delay: 0.4 + index * 0.15,
//           ease: [0.22, 1, 0.36, 1],
//         }}
//         className="mt-10 flex h-48 items-center justify-center text-fd-foreground/40 md:h-56"
//       >
//         {step.illustration}
//       </motion.div>

//       <div className="mt-10 md:mt-14">
//         <h3 className="font-heading text-lg font-bold text-fd-foreground">
//           {step.title}
//         </h3>
//         <p className="mt-3 max-w-sm text-sm leading-relaxed text-fd-muted-foreground md:text-base">
//           {step.body}
//         </p>
//       </div>
//     </motion.div>
//   );
// }

/* ------------------------------------------------------------------ */
/*  Illustrations                                                       */
/* ------------------------------------------------------------------ */

// const STROKE_PROPS = {
//   fill: "none",
//   stroke: "currentColor",
//   strokeWidth: 1.25,
//   strokeLinecap: "round" as const,
//   strokeLinejoin: "round" as const,
//   vectorEffect: "non-scaling-stroke" as const,
// };

// /** Two terminal panes side by side: agent on the left, everr collector on the right, talking via a shared bus. */
// function SidecarIllustration() {
//   return (
//     <svg
//       viewBox="0 0 240 160"
//       width="100%"
//       height="100%"
//       preserveAspectRatio="xMidYMid meet"
//       aria-hidden
//     >
//       <g {...STROKE_PROPS}>
//         {/* Agent pane */}
//         <rect x="14" y="22" width="98" height="100" rx="3" />
//         <line x1="14" y1="36" x2="112" y2="36" />
//         <circle cx="22" cy="29" r="1.6" fill="currentColor" stroke="none" />
//         <circle cx="29" cy="29" r="1.6" fill="currentColor" stroke="none" />
//         <circle cx="36" cy="29" r="1.6" fill="currentColor" stroke="none" />
//         <text
//           x="14"
//           y="16"
//           fontSize="6.5"
//           fontFamily="ui-monospace,monospace"
//           fill="currentColor"
//           stroke="none"
//           opacity={0.5}
//           letterSpacing="1.5"
//         >
//           AGENT
//         </text>
//         {/* Prompt content */}
//         <text
//           x="22"
//           y="52"
//           fontSize="6"
//           fontFamily="ui-monospace,monospace"
//           fill="currentColor"
//           stroke="none"
//           opacity={0.85}
//         >
//           {">"} npm test
//         </text>
//         <line x1="22" y1="62" x2="92" y2="62" opacity={0.45} />
//         <line x1="22" y1="72" x2="80" y2="72" opacity={0.45} />
//         <line x1="22" y1="82" x2="96" y2="82" opacity={0.45} />
//         <line x1="22" y1="92" x2="70" y2="92" opacity={0.45} />
//         <line x1="22" y1="102" x2="84" y2="102" opacity={0.45} />

//         {/* Connector — bidirectional, accent */}
//         <g className="text-primary" stroke="currentColor">
//           <line x1="112" y1="72" x2="128" y2="72" />
//           <line x1="112" y1="82" x2="128" y2="82" />
//           <path d="M 116 68 L 112 72 L 116 76" />
//           <path d="M 124 78 L 128 82 L 124 86" />
//         </g>

//         {/* Everr collector pane */}
//         <rect x="128" y="22" width="98" height="100" rx="3" />
//         <line x1="128" y1="36" x2="226" y2="36" />
//         <circle
//           cx="220"
//           cy="29"
//           r="2.5"
//           fill="currentColor"
//           stroke="none"
//           className="text-primary"
//         />
//         <text
//           x="128"
//           y="16"
//           fontSize="6.5"
//           fontFamily="ui-monospace,monospace"
//           fill="currentColor"
//           stroke="none"
//           opacity={0.5}
//           letterSpacing="1.5"
//         >
//           EVERR
//         </text>

//         {/* Trace bars piling up */}
//         <line x1="136" y1="50" x2="200" y2="50" opacity={0.85} />
//         <line x1="136" y1="60" x2="186" y2="60" opacity={0.7} />
//         <line x1="136" y1="70" x2="216" y2="70" opacity={0.85} />
//         <line x1="136" y1="80" x2="170" y2="80" opacity={0.6} />
//         <line x1="136" y1="90" x2="208" y2="90" opacity={0.75} />
//         <line x1="136" y1="100" x2="180" y2="100" opacity={0.6} />
//         <line x1="136" y1="110" x2="196" y2="110" opacity={0.55} />

//         {/* Status bar */}
//         <text
//           x="14"
//           y="138"
//           fontSize="6"
//           fontFamily="ui-monospace,monospace"
//           fill="currentColor"
//           stroke="none"
//           opacity={0.45}
//           letterSpacing="1.5"
//         >
//           SIDECAR · LOCAL · LIVE
//         </text>
//       </g>
//     </svg>
//   );
// }

/** A code line being grounded by a runtime metric below it. */
// function GroundTruthIllustration() {
//   return (
//     <svg
//       viewBox="0 0 240 160"
//       width="100%"
//       height="100%"
//       preserveAspectRatio="xMidYMid meet"
//       aria-hidden
//     >
//       <g {...STROKE_PROPS}>
//         {/* Code block (top half) */}
//         <rect x="20" y="14" width="200" height="56" rx="3" />
//         <line x1="20" y1="28" x2="220" y2="28" />
//         <text
//           x="20"
//           y="9"
//           fontSize="6.5"
//           fontFamily="ui-monospace,monospace"
//           fill="currentColor"
//           stroke="none"
//           opacity={0.5}
//           letterSpacing="1.5"
//         >
//           CODE
//         </text>
//         <line x1="32" y1="42" x2="120" y2="42" opacity={0.6} />
//         <line x1="40" y1="52" x2="170" y2="52" opacity={0.6} />
//         <g className="text-primary" stroke="currentColor">
//           <line x1="40" y1="62" x2="200" y2="62" />
//         </g>

//         {/* Connector arrow */}
//         <line
//           x1="120"
//           y1="74"
//           x2="120"
//           y2="92"
//           opacity={0.5}
//           strokeDasharray="2 3"
//         />
//         <path d="M 116 88 L 120 92 L 124 88" opacity={0.6} />

//         {/* Runtime block (bottom half) */}
//         <rect x="20" y="96" width="200" height="56" rx="3" />
//         <line x1="20" y1="110" x2="220" y2="110" />
//         <text
//           x="20"
//           y="91"
//           fontSize="6.5"
//           fontFamily="ui-monospace,monospace"
//           fill="currentColor"
//           stroke="none"
//           opacity={0.5}
//           letterSpacing="1.5"
//         >
//           RUNTIME
//         </text>

//         {/* Mini metric histogram inside runtime block */}
//         {[
//           { x: 32, h: 12 },
//           { x: 44, h: 22 },
//           { x: 56, h: 30 },
//           { x: 68, h: 18 },
//           { x: 80, h: 26 },
//           { x: 92, h: 14 },
//         ].map((b) => (
//           <rect
//             key={b.x}
//             x={b.x}
//             y={142 - b.h}
//             width="6"
//             height={b.h}
//             opacity={0.7}
//           />
//         ))}

//         {/* p95 label + value */}
//         <text
//           x="120"
//           y="128"
//           fontSize="7"
//           fontFamily="ui-monospace,monospace"
//           fill="currentColor"
//           stroke="none"
//           opacity={0.6}
//           letterSpacing="1"
//         >
//           p95
//         </text>
//         <g className="text-primary" stroke="none">
//           <text
//             x="148"
//             y="128"
//             fontSize="9"
//             fontFamily="ui-monospace,monospace"
//             fontWeight="bold"
//             fill="currentColor"
//           >
//             842ms
//           </text>
//         </g>
//         <line x1="120" y1="138" x2="200" y2="138" opacity={0.4} />
//       </g>
//     </svg>
//   );
// }

/** A central everr node with three peer machines connected — humans and remote agents sharing the same session. */
// function CollaborationIllustration() {
//   const center = { x: 120, y: 80 };
//   const peers = [
//     { x: 36, y: 36, label: "AGENT" },
//     { x: 204, y: 36, label: "AGENT" },
//     { x: 36, y: 124, label: "TEAM" },
//     { x: 204, y: 124, label: "TEAM" },
//   ];

//   return (
//     // biome-ignore lint/a11y/noSvgWithoutTitle asdasd
//     <svg
//       viewBox="0 0 240 160"
//       width="100%"
//       height="100%"
//       preserveAspectRatio="xMidYMid meet"
//       aria-hidden
//     >
//       <g {...STROKE_PROPS}>
//         {/* Connector lines (back layer) */}
//         {peers.map((p) => (
//           <line
//             key={`l-${p.x}-${p.y}`}
//             x1={center.x}
//             y1={center.y}
//             x2={p.x}
//             y2={p.y}
//             opacity={0.45}
//             strokeDasharray="3 3"
//           />
//         ))}

//         {/* Peer nodes */}
//         {peers.map((p) => (
//           <g key={`p-${p.x}-${p.y}`}>
//             <circle
//               cx={p.x}
//               cy={p.y}
//               r="14"
//               fill="var(--color-fd-card, #111)"
//             />
//             <text
//               x={p.x}
//               y={p.y + 2}
//               fontSize="5.5"
//               fontFamily="ui-monospace,monospace"
//               fill="currentColor"
//               stroke="none"
//               opacity={0.7}
//               textAnchor="middle"
//               letterSpacing="1"
//             >
//               {p.label}
//             </text>
//           </g>
//         ))}

//         {/* Center: Everr — primary filled */}
//         <g className="text-primary">
//           <circle
//             cx={center.x}
//             cy={center.y}
//             r="22"
//             fill="currentColor"
//             stroke="none"
//           />
//           <circle
//             cx={center.x}
//             cy={center.y}
//             r="28"
//             opacity={0.3}
//             fill="none"
//             stroke="currentColor"
//             strokeDasharray="2 3"
//           />
//           <text
//             x={center.x}
//             y={center.y + 3}
//             fontSize="7"
//             fontFamily="ui-monospace,monospace"
//             fontWeight="bold"
//             fill="var(--color-fd-background, #000)"
//             stroke="none"
//             textAnchor="middle"
//             letterSpacing="1.5"
//           >
//             EVERR
//           </text>
//         </g>

//         {/* Bottom caption */}
//         <text
//           x="120"
//           y="156"
//           fontSize="6"
//           fontFamily="ui-monospace,monospace"
//           fill="currentColor"
//           stroke="none"
//           opacity={0.5}
//           textAnchor="middle"
//           letterSpacing="1.5"
//         >
//           SHARED SESSION
//         </text>
//       </g>
//     </svg>
//   );
// }
