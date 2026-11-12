import instrumentSansFontBase64 from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?inline";
import { ImageResponse } from "@takumi-rs/image-response";
import { createFileRoute } from "@tanstack/react-router";
import { cacheShareImage, shareImageHead } from "@/lib/og-cache";
import stylesheet from "@/styles/docs.css?inline";

function decodeInlineFont(dataUrl: string): ArrayBuffer {
  const binary = atob(dataUrl.split(",")[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const instrumentSansFontData = decodeInlineFont(instrumentSansFontBase64);
const font = { fontFamily: "Instrument Sans" };

// The default share image of the site, used by every page without its own
export const Route = createFileRoute("/api/og/site")({
  server: {
    handlers: {
      HEAD: shareImageHead,
      GET: () =>
        cacheShareImage(
          new ImageResponse(
            <div className="flex flex-col w-full h-full px-[72px] py-[60px] bg-[#0a0a0a] text-neutral-50 font-sans">
              <div className="font-heading text-[22px] font-semibold tracking-tight" style={font}>
                Everr
              </div>
              <div className="flex flex-col flex-1 justify-center gap-6">
                <div
                  className="font-heading text-7xl font-bold leading-[1.05] tracking-tight max-w-[900px]"
                  style={font}
                >
                  Observability made simple
                </div>
                <div
                  className="text-2xl leading-relaxed text-neutral-400 max-w-[860px]"
                  style={font}
                >
                  Open source observability on OpenTelemetry, built for you and your coding agent.
                </div>
              </div>
              <div className="text-xl font-semibold text-[#C4E901]" style={font}>
                everr.dev
              </div>
            </div>,
            {
              width: 1200,
              height: 630,
              format: "png",
              stylesheets: [stylesheet],
              fonts: [
                { name: "Instrument Sans", data: instrumentSansFontData, style: "normal" as const },
              ],
            },
          ),
        ),
    },
  },
});
