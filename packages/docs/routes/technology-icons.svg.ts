import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TechnologySprite } from "../src/components/technology-backdrop";

const sprite = `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(createElement(TechnologySprite))}`;

export default function handler() {
  return new Response(sprite, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=3600",
    },
  });
}
