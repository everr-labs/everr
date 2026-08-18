import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Emit } from "../../pipeline/emitter.js";
import { startInteractions } from "./interactions.js";

let emitted: Array<{ name: string; attrs?: Record<string, unknown> }>;
let stop: () => void;

const emit: Emit = (name, attrs) => {
  emitted.push({ name, attrs });
};

function names() {
  return emitted.map((e) => e.name);
}

/** The number of records that have this event name. */
function countOf(name: string) {
  return emitted.filter((e) => e.name === name).length;
}

const rageClicks = () => countOf("everr.browser.interaction.rage_click");
const clicks = () => countOf("everr.browser.interaction.click");

function click(el: Element, x = 10, y = 20) {
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
  );
}

/** Three clicks in the area and in the interval for a rage click. */
function rageBurst(el: Element, x = 10, y = 20) {
  click(el, x, y);
  click(el, x + 3, y + 2);
  click(el, x + 5, y + 4);
}

beforeEach(() => {
  emitted = [];
  document.body.innerHTML = "";
  stop = startInteractions(emit);
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startInteractions", () => {
  describe("click autocapture (DOM)", () => {
    it("emits a click for every primary DOM click with coords and the element payload", () => {
      document.body.innerHTML = '<a id="cta" href="/signup">Sign up</a>';
      click(document.getElementById("cta") as Element, 15, 25);

      expect(names()).toEqual(["everr.browser.interaction.click"]);
      const a = emitted[0].attrs ?? {};
      expect(a["everr.element.tag"]).toBe("a");
      expect(a["everr.element.selector"]).toBe("#cta");
      // The code reads no content of the DOM. Thus the label of the link is
      // not on the record.
      expect(a).not.toHaveProperty("everr.element.text");
      expect(a["everr.element.href"]).toBe("/signup");
      expect(a["everr.browser.click.x"]).toBe(15);
      expect(a["everr.browser.click.y"]).toBe(25);
      expect(a["everr.viewport.width"]).toBe(innerWidth);
      // A DOM click has no latency for the interaction. The slow_interaction
      // event gives that value, from Event Timing.
      expect(a).not.toHaveProperty("everr.browser.interaction.duration");
    });

    it("a rage burst adds a rage_click, and it keeps the click of that third click", () => {
      document.body.innerHTML = "<button>broken</button>";
      const button = document.querySelector("button") as Element;
      rageBurst(button);

      // The rage record does not replace the click record. Thus a count of the
      // clicks on the button is correct, and it is 3.
      expect(names()).toEqual([
        "everr.browser.interaction.click",
        "everr.browser.interaction.click",
        "everr.browser.interaction.rage_click",
        "everr.browser.interaction.click",
      ]);
      const rage = emitted[2].attrs ?? {};
      expect(rage["everr.browser.click.x"]).toBe(15);
      expect(rage["everr.browser.click.y"]).toBe(24);
      expect(rage["everr.element.tag"]).toBe("button");
      // The two records of the third click carry the same data.
      expect(emitted[3].attrs).toEqual(rage);
    });

    it("makes one rage_click for one continuous burst, whatever its length", () => {
      document.body.innerHTML = "<button>broken</button>";
      const button = document.querySelector("button") as Element;
      // Ten clicks in the area and in the interval. This is one condition of
      // frustration and thus it makes one record. The count continues above 3
      // and it agrees with 3 no more.
      for (let i = 0; i < 10; i++) click(button, 10 + (i % 3), 20);

      expect(rageClicks()).toBe(1);
      expect(clicks()).toBe(10);
    });

    it("rages again when a late click starts a second window", () => {
      // The window is not removed after the record. Thus a second rage click
      // needs a new window, and only a click that is late or far makes one.
      vi.useFakeTimers();
      document.body.innerHTML = "<button>broken</button>";
      const button = document.querySelector("button") as Element;
      rageBurst(button);
      vi.advanceTimersByTime(1_001);
      rageBurst(button);

      expect(rageClicks()).toBe(2);
    });

    // Three fast clicks on a surface where the user edits text select a word
    // or select a line. This is the usual operation of the browser and it is
    // not frustration. Each case is its own test: beforeEach makes a new
    // instrumentation, and thus the window of the case before it cannot
    // continue into this one.
    const EDIT_SURFACES = `<textarea id="t"></textarea><input id="i" type="text">
      <div id="ce" contenteditable><span id="inner">text</span></div>
      <div id="ro" contenteditable="false">read only</div>`;

    it.each([
      ["a textarea", "t"],
      ["a text input", "i"],
      ["an element in a contenteditable region", "inner"],
    ])("makes no rage_click on %s", (_label, id) => {
      document.body.innerHTML = EDIT_SURFACES;
      rageBurst(document.getElementById(id) as Element);
      expect(rageClicks()).toBe(0);
      // The clicks are still on the record.
      expect(clicks()).toBe(3);
    });

    it("rages on contenteditable=false, which is not such a surface", () => {
      document.body.innerHTML = EDIT_SURFACES;
      rageBurst(document.getElementById("ro") as Element);
      expect(rageClicks()).toBe(1);
    });

    it("does not rage on spread-out clicks", () => {
      document.body.innerHTML = "<button>fine</button>";
      const button = document.querySelector("button") as Element;
      click(button, 0, 0);
      click(button, 200, 200);
      click(button, 400, 400);

      expect(names()).toEqual([
        "everr.browser.interaction.click",
        "everr.browser.interaction.click",
        "everr.browser.interaction.click",
      ]);
      expect(rageClicks()).toBe(0);
    });

    it("rage clicks carry the full element payload (id, href)", () => {
      document.body.innerHTML =
        '<nav class="top main extra fourth"><a id="docs-link" href="/docs">Read the docs</a></nav>';
      rageBurst(document.getElementById("docs-link") as Element, 15, 25);

      const rage = emitted.find(
        (e) => e.name === "everr.browser.interaction.rage_click",
      );
      const a = rage?.attrs ?? {};
      expect(a["everr.element.tag"]).toBe("a");
      expect(a["everr.element.selector"]).toBe("#docs-link");
      expect(a["everr.element.href"]).toBe("/docs");
      expect(a["everr.browser.click.x"]).toBe(20);
      expect(a["everr.browser.click.y"]).toBe(29);
    });

    it("stops at the shortest path that matches one element", () => {
      document.body.innerHTML =
        "<div><p>one</p><p>two <span>deep</span></p></div>";
      rageBurst(document.querySelector("span") as Element);
      const rage = emitted.find(
        (e) => e.name === "everr.browser.interaction.rage_click",
      );
      expect(rage?.attrs?.["everr.element.selector"]).toBe("span");
    });

    it("returns the shortest path with the fewest matches when none is unique", () => {
      // Two identical rows: no path tells them apart, and the levels above
      // the rows add no precision. The outside span forces one level: "span"
      // matches 3, "li > span" matches 2, and climbing further stays at 2.
      document.body.innerHTML =
        "<span>out</span><ul><li><span>a</span></li><li><span>b</span></li></ul>";
      rageBurst(document.querySelectorAll("span")[2] as Element);
      const rage = emitted.find(
        (e) => e.name === "everr.browser.interaction.rage_click",
      );
      expect(rage?.attrs?.["everr.element.selector"]).toBe("li > span");
    });

    it("prefers stable classes and drops unstable ones", () => {
      document.body.innerHTML =
        '<div class="css-x9f2"><p><span class="mx-2">one</span></p>' +
        '<p class="row hint"><span class="mx-2">deep</span></p></div>';
      // css-x9f2 and mx-2 carry digits, so the path drops them; the row and
      // hint classes make the second paragraph the unique step.
      rageBurst(document.querySelectorAll("span")[1] as Element);
      const rage = emitted.find(
        (e) => e.name === "everr.browser.interaction.rage_click",
      );
      expect(rage?.attrs?.["everr.element.selector"]).toBe("p.row.hint > span");
    });

    it("names an element by its naming attribute before classes or position", () => {
      document.body.innerHTML =
        '<div class="toolbar"><button aria-label="Close" class="mx-2"></button>' +
        "<button>two</button></div>";
      rageBurst(document.querySelector("button") as Element);
      const rage = emitted.find(
        (e) => e.name === "everr.browser.interaction.rage_click",
      );
      expect(rage?.attrs?.["everr.element.selector"]).toBe(
        'button[aria-label="Close"]',
      );
    });

    it("escapes an id that is not a plain identifier", () => {
      document.body.innerHTML =
        '<div><span>x</span></div><div id="user:42"><span>y</span></div>';
      rageBurst(document.querySelectorAll("span")[1] as Element);
      const rage = emitted.find(
        (e) => e.name === "everr.browser.interaction.rage_click",
      );
      expect(rage?.attrs?.["everr.element.selector"]).toBe("#user\\:42 > span");
    });

    it("skips clicks on password and hidden inputs", () => {
      document.body.innerHTML = '<input type="password">';
      click(document.querySelector("input") as Element);
      expect(emitted).toHaveLength(0);
    });

    it("skips clicks under everr-no-capture", () => {
      document.body.innerHTML =
        '<div class="everr-no-capture"><button id="b">Hidden</button></div>';
      rageBurst(document.getElementById("b") as Element);
      expect(emitted).toHaveLength(0);
    });

    it("does not capture textarea content as text, even via a wrapper's subtree", () => {
      document.body.innerHTML =
        '<div id="wrap"><textarea>prefilled secret</textarea></div>';
      click(document.getElementById("wrap") as Element);
      expect(names()).toEqual(["everr.browser.interaction.click"]);
      expect(JSON.stringify(emitted[0].attrs)).not.toContain(
        "prefilled secret",
      );
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

  describe("change autocapture", () => {
    it("emits a change for a form-field change, identity payload, no coords, no value", () => {
      document.body.innerHTML =
        '<form><input type="email" id="email" name="email"></form>';
      const input = document.getElementById("email") as HTMLInputElement;
      input.dispatchEvent(new Event("change", { bubbles: true }));

      expect(names()).toEqual(["everr.browser.interaction.change"]);
      const a = emitted[0].attrs ?? {};
      expect(a["everr.element.tag"]).toBe("input");
      expect(a["everr.element.selector"]).toBe("#email");
      expect(a).not.toHaveProperty("everr.browser.click.x");
      // The code never reads a value. Thus there is no attribute for a value.
      expect(JSON.stringify(a)).not.toContain("@example");
    });

    it("captures a change from any element, not only a form field", () => {
      // A `change` event goes up the tree. The code applies no test on the type
      // of the element, and thus a div with contenteditable and a select both
      // make a record. The record carries the tag and the selector only.
      document.body.innerHTML =
        '<div id="ce" contenteditable>text</div>' +
        '<select id="s"><option>a</option></select>';
      document
        .getElementById("ce")
        ?.dispatchEvent(new Event("change", { bubbles: true }));
      document
        .getElementById("s")
        ?.dispatchEvent(new Event("change", { bubbles: true }));
      expect(names()).toEqual([
        "everr.browser.interaction.change",
        "everr.browser.interaction.change",
      ]);
      expect(emitted[0].attrs?.["everr.element.tag"]).toBe("div");
      expect(emitted[1].attrs?.["everr.element.tag"]).toBe("select");
    });

    it("skips change on password, hidden inputs, and everr-no-capture", () => {
      document.body.innerHTML =
        '<input type="password" id="pw">' +
        '<input type="hidden" id="h">' +
        '<div class="everr-no-capture"><input type="text" id="nc"></div>' +
        '<input type="text" id="ok">';
      for (const id of ["pw", "h", "nc", "ok"])
        document
          .getElementById(id)
          ?.dispatchEvent(new Event("change", { bubbles: true }));
      expect(names()).toEqual(["everr.browser.interaction.change"]);
      expect(emitted[0].attrs?.["everr.element.selector"]).toBe("#ok");
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
      expect(a).not.toHaveProperty("everr.browser.click.x");
    });

    it("skips submits with no submitter (e.g. form.requestSubmit())", () => {
      document.body.innerHTML = '<form id="f"><input></form>';
      document
        .getElementById("f")
        ?.dispatchEvent(new Event("submit", { bubbles: true }));
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

    it("stops capturing change and submit after cleanup", () => {
      document.body.innerHTML = '<input id="i"><button id="b" type="submit">';
      stop();
      document
        .getElementById("i")
        ?.dispatchEvent(new Event("change", { bubbles: true }));
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

describe("threshold boundaries", () => {
  it("counts a click gap of exactly one second toward the burst", () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Go</button>";
    const button = document.querySelector("button") as Element;
    click(button);
    vi.advanceTimersByTime(1_000);
    click(button);
    vi.advanceTimersByTime(1_000);
    click(button);
    expect(rageClicks()).toBe(1);
  });

  it("resets the burst when a gap exceeds one second by any amount", () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Go</button>";
    const button = document.querySelector("button") as Element;
    click(button);
    vi.advanceTimersByTime(1_001);
    click(button);
    vi.advanceTimersByTime(1_000);
    click(button);
    expect(rageClicks()).toBe(0);
  });

  it("counts a click exactly 30px away toward the burst, 31px resets it", () => {
    document.body.innerHTML = "<button>Go</button>";
    const button = document.querySelector("button") as Element;
    click(button, 0, 0);
    click(button, 30, 0);
    click(button, 30, 0);
    expect(rageClicks()).toBe(1);

    emitted = [];
    click(button, 100, 0);
    click(button, 131, 0);
    click(button, 131, 0);
    expect(rageClicks()).toBe(0);
  });
});

describe("click coordinates", () => {
  it("adds the scroll offset to the viewport coordinates", () => {
    vi.stubGlobal("scrollX", 100);
    vi.stubGlobal("scrollY", 200);
    document.body.innerHTML = "<button>Go</button>";
    click(document.querySelector("button") as Element, 15, 25);
    const a = emitted[0].attrs ?? {};
    expect(a["everr.browser.click.x"]).toBe(115);
    expect(a["everr.browser.click.y"]).toBe(225);
  });
});
