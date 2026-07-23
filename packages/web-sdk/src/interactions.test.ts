import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Emit } from "./emitter.js";
import { startInteractions } from "./interactions.js";

let emitted: Array<{ name: string; attrs?: Record<string, unknown> }>;
let stop: () => void;

const emit: Emit = (name, attrs) => {
  emitted.push({ name, attrs });
};

function names() {
  return emitted.map((e) => e.name);
}

function click(el: Element, x = 10, y = 20) {
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
  );
}

beforeEach(() => {
  emitted = [];
  document.body.innerHTML = "";
  stop = startInteractions(emit);
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("startInteractions", () => {
  it("captures clicks with the full element payload", () => {
    document.body.innerHTML =
      '<nav class="top main extra fourth"><a id="docs-link" href="/docs">Read the docs</a></nav>';
    const link = document.getElementById("docs-link") as Element;
    click(link, 15, 25);

    expect(names()).toEqual(["browser.click"]);
    const attrs = emitted[0].attrs ?? {};
    expect(attrs["everr.element.tag"]).toBe("a");
    expect(attrs["everr.element.text"]).toBe("Read the docs");
    expect(attrs["everr.element.selector"]).toBe("#docs-link");
    expect(attrs["everr.element.href"]).toBe("/docs");
    expect(String(attrs["everr.element.chain"])).toBe(
      "a;nav.top.main.extra;body",
    );
    expect(attrs["everr.click.x"]).toBe(15);
    expect(attrs["everr.click.y"]).toBe(25);
    expect(attrs["everr.viewport.width"]).toBe(innerWidth);
    expect(attrs["everr.viewport.height"]).toBe(innerHeight);
  });

  it("builds positional selectors when no id anchors the path", () => {
    document.body.innerHTML =
      "<div><p>one</p><p>two <span>deep</span></p></div>";
    const span = document.querySelector("span") as Element;
    click(span);
    expect(emitted[0].attrs?.["everr.element.selector"]).toBe(
      "body > div > p:nth-of-type(2) > span",
    );
  });

  it("captures change and submit without ever reading values", () => {
    document.body.innerHTML =
      '<form><input type="text" value="secret text"><button>Go</button></form>';
    const input = document.querySelector("input") as HTMLInputElement;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    (document.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true }),
    );

    expect(names()).toEqual(["browser.change", "browser.submit"]);
    for (const { attrs } of emitted) {
      expect(JSON.stringify(attrs)).not.toContain("secret text");
    }
  });

  it("emits nothing for password and hidden inputs", () => {
    document.body.innerHTML =
      '<input type="password"><input type="hidden" id="h">';
    const password = document.querySelector("input") as HTMLInputElement;
    password.dispatchEvent(new Event("change", { bubbles: true }));
    click(password);
    (document.getElementById("h") as HTMLInputElement).dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    expect(emitted).toHaveLength(0);
  });

  it("emits nothing under everr-no-capture", () => {
    document.body.innerHTML =
      '<div class="everr-no-capture"><button id="b">Hidden</button></div>';
    click(document.getElementById("b") as Element);
    expect(emitted).toHaveLength(0);
  });

  it("never captures textarea content as text, even via a wrapper's subtree", () => {
    document.body.innerHTML =
      '<div id="wrap"><textarea>prefilled secret</textarea></div>';
    const textarea = document.querySelector("textarea") as HTMLElement;
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    click(document.getElementById("wrap") as Element);
    expect(names()).toEqual(["browser.change", "browser.click"]);
    for (const { attrs } of emitted) {
      expect(JSON.stringify(attrs)).not.toContain("prefilled secret");
    }
  });

  it("drops a card number even when the cap would truncate it", () => {
    document.body.innerHTML = `<p>${"a".repeat(250)} 4242 4242 4242 4242</p>`;
    click(document.querySelector("p") as Element);
    expect(emitted[0].attrs?.["everr.element.text"]).toBeUndefined();
  });

  it("drops text that looks like a card number or SSN", () => {
    document.body.innerHTML =
      "<button>4242 4242 4242 4242</button><p>123-45-6789</p>";
    click(document.querySelector("button") as Element);
    click(document.querySelector("p") as Element);
    expect(names()).toContain("browser.click");
    for (const { attrs } of emitted) {
      expect(attrs?.["everr.element.text"]).toBeUndefined();
    }
  });

  it("detects rage clicks: three clicks within the radius and gap", () => {
    document.body.innerHTML = "<button>broken</button>";
    const button = document.querySelector("button") as Element;
    click(button, 10, 10);
    click(button, 15, 12);
    click(button, 12, 14);
    expect(names().filter((n) => n === "browser.rage_click")).toHaveLength(1);
    // A fourth click starts a fresh window instead of re-firing.
    click(button, 11, 11);
    expect(names().filter((n) => n === "browser.rage_click")).toHaveLength(1);
  });

  it("does not rage on spread-out clicks", () => {
    document.body.innerHTML = "<button>fine</button>";
    const button = document.querySelector("button") as Element;
    click(button, 0, 0);
    click(button, 200, 200);
    click(button, 400, 400);
    expect(names()).not.toContain("browser.rage_click");
  });

  it("detects a dead click on inert content", () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<div><p>just text</p></div>";
    click(document.querySelector("p") as Element);
    vi.advanceTimersByTime(3_100);
    expect(names()).toContain("browser.dead_click");
  });

  it("does not report dead clicks on interactive elements or reactive pages", () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>live</button><p>inert</p>";
    click(document.querySelector("button") as Element);
    vi.advanceTimersByTime(3_100);
    expect(names()).not.toContain("browser.dead_click");

    // A click the page reacts to (DOM mutation) is not dead. The observer
    // delivers mutations async; flush them via a microtask before the timer.
    click(document.querySelector("p") as Element);
    document.body.appendChild(document.createElement("span"));
    return Promise.resolve().then(() => {
      vi.advanceTimersByTime(3_100);
      expect(names()).not.toContain("browser.dead_click");
    });
  });

  it("stops capturing after cleanup", () => {
    document.body.innerHTML = "<button>after</button>";
    stop();
    click(document.querySelector("button") as Element);
    expect(emitted).toHaveLength(0);
    stop = () => {};
  });
});
