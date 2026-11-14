import { beforeEach, describe, expect, it } from "vite-plus/test";
import { selectorOf } from "./element.js";

describe("selectorOf", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it.each(["path\\to\\thing", "first\nsecond"])("escapes %j in a naming attribute", (label) => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", label);
    document.body.append(button, document.createElement("button"));

    const sel = selectorOf(button);

    expect(sel).toBe(`button[aria-label="${CSS.escape(label)}"]`);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(button);
  });

  it("keeps a plain naming attribute readable", () => {
    document.body.innerHTML = '<div><button aria-label="Close"></button><button></button></div>';
    expect(selectorOf(document.querySelector("button") as Element)).toBe(
      'button[aria-label="Close"]',
    );
  });
});
