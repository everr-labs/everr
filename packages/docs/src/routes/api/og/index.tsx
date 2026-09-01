import instrumentSansFontBase64 from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?inline";
import { ImageResponse } from "@takumi-rs/image-response";
import { createFileRoute } from "@tanstack/react-router";
import stylesheet from "@/styles/docs.css?inline";

/**
 * The site-wide Open Graph card, used by every page that has no card of its
 * own. Same renderer as the devlog cards so the two stay visually consistent.
 */
function decodeInlineFont(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const instrumentSansFontData = decodeInlineFont(instrumentSansFontBase64);

export const Route = createFileRoute("/api/og/")({
  server: {
    handlers: {
      GET: async () => {
        return new ImageResponse(
          <div className="flex flex-col w-full h-full px-[72px] py-[60px] bg-[#0a0a0a] text-neutral-50 font-sans">
            <div className="flex items-center justify-between">
              <div
                className="font-heading text-[22px] font-semibold tracking-tight"
                style={{ fontFamily: "Instrument Sans" }}
              >
                Everr
              </div>
              <div
                className="font-heading text-base font-semibold uppercase tracking-[0.15em] text-neutral-500"
                style={{ fontFamily: "Instrument Sans" }}
              >
                everr.dev
              </div>
            </div>

            <div className="flex flex-col flex-1 justify-center gap-5">
              <div
                className="font-heading text-6xl font-bold leading-[1.05] tracking-tight max-w-[900px]"
                style={{ fontFamily: "Instrument Sans" }}
              >
                Observability made simple
              </div>
              <div
                className="text-2xl leading-relaxed text-neutral-400 max-w-[840px]"
                style={{ fontFamily: "Instrument Sans" }}
              >
                OpenTelemetry logs, traces and metrics. Dashboards, alerts and
                runbooks as code. A CLI and an API your agents can use.
              </div>
            </div>

            <div className="flex gap-10 border-t-2 border-white/10 pt-7">
              {["OpenTelemetry", "As code", "Built for agents"].map((label) => (
                <div
                  key={label}
                  className="font-heading text-[13px] font-bold uppercase tracking-widest text-neutral-500"
                  style={{ fontFamily: "Instrument Sans" }}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>,
          {
            width: 1200,
            height: 630,
            format: "png",
            stylesheets: [stylesheet],
            fonts: [
              {
                name: "Instrument Sans",
                data: instrumentSansFontData,
                style: "normal" as const,
              },
            ],
          },
        );
      },
    },
  },
});
