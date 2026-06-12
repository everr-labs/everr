export interface LayoutPoint {
  x: number;
  y: number;
}

const ITERATIONS = 250;
const COOLING = 0.96;
/** Mild pull toward the center so disconnected components stay on screen. */
const GRAVITY = 0.03;

/**
 * Deterministic Fruchterman–Reingold force layout: nodes start evenly spaced
 * on a circle (no randomness — the same graph always lays out the same way),
 * then repulsion between every pair, spring attraction along edges, and a
 * mild center gravity run for a fixed number of cooling iterations. The
 * result is uniformly rescaled to fit the padded box.
 */
export function layoutGraph(
  nodeIds: string[],
  edges: ReadonlyArray<{ source: string; target: string }>,
  width: number,
  height: number,
  padding: number,
): Map<string, LayoutPoint> {
  const n = nodeIds.length;
  const positions = new Map<string, LayoutPoint>();
  if (n === 0) return positions;
  const cx = width / 2;
  const cy = height / 2;
  if (n === 1) {
    positions.set(nodeIds[0]!, { x: cx, y: cy });
    return positions;
  }

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const index = new Map<string, number>();
  const r0 = Math.min(width, height) * 0.35;
  for (let i = 0; i < n; i++) {
    index.set(nodeIds[i]!, i);
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    xs[i] = cx + r0 * Math.cos(angle);
    ys[i] = cy + r0 * Math.sin(angle);
  }
  const edgeIdx: Array<[number, number]> = [];
  for (const e of edges) {
    const s = index.get(e.source);
    const t = index.get(e.target);
    if (s !== undefined && t !== undefined && s !== t) edgeIdx.push([s, t]);
  }

  const k = Math.sqrt((width * height) / n) * 0.8;
  let temperature = Math.max(width, height) / 8;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    dx.fill(0);
    dy.fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = xs[i]! - xs[j]!;
        let ddy = ys[i]! - ys[j]!;
        let d = Math.hypot(ddx, ddy);
        if (d < 0.01) {
          // Coincident points have no direction — nudge apart along an
          // index-derived (still deterministic) axis.
          ddx = Math.cos(i + j);
          ddy = Math.sin(i + j);
          d = 0.01;
        }
        const force = (k * k) / d;
        dx[i]! += (ddx / d) * force;
        dy[i]! += (ddy / d) * force;
        dx[j]! -= (ddx / d) * force;
        dy[j]! -= (ddy / d) * force;
      }
    }

    for (const [s, t] of edgeIdx) {
      const ddx = xs[s]! - xs[t]!;
      const ddy = ys[s]! - ys[t]!;
      const d = Math.max(Math.hypot(ddx, ddy), 0.01);
      const force = (d * d) / k;
      dx[s]! -= (ddx / d) * force;
      dy[s]! -= (ddy / d) * force;
      dx[t]! += (ddx / d) * force;
      dy[t]! += (ddy / d) * force;
    }

    for (let i = 0; i < n; i++) {
      dx[i]! += (cx - xs[i]!) * GRAVITY;
      dy[i]! += (cy - ys[i]!) * GRAVITY;
      const d = Math.hypot(dx[i]!, dy[i]!);
      if (d > 0) {
        const step = Math.min(d, temperature);
        xs[i]! += (dx[i]! / d) * step;
        ys[i]! += (dy[i]! / d) * step;
      }
    }
    temperature *= COOLING;
  }

  // Fit to the padded box, preserving the layout's aspect ratio.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]!);
    maxX = Math.max(maxX, xs[i]!);
    minY = Math.min(minY, ys[i]!);
    maxY = Math.max(maxY, ys[i]!);
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(
    (width - padding * 2) / spanX,
    (height - padding * 2) / spanY,
  );
  const offsetX = cx - ((minX + maxX) / 2) * scale;
  const offsetY = cy - ((minY + maxY) / 2) * scale;
  for (let i = 0; i < n; i++) {
    positions.set(nodeIds[i]!, {
      x: xs[i]! * scale + offsetX,
      y: ys[i]! * scale + offsetY,
    });
  }
  return positions;
}
