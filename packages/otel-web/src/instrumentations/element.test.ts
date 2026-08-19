import { beforeEach, describe, expect, it } from "vitest";
import { selectorOf } from "./element.js";

describe("selectorOf", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("escapes a backslash in a naming attribute", () => {
    const label = "path\\to\\thing";
    document.body.innerHTML = `<div><button aria-label="${label}"></button><button></button></div>`;
    const el = document.querySelector("button") as Element;

    const sel = selectorOf(el);

    expect(sel).toBe(`button[aria-label="${CSS.escape(label)}"]`);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
  });

  it("escapes a line break in a naming attribute", () => {
    const label = "first\nsecond";
    const button = document.createElement("button");
    button.setAttribute("aria-label", label);
    document.body.append(button, document.createElement("button"));

    const sel = selectorOf(button);

    expect(sel).toBe(`button[aria-label="${CSS.escape(label)}"]`);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(button);
  });

  it("keeps a plain naming attribute readable", () => {
    document.body.innerHTML =
      '<div><button aria-label="Close"></button><button></button></div>';
    expect(selectorOf(document.querySelector("button") as Element)).toBe(
      'button[aria-label="Close"]',
    );
  });
});
