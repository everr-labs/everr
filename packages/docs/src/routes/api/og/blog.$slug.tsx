import { everrLogoPaths } from "@everr/ui/components/everr-logo-paths";
import instrumentSansFontBase64 from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?inline";
import { ImageResponse } from "@takumi-rs/image-response";
import { createFileRoute } from "@tanstack/react-router";
import { blogPost } from "@/lib/blog";
import { formatBlogDate } from "@/lib/blog-format";
import { cacheShareImage, shareImageHead } from "@/lib/og-cache";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";
import stylesheet from "@/styles/docs.css?inline";

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

// The mark as the site header draws it on the dark theme: a light body, lime eyes and rays
const LIGHT = "#fafafa";
const PRIMARY = "#C4E901";
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 657 657" fill-rule="evenodd"><path fill="${LIGHT}" d="${everrLogoPaths.body}"/><path fill="${LIGHT}" d="${everrLogoPaths.antenna}"/><path fill="${PRIMARY}" d="${everrLogoPaths.rays}"/><path fill="${PRIMARY}" d="${everrLogoPaths.leftEye}${everrLogoPaths.rightEye}"/></svg>`;
const markSrc = `data:image/svg+xml;base64,${btoa(mark)}`;

export const Route = createFileRoute("/api/og/blog/$slug")({
  server: {
    handlers: {
      HEAD: ({ params: { slug } }) =>
        blogPost(slug, getLocale()) ? shareImageHead() : new Response(undefined, { status: 404 }),
      GET: async ({ params: { slug } }) => {
        // A draft has no page: no share image either
        const locale = getLocale();
        const page = blogPost(slug, locale);

        if (!page) {
          return new Response(undefined, { status: 404 });
        }

        const { title, description, date } = page.data;
        const formattedDate = formatBlogDate(date, locale, "long");

        const image = new ImageResponse(
          <div className="flex flex-col w-full h-full px-[72px] py-[60px] bg-[#0a0a0a] text-neutral-50 font-sans">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <img src={markSrc} width={48} height={48} alt="" />
                <div
                  className="font-heading text-[40px] font-semibold"
                  style={{ fontFamily: "Instrument Sans" }}
                >
                  everr
                </div>
              </div>
              <div
                className="font-heading text-base font-semibold uppercase tracking-[0.15em] text-neutral-500"
                style={{ fontFamily: "Instrument Sans" }}
              >
                {m.blog_heading()}
              </div>
            </div>

            <div className="flex flex-col flex-1 justify-center gap-4">
              <div
                className="font-heading text-sm font-bold uppercase tracking-[0.15em] text-neutral-500"
                style={{ fontFamily: "Instrument Sans" }}
              >
                {formattedDate}
              </div>
              <div
                className="font-heading text-5xl font-bold leading-[1.05] tracking-tight max-w-[900px]"
                style={{ fontFamily: "Instrument Sans" }}
              >
                {title}
              </div>
              <div
                className="text-xl leading-relaxed text-neutral-400 max-w-[800px]"
                style={{ fontFamily: "Instrument Sans" }}
              >
                {description}
              </div>
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
        return cacheShareImage(image);
      },
    },
  },
});
