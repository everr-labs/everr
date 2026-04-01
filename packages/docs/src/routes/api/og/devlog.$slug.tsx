import { cn } from "@everr/ui/lib/utils";
import interFontBase64 from "@fontsource-variable/inter/files/inter-latin-standard-normal.woff2?inline";
import spaceGroteskFontBase64 from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?inline";
import { ImageResponse } from "@takumi-rs/image-response";
import { createFileRoute } from "@tanstack/react-router";
import { devlogposts } from "@/lib/source";
import stylesheet from "@/styles/docs.css?inline";

// TODO: find a better way to do this. THis is the only way i could get it working right now but it's definitely off.
function decodeInlineFont(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const interFontData = decodeInlineFont(interFontBase64);
const spaceGroteskFontData = decodeInlineFont(spaceGroteskFontBase64);

function StatItem({
  icon,
  value,
  label,
  className,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {icon}
      <div className="flex flex-col">
        <span
          className={cn("font-heading text-2xl font-bold", className)}
          style={{ fontFamily: "Space Grotesk" }}
        >
          {value}
        </span>
        <span
          className="font-heading text-[11px] font-bold uppercase tracking-widest text-neutral-500"
          style={{ fontFamily: "Space Grotesk" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/api/og/devlog/$slug")({
  server: {
    handlers: {
      GET: async ({ params: { slug } }) => {
        const page = devlogposts.getPage([slug]);

        if (!page) {
          return new Response(undefined, { status: 404 });
        }

        const { title, description, date, commits, prs, additions, deletions } =
          page.data;
        const hasStats =
          commits != null ||
          prs != null ||
          additions != null ||
          deletions != null;
        const formattedDate = new Date(date).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        return new ImageResponse(
          <div className="flex flex-col w-full h-full px-[72px] py-[60px] bg-[#0a0a0a] text-neutral-50 font-sans">
            {/* Top bar */}
            <div className="flex items-center justify-between">
              <div
                className="font-heading text-[22px] font-semibold tracking-tight"
                style={{ fontFamily: "Space Grotesk" }}
              >
                Everr
              </div>
              <div
                className="font-heading text-base font-semibold uppercase tracking-[0.15em] text-neutral-500"
                style={{ fontFamily: "Space Grotesk" }}
              >
                Devlog
              </div>
            </div>

            {/* Title and description */}
            <div className="flex flex-col flex-1 justify-center gap-4">
              <div
                className="font-heading text-sm font-bold uppercase tracking-[0.15em] text-neutral-500"
                style={{ fontFamily: "Space Grotesk" }}
              >
                {formattedDate}
              </div>
              <div
                className="font-heading text-5xl font-bold leading-[1.05] tracking-tight max-w-[900px]"
                style={{ fontFamily: "Space Grotesk" }}
              >
                {title}
              </div>
              <div
                className="text-xl leading-relaxed text-neutral-400 max-w-[800px]"
                style={{ fontFamily: "Inter" }}
              >
                {description}
              </div>
            </div>

            {/* Stats bar */}
            {hasStats && (
              <div className="flex gap-12 border-t-2 border-white/10 pt-7">
                {commits != null && (
                  <StatItem
                    icon={
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#C4E901"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <title>Commits</title>
                        <circle cx="12" cy="12" r="3" />
                        <line x1="3" y1="12" x2="9" y2="12" />
                        <line x1="15" y1="12" x2="21" y2="12" />
                      </svg>
                    }
                    value={commits.toLocaleString()}
                    label="Commits"
                  />
                )}
                {prs != null && (
                  <StatItem
                    icon={
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#953EE2"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <title>PRs merged</title>
                        <circle cx="18" cy="18" r="3" />
                        <circle cx="6" cy="6" r="3" />
                        <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                        <line x1="6" y1="9" x2="6" y2="21" />
                      </svg>
                    }
                    value={prs.toLocaleString()}
                    label="PRs merged"
                  />
                )}
                {additions != null && (
                  <StatItem
                    icon={
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#00C950"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <title>Additions</title>
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    }
                    value={additions.toLocaleString()}
                    label="Additions"
                    className="text-[#00C950]"
                  />
                )}
                {deletions != null && (
                  <StatItem
                    icon={
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#FB2C36"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <title>Deletions</title>
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    }
                    value={deletions.toLocaleString()}
                    label="Deletions"
                    className="text-[#FB2C36]"
                  />
                )}
              </div>
            )}
          </div>,
          {
            width: 1200,
            height: 630,
            format: "webp",
            stylesheets: [stylesheet],
            fonts: [
              {
                name: "Inter",
                data: interFontData,
                style: "normal" as const,
              },
              {
                name: "Space Grotesk",
                data: spaceGroteskFontData,
                style: "normal" as const,
              },
            ],
          },
        );
      },
    },
  },
});
