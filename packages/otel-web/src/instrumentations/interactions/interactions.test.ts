import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Emit } from "../../pipeline/emitter.js";
import { startInteractions } from "./interactions.js";

let emitted: Array<{
  name: string;
  attrs?: Record<string, unknown>;
  timestamp?: number;
}>;
let stop: () => void;

const emit: Emit = (name, attrs, timestamp) => {
  emitted.push({ name, attrs, timestamp });
};

function names() {
  return emitted.map((e) => e.name);
}

function click(el: Element, at?: number) {
  const event = new MouseEvent("click", {
    bubbles: true,
    clientX: 15,
    clientY: 25,
  });
  if (at !== undefined) Object.defineProperty(event, "timeStamp", { value: at });
  el.dispatchEvent(event);
}

function clickAttrs() {
  const clickRecord = emitted.find((event) => event.name === "everr.browser.interaction.click");
  return clickRecord?.attrs ?? {};
}

beforeEach(() => {
  emitted = [];
  document.body.innerHTML = "";
  stop = startInteractions(emit);
});

afterEach(() => {
  stop();
});

describe("startInteractions", () => {
  describe("click autocapture (DOM)", () => {
    it("emits a click for every primary DOM click with the element payload", () => {
      document.body.innerHTML = '<a id="cta" href="/signup">Sign up</a>';
      click(document.getElementById("cta") as Element);

      expect(names()).toEqual(["everr.browser.interaction.click"]);
      const a = emitted[0].attrs ?? {};
      expect(a["everr.element.tag"]).toBe("a");
      expect(a["everr.element.selector"]).toBe("#cta");
      // The code reads no content of the DOM. Thus the label of the link is
      // not on the record.
      expect(a).not.toHaveProperty("everr.element.text");
      expect(a["everr.element.href"]).toBe("/signup");
      expect(a).not.toHaveProperty("everr.browser.click.x");
      expect(a).not.toHaveProperty("everr.browser.click.y");
      expect(a["everr.viewport.width"]).toBe(innerWidth);
      // A DOM click has no latency for the interaction. The slow_interaction
      // event gives that value, from Event Timing.
      expect(a).not.toHaveProperty("everr.browser.interaction.duration");
    });

    it("timestamps a click at the DOM action", () => {
      document.body.innerHTML = "<button>Go</button>";
      click(document.querySelector("button") as Element, 123.5);
      expect(emitted[0].timestamp).toBe(Math.round(performance.timeOrigin + 123.5));
    });

    it("clicks carry the full element payload (id, href)", () => {
      document.body.innerHTML =
        '<nav class="top main extra fourth"><a id="docs-link" href="/docs">Read the docs</a></nav>';
      click(document.getElementById("docs-link") as Element);

      const a = clickAttrs();
      expect(a["everr.element.tag"]).toBe("a");
      expect(a["everr.element.selector"]).toBe("#docs-link");
      expect(a["everr.element.href"]).toBe("/docs");
    });

    it("stops at the shortest path that matches one element", () => {
      document.body.innerHTML = "<div><p>one</p><p>two <span>deep</span></p></div>";
      click(document.querySelector("span") as Element);
      expect(clickAttrs()["everr.element.selector"]).toBe("span");
    });

    it("returns the shortest path with the fewest matches when none is unique", () => {
      // Two identical rows: no path tells them apart, and the levels above
      // the rows add no precision. The outside span forces one level: "span"
      // matches 3, "li > span" matches 2, and climbing further stays at 2.
      document.body.innerHTML =
        "<span>out</span><ul><li><span>a</span></li><li><span>b</span></li></ul>";
      click(document.querySelectorAll("span")[2] as Element);
      expect(clickAttrs()["everr.element.selector"]).toBe("li > span");
    });

    it("prefers stable classes and drops unstable ones", () => {
      document.body.innerHTML =
        '<div class="css-x9f2"><p><span class="mx-2">one</span></p>' +
        '<p class="row hint"><span class="mx-2">deep</span></p></div>';
      // css-x9f2 and mx-2 carry digits, so the path drops them; the row and
      // hint classes make the second paragraph the unique step.
      click(document.querySelectorAll("span")[1] as Element);
      expect(clickAttrs()["everr.element.selector"]).toBe("p.row.hint > span");
    });

    it("names an element by its naming attribute before classes or position", () => {
      document.body.innerHTML =
        '<div class="toolbar"><button aria-label="Close" class="mx-2"></button>' +
        "<button>two</button></div>";
      click(document.querySelector("button") as Element);
      expect(clickAttrs()["everr.element.selector"]).toBe('button[aria-label="Close"]');
    });

    it("skips a generated or non-identifier id as an anchor", () => {
      // A React useId ("_r_p_", "base-ui-_r_1g_") changes on every render,
      // so it cannot anchor a selector. The same stability rule as the
      // classes rejects it, and the walk continues with the tag step.
      document.body.innerHTML =
        '<button id="x1">a</button>' + '<div id="_r_p_"><button aria-label="Go">b</button></div>';
      click(document.querySelectorAll("button")[1] as Element);
      expect(clickAttrs()["everr.element.selector"]).toBe('button[aria-label="Go"]');
    });

    it("skips clicks on password and hidden inputs", () => {
      document.body.innerHTML = '<input type="password">';
      click(document.querySelector("input") as Element);
      expect(emitted).toHaveLength(0);
    });

    it("skips clicks under everr-no-capture", () => {
      document.body.innerHTML =
        '<div class="everr-no-capture"><button id="b">Hidden</button></div>';
      click(document.getElementById("b") as Element);
      expect(emitted).toHaveLength(0);
    });

    it("does not capture textarea content as text, even via a wrapper's subtree", () => {
      document.body.innerHTML = '<div id="wrap"><textarea>prefilled secret</textarea></div>';
      click(document.getElementById("wrap") as Element);
      expect(names()).toEqual(["everr.browser.interaction.click"]);
      expect(JSON.stringify(emitted[0].attrs)).not.toContain("prefilled secret");
    });

    it("puts no content of the DOM on the record", () => {
      // A card number in the text of an element cannot go out, because the
      // code never reads that text.
      document.body.innerHTML = "<button>4242 4242 4242 4242</button>";
      click(document.querySelector("button") as Element);
      const a = emitted[0].attrs ?? {};
      expect(a).not.toHaveProperty("everr.element.text");
      expect(JSON.stringify(a)).not.toContain("4242");
    });

    it("stops capturing after cleanup", () => {
      document.body.innerHTML = "<button>after</button>";
      stop();
      click(document.querySelector("button") as Element);
      expect(emitted).toHaveLength(0);
      stop = () => {};
    });
  });

  describe("submit autocapture", () => {
    it("targets the submitter button and carries its element payload", () => {
      document.body.innerHTML =
        '<form id="f"><button type="submit" id="go">Sign up</button></form>';
      const form = document.getElementById("f") as HTMLFormElement;
      const button = document.getElementById("go") as HTMLButtonElement;
      const ev = new Event("submit", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "submitter", { value: button });
      form.dispatchEvent(ev);

      expect(names()).toEqual(["everr.browser.interaction.submit"]);
      const a = emitted[0].attrs ?? {};
      expect(a["everr.element.tag"]).toBe("button");
      expect(a["everr.element.selector"]).toBe("#go");
    });

    it("skips submits with no submitter (e.g. form.requestSubmit())", () => {
      document.body.innerHTML = '<form id="f"><input></form>';
      document.getElementById("f")?.dispatchEvent(new Event("submit", { bubbles: true }));
      expect(emitted).toHaveLength(0);
    });

    it("skips submit when the submitter is under everr-no-capture", () => {
      document.body.innerHTML =
        '<div class="everr-no-capture"><form><button id="x" type="submit">x</button></form></div>';
      const form = document.querySelector("form") as HTMLFormElement;
      const button = document.getElementById("x") as HTMLButtonElement;
      const ev = new Event("submit", { bubbles: true });
      Object.defineProperty(ev, "submitter", { value: button });
      form.dispatchEvent(ev);
      expect(emitted).toHaveLength(0);
    });

    it("stops capturing submit after cleanup", () => {
      document.body.innerHTML = '<button id="b" type="submit">';
      stop();
      const ev = new Event("submit", { bubbles: true });
      Object.defineProperty(ev, "submitter", {
        value: document.getElementById("b"),
      });
      document.dispatchEvent(ev);
      expect(emitted).toHaveLength(0);
      stop = () => {};
    });
  });
});
