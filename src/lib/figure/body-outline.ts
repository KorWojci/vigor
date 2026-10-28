/**
 * The procedural line-art body outline shared by VitruvianFigure.tsx (dashboard) and
 * MuscleFigure.tsx (muscle load). Factored out so both draw literally the same head/torso/limb
 * shapes — not two hand-tuned approximations of each other.
 */
export type P = [number, number];
export type W = [number, number, number]; // x, y, half-width

export const CX = 280; // horizontal centre of the figure in the 560-wide viewBox

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
export function smooth(points: P[]): string {
  if (points.length < 2) return "";
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1: P = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: P = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Two contour lines of a limb, offset from its centre line by the given half-widths. */
export function limb(spine: W[]): string {
  const left: P[] = [];
  const right: P[] = [];
  spine.forEach(([x, y, w], i) => {
    const a = spine[Math.max(0, i - 1)];
    const b = spine[Math.min(spine.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  });
  return `${smooth(left)} ${smooth(right)}`;
}

export const mirror = (pts: W[]): W[] => pts.map(([x, y, w]) => [2 * CX - x, y, w]);
export const mirrorP = (pts: P[]): P[] => pts.map(([x, y]) => [2 * CX - x, y]);

// Primary pose: arms horizontal, legs together — the one pose both figures draw.
export const ARM_OUT: W[] = [[CX - 40, 158, 9], [CX - 72, 159, 7.5], [CX - 108, 160, 6], [CX - 136, 160, 4.5], [CX - 146, 160, 3.5]];
export const LEG_STRAIGHT: W[] = [[CX - 15, 262, 14], [CX - 15, 312, 9.5], [CX - 13, 340, 8.5], [CX - 11, 386, 4.5]];

const TORSO_LEFT: P[] = [[CX - 9, 140], [CX - 30, 148], [CX - 42, 156], [CX - 40, 178], [CX - 32, 206], [CX - 27, 232], [CX - 30, 252], [CX - 28, 268]];
export const TORSO_PATH = smooth(TORSO_LEFT) + " " + smooth(mirrorP(TORSO_LEFT));

/** Head, neck, torso and limb paths for the shared primary pose — everything except the Vitruvian-specific construction lines (circle/square/ticks) and the ghost second pose. */
export function bodyOutline() {
  return {
    head: { cx: CX, cy: 117, rx: 16, ry: 20 },
    neck: `M${CX - 7},136 L${CX - 8},145 M${CX + 7},136 L${CX + 8},145`,
    torso: TORSO_PATH,
    armLeft: limb(ARM_OUT),
    armRight: limb(mirror(ARM_OUT)),
    legLeft: limb(LEG_STRAIGHT),
    legRight: limb(mirror(LEG_STRAIGHT)),
    feet: `M${CX - 20},388 L${CX - 4},390 M${CX + 20},388 L${CX + 4},390`,
  };
}
