import { afterEach, describe, expect, it } from "vite-plus/test";
import type { WebSDK } from "./client.js";
import { type RecordingOptions, recorder, recording } from "./recording.js";
import { clearIdentity } from "./state/session.js";
import { type OtlpBatch, type OtlpRecord, startClient, startPersistentClient } from "./test-kit.js";
import type { Persistence } from "./types.js";

// Privacy is asserted on the Segment body. `dev` is the WebSDK option, and the
// default privacy bundle is on whether `dev` is true or false.
// memory is Cookieless. localStorage is Consented. The rules match.

const SEGMENT = "everr.browser.recording.segment";

const modes = [
  { dev: false, persistence: "memory" as const, mode: "cookieless" },
  { dev: true, persistence: "memory" as const, mode: "cookieless" },
  { dev: false, persistence: "localStorage" as const, mode: "consented" },
  { dev: true, persistence: "localStorage" as const, mode: "consented" },
];

const clients: WebSDK[] = [];

afterEach(async () => {
  while (clients.length) await clients.pop()?.shutdown();
  clearIdentity();
  localStorage.clear();
  document.body.replaceChildren();
  document.head.querySelectorAll("[data-privacy-fixture]").forEach((node) => {
    node.remove();
  });
});

function track(sdk: WebSDK): WebSDK {
  clients.push(sdk);
  return sdk;
}

async function recorderReady(): Promise<void> {
  await import("./recording/recorder.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function bodyText(record: OtlpRecord): string {
  const body = record.body as { stringValue?: string } | undefined;
  return body?.stringValue ?? "";
}

function segmentBody(batches: OtlpBatch[]): string {
  return batches
    .flatMap((batch) => batch.records)
    .filter((record) => record.eventName === SEGMENT)
    .map(bodyText)
    .join("\n");
}

function stars(text: string): string {
  return `"${"*".repeat(text.length)}"`;
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function head(tag: string, attrs: Record<string, string>): HTMLElement {
  const node = document.createElement(tag);
  node.setAttribute("data-privacy-fixture", "");
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  document.head.append(node);
  return node;
}

async function recordClip(options: {
  dev: boolean;
  persistence: Persistence;
  recording?: RecordingOptions;
  setup?: () => void;
  mutate?: () => void | Promise<void>;
}): Promise<string> {
  options.setup?.();
  const start = options.persistence === "localStorage" ? startPersistentClient : startClient;
  const [sdk, batches] = start({
    dev: options.dev,
    // dev false with no endpoint builds no transport. The local collector
    // address keeps the Segment on the same fetch stub either way.
    endpoint: "http://127.0.0.1:54418",
    instrumentations: [recording(options.recording)],
  });
  track(sdk);
  await recorderReady();
  await options.mutate?.();
  await settle();
  recorder.emitClip();
  return segmentBody(batches);
}

const NAME = "PRIVACY-NAME-ADA";

describe("recording privacy", () => {
  it.each(modes)("masks all text by default ($mode, dev $dev)", async ({ dev, persistence }) => {
    const body = await recordClip({
      dev,
      persistence,
      setup: () => {
        const el = document.createElement("p");
        el.textContent = NAME;
        document.body.append(el);
      },
    });
    expect(body).not.toContain(NAME);
    expect(body).toContain(stars(NAME));
  });

  it("masks text when dev is omitted", async () => {
    const el = document.createElement("p");
    el.textContent = NAME;
    document.body.append(el);
    const [sdk, batches] = startClient({
      dev: undefined,
      endpoint: "http://127.0.0.1:54418",
      instrumentations: [recording()],
    });
    track(sdk);
    await recorderReady();
    recorder.emitClip();
    const body = segmentBody(batches);
    expect(body).not.toContain(NAME);
    expect(body).toContain(stars(NAME));
  });

  it.each(modes)(
    "masks text mutations by default ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const secret = "MUT-TEXT-SECRET";
      let node: HTMLElement;
      const body = await recordClip({
        dev,
        persistence,
        setup: () => {
          node = document.createElement("p");
          document.body.append(node);
        },
        mutate: () => {
          node.textContent = secret;
        },
      });
      expect(body).not.toContain(secret);
      expect(body).toContain(stars(secret));
    },
  );

  it.each(modes)(
    "explicit maskAllText wins, and markers still mask ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const plain = "EXPLICIT-PLAIN";
      const marked = "EXPLICIT-MARKER";
      const body = await recordClip({
        dev,
        persistence,
        recording: { maskAllText: false },
        setup: () => {
          const open = document.createElement("p");
          open.textContent = plain;
          const hidden = document.createElement("p");
          hidden.className = "everr-mask";
          hidden.textContent = marked;
          document.body.append(open, hidden);
        },
      });
      expect(body).toContain(plain);
      expect(body).not.toContain(marked);
      expect(body).toContain(stars(marked));
    },
  );

  it.each(modes)(
    "masks input values by default ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const typed = "INPUT-SECRET";
      const area = "AREA-SECRET";
      const option = "OPTION-SECRET";
      const submit = "SUBMIT-SECRET";
      let field: HTMLInputElement;
      const body = await recordClip({
        dev,
        persistence,
        setup: () => {
          field = document.createElement("input");
          field.value = "before";
          const box = document.createElement("textarea");
          box.value = area;
          const select = document.createElement("select");
          const choice = document.createElement("option");
          choice.textContent = option;
          select.append(choice);
          const button = document.createElement("input");
          button.type = "submit";
          button.value = submit;
          document.body.append(field, box, select, button);
        },
        mutate: () => {
          typeInto(field, typed);
        },
      });
      for (const secret of [typed, area, option, submit]) {
        expect(body).not.toContain(secret);
        expect(body).toContain(stars(secret));
      }
    },
  );

  it.each(modes)(
    "explicit maskAllInputs wins, and a mask marker still masks ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const open = "OPEN-INPUT";
      const marked = "MARKED-INPUT";
      const body = await recordClip({
        dev,
        persistence,
        recording: { maskAllInputs: false },
        setup: () => {
          const plain = document.createElement("input");
          plain.value = open;
          const hidden = document.createElement("input");
          hidden.value = marked;
          const wrap = document.createElement("div");
          wrap.className = "everr-mask";
          wrap.append(hidden);
          document.body.append(plain, wrap);
        },
      });
      expect(body).toContain(open);
      expect(body).not.toContain(marked);
      expect(body).toContain(stars(marked));
    },
  );

  it.each(modes)(
    "keeps passwords masked under unmask and maskAllInputs: false ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const password = "PW-SECRET-VALUE";
      const open = "OPEN-IN-PANEL";
      const body = await recordClip({
        dev,
        persistence,
        recording: {
          maskAllInputs: false,
          maskAllText: false,
          unmask: ["input", ".show"],
        },
        setup: () => {
          const panel = document.createElement("div");
          panel.className = "panel";
          const secret = document.createElement("input");
          secret.type = "password";
          secret.className = "show";
          secret.value = password;
          const plain = document.createElement("input");
          plain.type = "text";
          plain.value = open;
          panel.append(secret, plain);
          document.body.append(panel);
        },
      });
      expect(body).toContain(open);
      expect(body).not.toContain(password);
      expect(body).toContain(stars(password));
    },
  );

  it.each(modes)(
    "blocks media, icon links, base, and srcdoc iframes by default ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const tokens = {
        img: "face-photo.jpg",
        svg: "SVG-TOKEN",
        video: "clip-video.mp4",
        object: "doc-object.pdf",
        picture: "PICTURE-TOKEN",
        embed: "embed-doc.pdf",
        map: "MAP-TOKEN",
        audio: "audio-clip.mp3",
        icon: "icon-face.ico",
        shortcut: "shortcut-icon-face.png",
        apple: "apple-icon-face.png",
        base: "base-href-secret",
        srcdoc: "SRCDOC-SECRET",
        srcdocWithSrc: "SRCDOC-WITH-SRC",
        background: "bg-photo.png",
      };
      const body = await recordClip({
        dev,
        persistence,
        setup: () => {
          const img = document.createElement("img");
          img.src = `https://cdn.example/${tokens.img}`;
          const svg = document.createElement("svg");
          svg.setAttribute("data-svg", tokens.svg);
          const video = document.createElement("video");
          video.src = `https://cdn.example/${tokens.video}`;
          const object = document.createElement("object");
          object.data = `https://cdn.example/${tokens.object}`;
          const picture = document.createElement("picture");
          picture.setAttribute("data-picture", tokens.picture);
          const embed = document.createElement("embed");
          embed.src = `https://cdn.example/${tokens.embed}`;
          const map = document.createElement("map");
          map.setAttribute("name", tokens.map);
          const audio = document.createElement("audio");
          audio.src = `https://cdn.example/${tokens.audio}`;
          const painted = document.createElement("div");
          painted.setAttribute(
            "style",
            `background-image: url(https://cdn.example/${tokens.background})`,
          );
          const frame = document.createElement("iframe");
          frame.srcdoc = `<p>${tokens.srcdoc}</p>`;
          const framed = document.createElement("iframe");
          framed.src = "https://cdn.example/frame-src.html";
          framed.srcdoc = `<p>${tokens.srcdocWithSrc}</p>`;
          document.body.append(
            img,
            svg,
            video,
            object,
            picture,
            embed,
            map,
            audio,
            painted,
            frame,
            framed,
          );
          head("base", { href: `https://secret.example/${tokens.base}` });
          head("link", {
            rel: "icon",
            href: `https://cdn.example/${tokens.icon}`,
          });
          head("link", {
            rel: "shortcut icon",
            href: `https://cdn.example/${tokens.shortcut}`,
          });
          head("link", {
            rel: "apple-touch-icon",
            href: `https://cdn.example/${tokens.apple}`,
          });
        },
      });
      expect(body).toContain(tokens.background);
      expect(body).toContain(tokens.srcdocWithSrc);
      const blocked = [
        tokens.img,
        tokens.svg,
        tokens.video,
        tokens.object,
        tokens.picture,
        tokens.embed,
        tokens.map,
        tokens.audio,
        tokens.icon,
        tokens.shortcut,
        tokens.apple,
        tokens.base,
        tokens.srcdoc,
      ];
      for (const token of blocked) expect(body).not.toContain(token);
      expect(body).toMatch(/"rr_width":"-?\d+(\.\d+)?px"/);
      expect(body).toMatch(/"rr_height":"-?\d+(\.\d+)?px"/);
    },
  );

  it.each(modes)(
    "explicit blockAllMedia: false reveals media while keeping base and srcdoc blocked ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const photo = "toggle-photo.jpg";
      const base = "toggle-base-secret";
      const srcdoc = "TOGGLE-SRCDOC";
      const body = await recordClip({
        dev,
        persistence,
        recording: { blockAllMedia: false },
        setup: () => {
          const img = document.createElement("img");
          img.src = `https://cdn.example/${photo}`;
          const frame = document.createElement("iframe");
          frame.srcdoc = `<p>${srcdoc}</p>`;
          document.body.append(img, frame);
          head("base", { href: `https://secret.example/${base}` });
        },
      });
      expect(body).toContain(photo);
      expect(body).not.toContain(base);
      expect(body).not.toContain(srcdoc);
    },
  );

  it.each(modes)(
    "markers and data-everr attributes mask, block, and ignore ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const maskClass = "MASK-CLASS-SECRET";
      const maskData = "MASK-DATA-SECRET";
      const plain = "PLAIN-VISIBLE";
      const blockClass = "BLOCK-CLASS-SECRET";
      const blockData = "BLOCK-DATA-SECRET";
      const ignoreClass = "IGNORE-CLASS-SECRET";
      const ignoreData = "IGNORE-DATA-SECRET";
      const typed = "TYPED-VISIBLE";
      let ignoredClass: HTMLInputElement;
      let ignoredData: HTMLInputElement;
      let open: HTMLInputElement;
      const body = await recordClip({
        dev,
        persistence,
        recording: {
          maskAllText: false,
          maskAllInputs: false,
          blockAllMedia: false,
        },
        setup: () => {
          const masked = document.createElement("p");
          masked.className = "everr-mask";
          masked.textContent = maskClass;
          const maskedData = document.createElement("p");
          maskedData.setAttribute("data-everr-mask", "");
          maskedData.textContent = maskData;
          const visible = document.createElement("p");
          visible.textContent = plain;
          const blocked = document.createElement("div");
          blocked.className = "everr-block";
          blocked.setAttribute("data-block", blockClass);
          const blockedData = document.createElement("div");
          blockedData.setAttribute("data-everr-block", "");
          blockedData.setAttribute("data-block", blockData);
          ignoredClass = document.createElement("input");
          ignoredClass.className = "everr-ignore";
          ignoredData = document.createElement("input");
          ignoredData.setAttribute("data-everr-ignore", "");
          open = document.createElement("input");
          document.body.append(
            masked,
            maskedData,
            visible,
            blocked,
            blockedData,
            ignoredClass,
            ignoredData,
            open,
          );
        },
        mutate: () => {
          typeInto(ignoredClass, ignoreClass);
          typeInto(ignoredData, ignoreData);
          typeInto(open, typed);
        },
      });
      expect(body).toContain(plain);
      expect(body).not.toContain(maskClass);
      expect(body).not.toContain(maskData);
      expect(body).toContain(stars(maskClass));
      expect(body).not.toContain(blockClass);
      expect(body).not.toContain(blockData);
      expect(body).toMatch(/"rr_width":"-?\d+(\.\d+)?px"/);
      expect(body).not.toContain(ignoreClass);
      expect(body).not.toContain(ignoreData);
      expect(body).not.toContain(stars(ignoreClass));
      expect(body).not.toContain(stars(ignoreData));
      expect(body).toContain(typed);
    },
  );

  it.each(modes)(
    "selector options mask, unmask, block, and ignore ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const masked = "SELECTOR-MASK";
      const revealed = "SELECTOR-REVEAL";
      const plain = "SELECTOR-PLAIN";
      const hidden = "SELECTOR-HIDE";
      const skipped = "IGNORE-SELECTOR-VALUE";
      const typed = "SELECTOR-TYPED";
      let skip: HTMLInputElement;
      let field: HTMLInputElement;
      const body = await recordClip({
        dev,
        persistence,
        recording: {
          maskAllText: true,
          maskAllInputs: false,
          blockAllMedia: false,
          mask: [".secret"],
          unmask: [".safe"],
          block: [".hide"],
          ignore: [".skip"],
        },
        setup: () => {
          const secret = document.createElement("p");
          secret.className = "secret";
          secret.textContent = masked;
          const safe = document.createElement("p");
          safe.className = "secret safe";
          safe.textContent = revealed;
          const nested = document.createElement("div");
          nested.className = "safe";
          const nestedMask = document.createElement("p");
          nestedMask.className = "everr-mask";
          nestedMask.textContent = "NESTED-MASK-SECRET";
          const nestedOpen = document.createElement("p");
          nestedOpen.textContent = "NESTED-OPEN";
          nested.append(nestedMask, nestedOpen);
          const open = document.createElement("p");
          open.textContent = plain;
          const hide = document.createElement("div");
          hide.className = "hide";
          hide.setAttribute("data-hide", hidden);
          skip = document.createElement("input");
          skip.className = "skip";
          field = document.createElement("input");
          document.body.append(secret, safe, nested, open, hide, skip, field);
        },
        mutate: () => {
          typeInto(skip, skipped);
          typeInto(field, typed);
        },
      });
      expect(body).not.toContain(masked);
      expect(body).toContain(stars(masked));
      expect(body).toContain(revealed);
      expect(body).not.toContain("NESTED-MASK-SECRET");
      expect(body).toContain("NESTED-OPEN");
      expect(body).not.toContain(plain);
      expect(body).not.toContain(hidden);
      expect(body).not.toContain(skipped);
      expect(body).not.toContain(stars(skipped));
      expect(body).toContain(typed);
    },
  );

  it.each(modes)(
    "maskFn replaces the asterisk substitution ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const text = "MASKFN-TEXT";
      const place = "MASKFN-PLACE";
      const value = "MASKFN-INPUT";
      const body = await recordClip({
        dev,
        persistence,
        recording: {
          maskAllText: true,
          maskAllInputs: true,
          maskAttributes: ["placeholder"],
          maskFn: (input) => `redacted:${input.length}`,
        },
        setup: () => {
          const p = document.createElement("p");
          p.textContent = text;
          const field = document.createElement("input");
          field.placeholder = place;
          field.value = value;
          document.body.append(p, field);
        },
      });
      expect(body).not.toContain(text);
      expect(body).not.toContain(place);
      expect(body).not.toContain(value);
      expect(body).toContain(`redacted:${text.length}`);
      expect(body).toContain(`redacted:${place.length}`);
      expect(body).toContain(`redacted:${value.length}`);
      expect(body).not.toContain(stars(text));
    },
  );

  it.each(modes)(
    "masks title, placeholder, and aria-label by default ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const title = "TITLE-SECRET";
      const place = "PLACE-SECRET";
      const label = "ARIA-SECRET";
      const custom = "DATA-USER-SECRET";
      let field: HTMLInputElement;
      const body = await recordClip({
        dev,
        persistence,
        setup: () => {
          field = document.createElement("input");
          field.title = title;
          field.placeholder = "before";
          field.setAttribute("aria-label", label);
          field.setAttribute("data-user", custom);
          document.body.append(field);
        },
        mutate: () => {
          field.placeholder = place;
        },
      });
      expect(body).toContain(custom);
      for (const secret of [title, place, label]) {
        expect(body).not.toContain(secret);
        expect(body).toContain(stars(secret));
      }
    },
  );

  it.each(modes)(
    "explicit maskAttributes replaces the default list ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const title = "TITLE-KEPT";
      const custom = "DATA-ONLY-SECRET";
      const body = await recordClip({
        dev,
        persistence,
        recording: { maskAttributes: ["data-user"] },
        setup: () => {
          const field = document.createElement("input");
          field.title = title;
          field.setAttribute("data-user", custom);
          document.body.append(field);
        },
      });
      expect(body).toContain(title);
      expect(body).not.toContain(custom);
      expect(body).toContain(stars(custom));
    },
  );

  it.each(modes)(
    "an empty maskAttributes list masks no attributes ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const title = "TITLE-EMPTY-LIST";
      const body = await recordClip({
        dev,
        persistence,
        recording: { maskAttributes: [] },
        setup: () => {
          const field = document.createElement("input");
          field.title = title;
          document.body.append(field);
        },
      });
      expect(body).toContain(title);
    },
  );

  it.each(modes)(
    "ignores a file input's selected name ($mode, dev $dev)",
    async ({ dev, persistence }) => {
      const fileName = "passport-scan.pdf";
      const body = await recordClip({
        dev,
        persistence,
        recording: { maskAllInputs: false, maskAllText: false },
        setup: () => {
          const input = document.createElement("input");
          input.type = "file";
          Object.defineProperty(input, "value", {
            configurable: true,
            get: () => `C:\\fakepath\\${fileName}`,
          });
          document.body.append(input);
        },
        mutate: () => {
          const input = document.querySelector('input[type="file"]') as HTMLInputElement;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        },
      });
      expect(body).toContain('"type":"file"');
      expect(body).not.toContain(fileName);
      expect(body).not.toContain(stars(fileName));
    },
  );
});
