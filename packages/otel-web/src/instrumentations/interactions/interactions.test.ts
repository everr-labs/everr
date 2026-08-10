import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Emit } from "../../emitter.js";
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

/** Three clicks within the rage radius and gap. */
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
      expect(a["everr.element.text"]).toBe("Sign up");
      expect(a["everr.element.selector"]).toBe("#cta");
      expect(a["everr.element.href"]).toBe("/signup");
      expect(a["everr.browser.click.x"]).toBe(15);
      expect(a["everr.browser.click.y"]).toBe(25);
      expect(a["everr.viewport.width"]).toBe(innerWidth);
      // DOM clicks carry no interaction latency: that is the slow_interaction
      // event's job (Event Timing).
      expect(a).not.toHaveProperty("everr.browser.interaction.duration");
    });

    it("a rage burst emits click, click, then rage_click on the third", () => {
      document.body.innerHTML = "<button>broken</button>";
      const button = document.querySelector("button") as Element;
      rageBurst(button);

      expect(names()).toEqual([
        "everr.browser.interaction.click",
        "everr.browser.interaction.click",
        "everr.browser.interaction.rage_click",
      ]);
      const rage = emitted[2].attrs ?? {};
      expect(rage["everr.browser.click.x"]).toBe(15);
      expect(rage["everr.browser.click.y"]).toBe(24);
      expect(rage["everr.element.tag"]).toBe("button");
    });

    it("fires rage once per burst; a fourth click starts a fresh window", () => {
      document.body.innerHTML = "<button>broken</button>";
      const button = document.querySelector("button") as Element;
      rageBurst(button);
      click(button, 11, 11);

      expect(
        names().filter((n) => n === "everr.browser.interaction.rage_click"),
      ).toHaveLength(1);
      // The fourth click is a fresh window: a plain click, not another rage.
      expect(names()[3]).toBe("everr.browser.interaction.click");
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
      expect(
        names().filter((n) => n === "everr.browser.interaction.rage_click"),
      ).toHaveLength(0);
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
      expect(a["everr.element.text"]).toBe("Read the docs");
      expect(a["everr.element.selector"]).toBe("#docs-link");
      expect(a["everr.element.href"]).toBe("/docs");
      expect(a["everr.browser.click.x"]).toBe(20);
      expect(a["everr.browser.click.y"]).toBe(29);
    });

    it("builds positional selectors when no id anchors the path", () => {
      document.body.innerHTML =
        "<div><p>one</p><p>two <span>deep</span></p></div>";
      rageBurst(document.querySelector("span") as Element);
      const rage = emitted.find(
        (e) => e.name === "everr.browser.interaction.rage_click",
      );
      expect(rage?.attrs?.["everr.element.selector"]).toBe(
        "body > div > p:nth-of-type(2) > span",
      );
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

    it("drops a card number even when the cap would truncate it", () => {
      document.body.innerHTML = `<p>${"a".repeat(250)} 4242 4242 4242 4242</p>`;
      click(document.querySelector("p") as Element);
      expect(emitted[0].attrs?.["everr.element.text"]).toBeUndefined();
    });

    it("drops text that looks like a card number or SSN", () => {
      document.body.innerHTML = "<button>4242 4242 4242 4242</button>";
      click(document.querySelector("button") as Element);
      expect(emitted[0].attrs?.["everr.element.text"]).toBeUndefined();
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
      // Fields have no visible text label of their own; textOf skips them.
      // (The raw attrs object carries the key with an undefined value; the
      // emitter filters nullish at send time, see init.test.ts.)
      expect(a["everr.element.text"]).toBeUndefined();
      expect(a).not.toHaveProperty("everr.browser.click.x");
      // Values are never read: there is no attr for them by construction.
      expect(JSON.stringify(a)).not.toContain("@example");
    });

    it("restricts change to form fields (skips contenteditable divs)", () => {
      document.body.innerHTML =
        '<div id="ce" contenteditable>text</div>' +
        '<select id="s"><option>a</option></select>';
      document
        .getElementById("ce")
        ?.dispatchEvent(new Event("change", { bubbles: true }));
      expect(emitted).toHaveLength(0);
      document
        .getElementById("s")
        ?.dispatchEvent(new Event("change", { bubbles: true }));
      expect(names()).toEqual(["everr.browser.interaction.change"]);
      expect(emitted[0].attrs?.["everr.element.tag"]).toBe("select");
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
      // The submitter is a non-field button: its visible label is captured,
      // never a form value.
      expect(a["everr.element.text"]).toBe("Sign up");
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
  const rageClicks = () =>
    emitted.filter((e) => e.name === "everr.browser.interaction.rage_click");

  it("counts a click gap of exactly one second toward the burst", () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Go</button>";
    const button = document.querySelector("button") as Element;
    click(button);
    vi.advanceTimersByTime(1_000);
    click(button);
    vi.advanceTimersByTime(1_000);
    click(button);
    expect(rageClicks()).toHaveLength(1);
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
    expect(rageClicks()).toHaveLength(0);
  });

  it("counts a click exactly 30px away toward the burst, 31px resets it", () => {
    document.body.innerHTML = "<button>Go</button>";
    const button = document.querySelector("button") as Element;
    click(button, 0, 0);
    click(button, 30, 0);
    click(button, 30, 0);
    expect(rageClicks()).toHaveLength(1);

    emitted = [];
    click(button, 100, 0);
    click(button, 131, 0);
    click(button, 131, 0);
    expect(rageClicks()).toHaveLength(0);
  });
});

describe("sensitive text redaction", () => {
  const textOfClick = (label: string) => {
    document.body.innerHTML = "<button>x</button>";
    const button = document.querySelector("button") as Element;
    button.textContent = label;
    emitted = [];
    click(button);
    return emitted[0]?.attrs?.["everr.element.text"];
  };

  it("redacts credit-card and SSN shaped text, keeping near misses", () => {
    expect(textOfClick("Card: 4111 1111 1111 1111")).toBeUndefined();
    expect(textOfClick("4111-1111-1111-1111")).toBeUndefined();
    expect(textOfClick("SSN 123-45-6789")).toBeUndefined();
    // Near misses stay: too few digits, wrong group widths.
    expect(textOfClick("Order 4111 1111 111")).toBe("Order 4111 1111 111");
    expect(textOfClick("Ref 123-4-6789")).toBe("Ref 123-4-6789");
    expect(textOfClick("Ref 123-45-678")).toBe("Ref 123-45-678");
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
