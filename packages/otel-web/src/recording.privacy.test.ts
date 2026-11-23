import { afterEach, describe, expect, it, onTestFinished } from "vite-plus/test";
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
  // The whole buffer, with the act() events.
  const clip = t.rec.recorder.startClip({ last: 5 * 60_000 });
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

  it("masks the attributes that hold text once, and keeps the numbers that the replay draws", async () => {
    const json = await recordPage(
      `<input type="image" alt="alt-secret" src="/x.png">
       <select><optgroup label="group-secret"><option label="option-secret">o</option></optgroup></select>
       <div role="slider" aria-valuetext="valuetext-secret" aria-description="description-secret"
         aria-placeholder="aria-placeholder-secret" aria-roledescription="role-secret"
         aria-braillelabel="braille-secret" aria-valuenow="40"></div>
       <data value="data-secret">d</data>
       <time datetime="1990-04-12">t</time>
       <a download="download-secret.pdf">a</a>
       <table summary="summary-secret"><tr><th abbr="abbr-secret">h</th></tr></table>
       <ol><li value="7">l</li></ol><progress value="0.5"></progress>`,
      { maskFn: (text) => `[${text.length}]` },
      () => {
        document.querySelector("data")!.setAttribute("value", "late-data-secret");
        document.querySelector("option")!.setAttribute("label", "late-option-secret");
      },
    );
    for (const secret of [
      "alt-secret",
      "group-secret",
      "option-secret",
      "valuetext-secret",
      "description-secret",
      "aria-placeholder-secret",
      "role-secret",
      "braille-secret",
      "data-secret",
      "1990-04-12",
      "download-secret",
      "summary-secret",
      "abbr-secret",
    ])
      expect(json, secret).not.toContain(secret);
    // A value masked twice would be the length of the first mask.
    for (const masked of [
      '"alt":"[10]"',
      '"label":"[12]"',
      '"label":"[13]"',
      '"label":"[18]"',
      '"aria-valuetext":"[16]"',
      '"value":"[11]"',
      '"value":"[16]"',
      '"datetime":"[10]"',
    ])
      expect(json, masked).toContain(masked);
    for (const kept of ['"value":"7"', '"value":"0.5"', '"aria-valuenow":"40"'])
      expect(json, kept).toContain(kept);
  });

  it("keeps the data-* keys of component state, unless maskAttributes is set", async () => {
    const html = `<div data-state="open" data-side="bottom" data-user="data-secret">x</div>`;
    const kept = await recordPage(html, {}, () => {
      document.querySelector("div")!.setAttribute("data-state", "closed");
    });
    expect(kept).toContain('"data-state":"open"');
    expect(kept).toContain('"data-side":"bottom"');
    expect(kept).toContain('"data-state":"closed"');
    expect(kept).not.toContain("data-secret");

    const masked = await recordPage(html, { maskAttributes: ["data-*"] });
    expect(masked).not.toContain('"data-state":"open"');
    expect(masked).not.toContain('"data-side":"bottom"');
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

  it("strips a query that holds a comma or a space, and each candidate of a srcset", async () => {
    const json = await recordPage(
      `<a href="/page?names=alice,comma-secret@example.com">x</a>
       <form action="/submit?to=a, space-secret"></form>`,
      { blockAllMedia: false },
      () => {
        const img = document.createElement("img");
        img.setAttribute(
          "srcset",
          "/a.png?sig=1,set-secret 1x, /b.png?sig=2,bare-secret, /c.png#frag-secret 3x",
        );
        document.body.append(img);
      },
    );
    for (const secret of [
      "comma-secret",
      "space-secret",
      "set-secret",
      "bare-secret",
      "frag-secret",
    ])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain('"href":"http://localhost:3000/page"');
    expect(json).toContain('"action":"/submit"');
    expect(json).toContain(
      '"srcset":"http://localhost:3000/a.png 1x, http://localhost:3000/b.png, http://localhost:3000/c.png 3x"',
    );
  });

  it("strips the query and the fragment of a CSS url", async () => {
    const json = await recordPage(
      `<style>@import "/font?token=import-secret"; body { background: url("/bg?token=sheet-secret#frag-sheet") }</style>
       <div id="box" style="background-image: url('/avatar?token=style-secret,extra-secret#frag-style'), url('data:image/gif;base64,AAAA?keep')">x</div>`,
      { maskAllText: false },
      () => {
        document
          .getElementById("box")!
          .setAttribute("style", "background-image: url('/next?token=late-style-secret')");
        document.querySelector("style")!.textContent =
          "body { background: url('/late?token=late-sheet-secret') }";
      },
    );
    for (const secret of [
      "import-secret",
      "sheet-secret",
      "frag-sheet",
      "style-secret",
      "extra-secret",
      "frag-style",
      "late-style-secret",
      "late-sheet-secret",
    ])
      expect(json, secret).not.toContain(secret);
    for (const path of ["/avatar", "/bg", "/font", "/late"])
      expect(json, path).toContain(`http://localhost:3000${path}`);
    // A style diff keeps the property value rrweb read, which stays relative.
    expect(json).toContain('url(\\"/next\\")');
    expect(json).toContain("AAAA?keep");
  });

  it("strips the query and the fragment of a CSS url that the CSSOM writes", async () => {
    // jsdom has no adoptedStyleSheets. With the accessor, rrweb watches it as
    // in a browser. rrweb leaves its own copy on the document at shutdown.
    let adopted: CSSStyleSheet[] = [];
    Object.defineProperty(Document.prototype, "adoptedStyleSheets", {
      configurable: true,
      get: () => adopted,
      set: (sheets: CSSStyleSheet[]) => {
        adopted = sheets;
      },
    });
    onTestFinished(() => {
      Reflect.deleteProperty(Document.prototype, "adoptedStyleSheets");
      Reflect.deleteProperty(document, "adoptedStyleSheets");
    });
    document.head.innerHTML = `<style>@media screen { p { color: red } }</style>`;
    const json = await recordPage(`<p>x</p>`, {}, async () => {
      const sheet = document.querySelector("style")!.sheet!;
      sheet.insertRule(`body { background: url("/rule?token=rule-secret#rule-frag") }`, 0);
      (sheet.cssRules[0] as CSSStyleRule).style.setProperty(
        "background-image",
        `url("/set?token=set-secret")`,
      );
      (sheet.cssRules[1] as CSSMediaRule).insertRule(
        `i { background: url(/nested?token=nested-secret) }`,
        0,
      );
      const made = new CSSStyleSheet();
      made.replaceSync(`b { background: url('/adopted?token=adopted-secret') }`);
      document.adoptedStyleSheets = [made];
      made.insertRule(`u { background: url("/added?token=added-secret") }`, 0);
      made.replaceSync(`a { background: url("/sync?token=sync-secret") }`);
      await made.replace(`a { background: url("/async?token=async-secret") }`);
    });
    for (const secret of [
      "rule-secret",
      "rule-frag",
      "set-secret",
      "nested-secret",
      "adopted-secret",
      "added-secret",
      "sync-secret",
      "async-secret",
    ])
      expect(json, secret).not.toContain(secret);
    for (const path of ["/rule", "/set", "/nested", "/adopted", "/added", "/sync", "/async"])
      expect(json, path).toContain(path);
  });

  it("strips the query of imagesrcset, xlink:href, object data, and image-set() strings", async () => {
    const json = await recordPage(
      `<link rel="preload" as="image" imagesrcset="/hero.png?token=set-secret 1x, /hero2.png?token=set2-secret 2x">
       <svg><image xlink:href="/a.png?token=xlink-secret"></image></svg>
       <object data="/doc.pdf?token=data-secret"></object>
       <div style="background-image: image-set('/b.png?token=quoted-secret' 1x, url('/c.png?token=url-secret') 2x)">x</div>`,
      { blockAllMedia: false },
    );
    for (const secret of [
      "set-secret",
      "set2-secret",
      "xlink-secret",
      "data-secret",
      "quoted-secret",
      "url-secret",
    ])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain("image-set('/b.png' 1x, url('http://localhost:3000/c.png') 2x)");
  });

  it("keeps references to elements of the page", async () => {
    const json = await recordPage(
      `<div id="box">x</div><svg><use href="#icon"></use></svg>`,
      { blockAllMedia: false },
      () => {
        document.getElementById("box")!.style.clipPath = "url(#clip)";
      },
    );
    expect(json).toContain('"href":"#icon"');
    expect(json).toContain('url(\\"#clip\\")');
  });

  it("keeps the quotes of a url() that has spaces inside, so the style still parses", async () => {
    const json = await recordPage(
      `<div style="background: url( '/bg?token=spaced-secret' ); color: red">x</div>`,
      { maskAllText: false },
    );
    expect(json).not.toContain("spaced-secret");
    const style = /"style":"([^"]*)"/.exec(json)![1];
    expect(style.split("'").length % 2, style).toBe(1);
    expect(style).toContain("color: red");
  });
});

describe("the options", () => {
  it("applies the markers with every option set", async () => {
    const json = await recordPage(
      `<p class="everr-mask">class-mask</p><p data-everr-mask>data-mask</p>
       <div class="everr-block">class-block</div><div data-everr-block>data-block</div>
       <div class="everr-no-capture">no-capture-text</div>
       <div data-everr-ignore><input id="ignored"></div>
       <p>open text</p>`,
      { maskAllText: false, maskAllInputs: false, maskAttributes: [] },
      () => type(document.getElementById("ignored"), "ignored-typing"),
    );
    for (const secret of [
      "class-mask",
      "data-mask",
      "class-block",
      "data-block",
      "no-capture-text",
      "ignored-typing",
    ])
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

  it("masks a URL attribute that maskAttributes lists, path and all", async () => {
    const json = await recordPage(`<a href="/reset/path-secret">x</a>`, {
      maskAttributes: ["href"],
    });
    expect(json).not.toContain("path-secret");
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
