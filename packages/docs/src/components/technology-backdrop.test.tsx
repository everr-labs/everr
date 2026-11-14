import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  TECHNOLOGY_SPRITE_PATH,
  TechnologyBackdrop,
  TechnologySprite,
} from "./technology-backdrop";

describe("technology backdrop", () => {
  it("draws every icon from a symbol in the sprite", () => {
    const backdrop = renderToStaticMarkup(<TechnologyBackdrop />);
    const sprite = renderToStaticMarkup(<TechnologySprite />);
    const symbols = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]));
    const uses = [...backdrop.matchAll(/<use href="([^"#]+)#([^"]+)"/g)];

    expect(uses.length).toBeGreaterThan(0);
    for (const [, path, id] of uses) {
      expect(path).toBe(TECHNOLOGY_SPRITE_PATH);
      expect(symbols).toContain(id);
    }
  });

  it("keeps the icon drawings out of the page", () => {
    const backdrop = renderToStaticMarkup(<TechnologyBackdrop />);

    expect(backdrop).not.toContain("<path");
  });
});
