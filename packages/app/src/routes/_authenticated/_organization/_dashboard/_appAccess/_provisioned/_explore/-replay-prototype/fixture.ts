// PROTOTYPE fixture. A checkout Recording, 18 seconds, plus the signals on its clock.
// Throwaway: packages/app replay-prototype route.

export const DURATION_MS = 18_000;
export const ERROR_MS = 8_000;
const T0 = 1_700_000_000_000;

type SignalKind = "span" | "log" | "error";

export type Signal = {
  id: string;
  kind: SignalKind;
  name: string;
  detail: string;
  service: string;
  /** Start, milliseconds from the beginning of the Recording. */
  t: number;
  /** 0 for a point on the timeline. */
  dur: number;
  depth: number;
};

export const signals: Signal[] = [
  {
    id: "doc",
    kind: "span",
    name: "GET /checkout",
    detail: "document load",
    service: "shop-web",
    t: 0,
    dur: DURATION_MS,
    depth: 0,
  },
  {
    id: "click",
    kind: "span",
    name: "click Pay",
    detail: "button.pay",
    service: "shop-web",
    t: 2_400,
    dur: 180,
    depth: 1,
  },
  {
    id: "click-log",
    kind: "log",
    name: "click",
    detail: "Pay $42",
    service: "shop-web",
    t: 2_400,
    dur: 0,
    depth: 1,
  },
  {
    id: "post",
    kind: "span",
    name: "POST /checkout",
    detail: "500 card declined",
    service: "shop-api",
    t: 6_100,
    dur: 1_700,
    depth: 1,
  },
  {
    id: "err",
    kind: "error",
    name: "Card declined",
    detail: "PaymentError: card declined",
    service: "shop-api",
    t: ERROR_MS,
    dur: 0,
    depth: 0,
  },
  {
    id: "retry",
    kind: "span",
    name: "GET /checkout",
    detail: "200",
    service: "shop-web",
    t: 11_200,
    dur: 900,
    depth: 1,
  },
  {
    id: "dismiss",
    kind: "log",
    name: "dismiss",
    detail: "user closed the error",
    service: "shop-web",
    t: 14_000,
    dur: 0,
    depth: 1,
  },
];

export const STACK = [
  "PaymentError: card declined",
  "    at submitCheckout (checkout.ts:88)",
  "    at onClick (PayButton.tsx:24)",
].join("\n");

export function signalById(id: string) {
  return signals.find((signal) => signal.id === id) ?? signals[0];
}

export function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function pct(ms: number) {
  return `${(ms / DURATION_MS) * 100}%`;
}

export function msFromPointer(clientX: number, left: number, width: number) {
  if (width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return Math.round(ratio * DURATION_MS);
}

/** Arrow keys scrub a timeline and do not change the prototype variant. */
export function onTrackKey(
  event: {
    key: string;
    preventDefault(): void;
    stopPropagation(): void;
  },
  timeMs: number,
  onSeek: (ms: number) => void,
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  event.stopPropagation();
  onSeek(timeMs + (event.key === "ArrowRight" ? 500 : -500));
}

type Node = Record<string, unknown>;

function text(id: number, textContent: string): Node {
  return { type: 3, id, textContent };
}

function el(
  id: number,
  tagName: string,
  attributes: Record<string, string>,
  childNodes: Node[],
): Node {
  return { type: 2, id, tagName, attributes, childNodes };
}

const pageCss = {
  body: "margin:0;background:#f4f1ea;color:#1c1917;font-family:ui-sans-serif,system-ui,sans-serif;",
  main: "max-width:420px;margin:48px auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:28px;",
  kicker:
    "margin:0;color:#78716c;font-size:12px;letter-spacing:.08em;text-transform:uppercase;",
  h1: "margin:8px 0 0;font-size:22px;font-weight:600;",
  line: "margin:18px 0 0;font-size:15px;",
  muted: "color:#78716c;font-size:13px;",
  button:
    "margin-top:22px;width:100%;border:0;border-radius:8px;background:#1c1917;color:#fff;padding:12px 16px;font-size:15px;",
  banner:
    "margin:0 0 16px;background:#fee2e2;color:#991b1b;border-radius:8px;padding:12px 14px;font-size:14px;",
};

function page(buttonLabel: string): Node {
  return {
    type: 0,
    id: 1,
    compatMode: "CSS1Compat",
    childNodes: [
      { type: 1, id: 2, name: "html", publicId: "", systemId: "" },
      el(3, "html", { lang: "en" }, [
        el(4, "head", {}, []),
        el(7, "body", { style: pageCss.body }, [
          el(8, "main", { style: pageCss.main }, [
            el(9, "p", { style: pageCss.kicker }, [text(10, "Shop")]),
            el(11, "h1", { style: pageCss.h1 }, [text(12, "Checkout")]),
            el(13, "p", { style: pageCss.line }, [text(14, "Ada Lovelace")]),
            el(15, "p", { style: `${pageCss.line};${pageCss.muted}` }, [
              text(16, "Visa 4242 · $42.00"),
            ]),
            el(17, "button", { style: pageCss.button }, [
              text(18, buttonLabel),
            ]),
          ]),
        ]),
      ]),
    ],
  };
}

function mutation(
  timestamp: number,
  data: {
    texts?: { id: number; value: string }[];
    adds?: Node[];
    removes?: { parentId: number; id: number }[];
  },
) {
  return {
    type: 3,
    timestamp,
    data: {
      source: 0,
      texts: data.texts ?? [],
      attributes: [],
      removes: data.removes ?? [],
      adds: data.adds ?? [],
    },
  };
}

/** Sample rrweb events. The page itself changes at the Pay click, the error, and the dismiss. */
export function recordingEvents() {
  return [
    {
      type: 4,
      timestamp: T0,
      data: { href: "https://shop.example/checkout", width: 960, height: 640 },
    },
    {
      type: 2,
      timestamp: T0,
      data: { node: page("Pay $42"), initialOffset: { top: 0, left: 0 } },
    },
    {
      type: 3,
      timestamp: T0 + 1_800,
      data: {
        source: 1,
        positions: [
          { x: 280, y: 160, id: 7, timeOffset: 0 },
          { x: 300, y: 280, id: 17, timeOffset: 400 },
        ],
      },
    },
    {
      type: 3,
      timestamp: T0 + 2_400,
      data: { source: 2, type: 2, id: 17, x: 300, y: 290 },
    },
    mutation(T0 + 6_100, { texts: [{ id: 18, value: "Paying..." }] }),
    mutation(T0 + ERROR_MS, {
      adds: [
        {
          parentId: 8,
          nextId: 9,
          node: el(20, "p", { style: pageCss.banner }, [
            text(21, "Card declined"),
          ]),
        },
      ],
    }),
    mutation(T0 + 14_000, {
      texts: [{ id: 18, value: "Try another card" }],
      removes: [{ parentId: 8, id: 20 }],
    }),
  ];
}
