import { afterEach, describe, expect, it } from "vite-plus/test";
import type { RecordingOptions } from "./recording.js";
import { mutations, start, type Started } from "./recording/test-kit.js";

const running: Started[] = [];

afterEach(async () => {
  for (const t of running.splice(0)) await t.client.shutdown();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** Records `html`, runs `act`, and returns the Clip as one JSON string. */
async function recordPage(
  html: string,
  options: RecordingOptions = {},
  act: () => void | Promise<void> = () => {},
  dev = false,
) {
  document.body.innerHTML = html;
  const t = await start(options, { sdkOptions: { dev } });
  running.push(t);
  await act();
  await mutations();
  const clip = t.rec.recorder.startClip();
  clip.end();
  return JSON.stringify(t.clipEvents(clip.id));
}

const type = (el: Element | null, value: string) => {
  (el as HTMLInputElement).value = value;
  el?.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("the default bundle", () => {
  const page = `
    <p>visible text</p>
    <input id="text" value="typed name">
    <input id="email" type="email" value="me@example.com">
    <textarea id="area">long note</textarea>
    <select id="select"><option value="opt-one">first</option><option value="opt-two" selected>second</option></select>
    <button title="title-secret" aria-label="label-secret">go</button>
    <input placeholder="placeholder-secret">
    <img src="/avatar.png">
    <svg><circle r="4"></circle></svg>
    <video src="/clip.mp4"></video>
    <iframe srcdoc="<p>srcdoc-secret</p>"></iframe>
    <input id="file" type="file">
    <input id="password" type="password" value="hunter2">`;

  it.each([false, true])("masks and blocks the same with dev %s", async (dev) => {
    const json = await recordPage(
      page,
      {},
      () => {
        type(document.getElementById("text"), "typed later");
        type(document.getElementById("password"), "hunter3");
      },
      dev,
    );
    for (const secret of [
      "visible text",
      "typed name",
      "typed later",
      "me@example.com",
      "long note",
      "opt-two",
      "title-secret",
      "label-secret",
      "placeholder-secret",
      "srcdoc-secret",
      "hunter2",
      "hunter3",
      "avatar.png",
      "clip.mp4",
      "circle",
    ])
      expect(json, secret).not.toContain(secret);
    // A Block keeps the element as a placeholder of the same size.
    expect(json).toContain('"tagName":"img","attributes":{"rr_width"');
    expect(json).toContain('"tagName":"button"');
  });

  it("is the same with dev on and off", async () => {
    const off = await recordPage(page, {}, () => {}, false);
    document.body.innerHTML = "";
    const on = await recordPage(page, {}, () => {}, true);
    const shape = (json: string) => json.replace(/"timestamp":\d+/g, "").replace(/"id":\d+/g, "");
    expect(shape(on)).toBe(shape(off));
  });

  it("blocks icon links and base", async () => {
    document.head.innerHTML = `<base href="https://base.example/"><link rel="shortcut icon" href="/favicon-secret.ico">`;
    const json = await recordPage("<p>x</p>");
    expect(json).not.toContain("base.example");
    expect(json).not.toContain("favicon-secret");
  });

  it("ignores file inputs and drops their value", async () => {
    const json = await recordPage(`<input id="file" type="file">`, { unmask: ["*"] }, () => {
      document.getElementById("file")!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(json).not.toContain('"source":5');
    expect(json).not.toMatch(/"type":"file","value"/);
  });
});

describe("values that rrweb 2.1.7 leaves in the clear", () => {
  it("masks hidden, checkbox, radio, button, and option values", async () => {
    const json = await recordPage(
      `<input type="hidden" name="csrf" value="hidden-secret">
       <input id="check" type="checkbox" value="check-secret">
       <input type="radio" value="radio-secret">
       <button value="button-secret">b</button>
       <select><option value="option-secret">o</option></select>`,
      {},
      () => {
        const check = document.getElementById("check") as HTMLInputElement;
        check.checked = true;
        check.dispatchEvent(new Event("change", { bubbles: true }));
      },
    );
    for (const secret of [
      "hidden-secret",
      "check-secret",
      "radio-secret",
      "button-secret",
      "option-secret",
    ])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain('"isChecked":true');
  });

  it("masks a value attribute that a script changes later", async () => {
    const json = await recordPage(
      `<input id="h" type="hidden"><select><option id="o">o</option></select>`,
      {},
      () => {
        document.getElementById("h")!.setAttribute("value", "late-hidden-secret");
        document.getElementById("o")!.setAttribute("value", "late-option-secret");
      },
    );
    expect(json).not.toContain("late-hidden-secret");
    expect(json).not.toContain("late-option-secret");
  });

  it("masks the HTML value of a text input that the user cleared", async () => {
    document.body.innerHTML = `<input id="t" value="prefilled-secret">`;
    (document.getElementById("t") as HTMLInputElement).value = "";
    const t = await start();
    running.push(t);
    t.rec.recorder.emitClip();
    expect(JSON.stringify(t.segments())).not.toContain("prefilled-secret");
  });

  it("masks meta content and data-* attributes", async () => {
    document.head.innerHTML = `<meta name="csrf-token" content="meta-secret">`;
    const json = await recordPage(`<div data-user-email="data-secret">x</div>`, {}, () => {
      document.querySelector("div")!.setAttribute("data-token", "late-data-secret");
    });
    for (const secret of ["meta-secret", "data-secret", "late-data-secret"])
      expect(json, secret).not.toContain(secret);
  });

  it("strips the query and the fragment of URLs, and the address of mailto: and tel:", async () => {
    window.history.replaceState(null, "", "/page?token=page-secret#frag-secret");
    const json = await recordPage(
      `<a href="/reset?token=href-secret#hash-secret">r</a>
       <a href="mailto:someone@secret.example">m</a>
       <a href="tel:+15550001234">t</a>
       <form action="/submit?session=action-secret"></form>`,
      { blockAllMedia: false },
      () => {
        document.querySelector("a")!.setAttribute("href", "/next?code=late-href-secret");
        const img = document.createElement("img");
        img.setAttribute("src", "/a.png?sig=src-secret");
        img.setAttribute("srcset", "/a.png?sig=srcset-secret 1x, /b.png?x=1 2x");
        document.body.append(img);
      },
    );
    window.history.replaceState(null, "", "/");
    for (const secret of [
      "page-secret",
      "frag-secret",
      "href-secret",
      "hash-secret",
      "secret.example",
      "5550001234",
      "action-secret",
      "late-href-secret",
      "src-secret",
      "srcset-secret",
    ])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain('"href":"http://localhost:3000/reset"');
    expect(json).toContain('"href":"mailto:"');
    expect(json).toContain(
      '"srcset":"http://localhost:3000/a.png 1x, http://localhost:3000/b.png 2x"',
    );
  });
});

describe("the options", () => {
  it("applies the markers with every option set", async () => {
    const json = await recordPage(
      `<p class="everr-mask">class-mask</p><p data-everr-mask>data-mask</p>
       <div class="everr-block">class-block</div><div data-everr-block>data-block</div>
       <div data-everr-ignore><input id="ignored"></div>
       <p>open text</p>`,
      { maskAllText: false, maskAllInputs: false, maskAttributes: [] },
      () => type(document.getElementById("ignored"), "ignored-typing"),
    );
    for (const secret of ["class-mask", "data-mask", "class-block", "data-block", "ignored-typing"])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain("open text");
  });

  it("applies the mask, block, and ignore selector lists", async () => {
    const json = await recordPage(
      `<p class="pii">listed-mask</p><p>open</p><section class="widget">listed-block</section>
       <form class="search"><input id="q"></form><input id="r" class="pii">`,
      {
        maskAllText: false,
        maskAllInputs: false,
        mask: [".pii"],
        block: [".widget"],
        ignore: [".search"],
      },
      () => {
        type(document.getElementById("q"), "ignored-query");
        type(document.getElementById("r"), "masked-input");
      },
    );
    for (const secret of ["listed-mask", "listed-block", "ignored-query", "masked-input"])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain("open");
  });

  it("lets unmask win over Mask, but never over passwords", async () => {
    const json = await recordPage(
      `<div class="safe"><p class="everr-mask">shown text</p><input id="n" title="shown-title">
       <input id="pw" type="password"></div>`,
      { unmask: [".safe"] },
      () => {
        type(document.getElementById("n"), "shown input");
        type(document.getElementById("pw"), "never-shown");
      },
    );
    expect(json).toContain("shown text");
    expect(json).toContain("shown input");
    expect(json).toContain("shown-title");
    expect(json).not.toContain("never-shown");
  });

  it("uses maskFn in place of the asterisks, except for passwords", async () => {
    const json = await recordPage(
      `<p>secret words</p><input id="pw" type="password">`,
      { maskFn: (text) => `[${text.length}]` },
      () => type(document.getElementById("pw"), "pass"),
    );
    expect(json).toContain("[12]");
    expect(json).toContain('"text":"****"');
  });

  it("replaces the attribute list with maskAttributes, and an empty list masks none", async () => {
    const html = `<div title="kept-title" data-x="kept-data" alt="alt-secret">x</div>`;
    const custom = await recordPage(html, { maskAttributes: ["alt"] });
    expect(custom).toContain("kept-title");
    expect(custom).not.toContain("alt-secret");
    document.body.innerHTML = "";
    const none = await recordPage(html, { maskAttributes: [] });
    expect(none).toContain("kept-data");
    expect(none).toContain("alt-secret");
  });

  it("records media with blockAllMedia: false, and blocks what block lists", async () => {
    const json = await recordPage(`<img id="a" src="/a.png"><img class="private" src="/b.png">`, {
      blockAllMedia: false,
      block: [".private"],
    });
    expect(json).toContain('"src":"http://localhost:3000/a.png"');
    expect(json).not.toContain("/b.png");
  });
});
