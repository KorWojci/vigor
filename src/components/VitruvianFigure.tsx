/**
 * An original line drawing inspired by Leonardo da Vinci's Vitruvian Man: a figure inscribed in a
 * circle and a square, in two superimposed poses. Drawn procedurally — no reproduction of the
 * original artwork is used. Body regions are interactive and carry the user's measurements.
 */
import type { FigureRegion } from "@/lib/body/measurement-types";

type P = [number, number];
type W = [number, number, number]; // x, y, half-width

const CX = 280; // horizontal centre of the figure in the 560-wide viewBox
const NAVEL: P = [CX, 222];
const R = 176;
const SQ = { x: CX - 150, y: 96, size: 300 };

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(points: P[]): string {
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
function limb(spine: W[]): string {
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

const mirror = (pts: W[]): W[] => pts.map(([x, y, w]) => [2 * CX - x, y, w]);
const mirrorP = (pts: P[]): P[] => pts.map(([x, y]) => [2 * CX - x, y]);

// Pose 1: arms horizontal, legs together.
const armOut: W[] = [[CX - 40, 158, 9], [CX - 72, 159, 7.5], [CX - 108, 160, 6], [CX - 136, 160, 4.5], [CX - 146, 160, 3.5]];
const legStraight: W[] = [[CX - 15, 262, 14], [CX - 15, 312, 9.5], [CX - 13, 340, 8.5], [CX - 11, 386, 4.5]];
// Pose 2 (ghost): arms raised to the circle, legs spread to the circle.
const armUp: W[] = [[CX - 40, 154, 9], [CX - 74, 141, 7.5], [CX - 108, 128, 6], [CX - 134, 117, 4.5], [CX - 142, 114, 3.5]];
const legSpread: W[] = [[CX - 14, 262, 14], [CX - 38, 310, 9.5], [CX - 50, 336, 8.5], [CX - 80, 380, 4.5]];

const torsoLeft: P[] = [[CX - 9, 140], [CX - 30, 148], [CX - 42, 156], [CX - 40, 178], [CX - 32, 206], [CX - 27, 232], [CX - 30, 252], [CX - 28, 268]];
const torso = smooth(torsoLeft) + " " + smooth(mirrorP(torsoLeft));

export interface RegionDatum {
  region: FigureRegion | "heart" | "head";
  label: string;
  value: string | null; // null → no data yet
  href: string;
  title?: string;
}

/** Marker position on the figure and the side its label is drawn on. */
const ANCHORS: Record<RegionDatum["region"], { at: P; side: "l" | "r"; y: number }> = {
  head: { at: [CX, 112], side: "r", y: 64 },
  neck: { at: [CX, 144], side: "r", y: 104 },
  shoulders: { at: [CX + 38, 155], side: "r", y: 144 },
  arm_left: { at: [CX + 82, 159], side: "r", y: 184 },
  forearm_left: { at: [CX + 120, 160], side: "r", y: 224 },
  hips: { at: [CX + 24, 258], side: "r", y: 264 },
  thigh_left: { at: [CX + 15, 298], side: "r", y: 304 },
  calf_left: { at: [CX + 13, 352], side: "r", y: 344 },
  heart: { at: [CX + 12, 176], side: "l", y: 64 },
  chest: { at: [CX - 20, 172], side: "l", y: 104 },
  arm_right: { at: [CX - 82, 159], side: "l", y: 144 },
  forearm_right: { at: [CX - 120, 160], side: "l", y: 184 },
  waist: { at: [CX - 6, 228], side: "l", y: 224 },
  thigh_right: { at: [CX - 15, 298], side: "l", y: 264 },
  calf_right: { at: [CX - 13, 352], side: "l", y: 304 },
  body: { at: [CX, 200], side: "l", y: 344 },
};

function Ticks() {
  const out: React.ReactElement[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const major = deg % 30 === 0;
    const a = (deg * Math.PI) / 180;
    const r1 = R + (major ? 6 : 3);
    out.push(
      <line key={`c${deg}`} className="tick" x1={NAVEL[0] + R * Math.cos(a)} y1={NAVEL[1] + R * Math.sin(a)} x2={NAVEL[0] + r1 * Math.cos(a)} y2={NAVEL[1] + r1 * Math.sin(a)} />,
    );
  }
  // The square's height divided into eighths: the head is one eighth of the body.
  for (let i = 0; i <= 8; i++) {
    const y = SQ.y + (SQ.size * i) / 8;
    out.push(<line key={`s${i}`} className="tick" x1={SQ.x - 5} y1={y} x2={SQ.x} y2={y} />);
    out.push(<line key={`t${i}`} className="tick" x1={SQ.x + SQ.size} y1={y} x2={SQ.x + SQ.size + 5} y2={y} />);
  }
  return <g>{out}</g>;
}

export function VitruvianFigure({ regions, heartRate }: { regions: RegionDatum[]; heartRate?: number | null }) {
  const beat = heartRate && heartRate > 25 && heartRate < 200 ? `${(60 / heartRate).toFixed(2)}s` : undefined;
  return (
    <svg className="vitruvian" viewBox="0 0 560 420" role="img" aria-labelledby="vitruvian-title">
      <title id="vitruvian-title">Body figure with your latest measurements</title>
      {/* construction: grid, square, circle */}
      <g>
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`gv${i}`} className="grid-line" x1={SQ.x + (SQ.size * i) / 8} y1={SQ.y} x2={SQ.x + (SQ.size * i) / 8} y2={SQ.y + SQ.size} />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`gh${i}`} className="grid-line" x1={SQ.x} y1={SQ.y + (SQ.size * i) / 8} x2={SQ.x + SQ.size} y2={SQ.y + (SQ.size * i) / 8} />
        ))}
        <rect className="construct" x={SQ.x} y={SQ.y} width={SQ.size} height={SQ.size} strokeWidth={1} />
        <circle className="construct" cx={NAVEL[0]} cy={NAVEL[1]} r={R} strokeWidth={1} />
        <circle className="ring" cx={NAVEL[0]} cy={NAVEL[1]} r={R + 10} strokeWidth={0.5} opacity={0.6} />
        <Ticks />
        <line className="tick" x1={CX} y1={SQ.y - 8} x2={CX} y2={SQ.y + SQ.size + 8} strokeDasharray="1 3" />
      </g>

      {/* second pose (ghost) */}
      <g className="body-ghost" strokeWidth={0.9}>
        <path d={limb(armUp)} />
        <path d={limb(mirror(armUp))} />
        <path d={limb(legSpread)} />
        <path d={limb(mirror(legSpread))} />
      </g>

      {/* primary pose */}
      <g className="body" strokeWidth={1.3}>
        <ellipse cx={CX} cy={117} rx={16} ry={20} />
        <path d={`M${CX - 7},136 L${CX - 8},145 M${CX + 7},136 L${CX + 8},145`} />
        <path d={torso} />
        <path d={limb(armOut)} />
        <path d={limb(mirror(armOut))} />
        <path d={limb(legStraight)} />
        <path d={limb(mirror(legStraight))} />
        {/* anatomical hints */}
        <g strokeWidth={0.7} opacity={0.75}>
          <path d={smooth([[CX - 32, 170], [CX - 16, 182], [CX - 2, 178]])} />
          <path d={smooth([[CX + 32, 170], [CX + 16, 182], [CX + 2, 178]])} />
          <path d={`M${CX},186 L${CX},246`} />
          <path d={smooth([[CX - 16, 204], [CX, 206], [CX + 16, 204]])} />
          <path d={smooth([[CX - 15, 222], [CX, 224], [CX + 15, 222]])} />
          <path d={smooth([[CX - 28, 262], [CX, 276], [CX + 28, 262]])} />
          <path d={smooth([[CX - 42, 156], [CX - 34, 150], [CX - 24, 148]])} />
          <path d={smooth([[CX + 42, 156], [CX + 34, 150], [CX + 24, 148]])} />
          <circle cx={NAVEL[0]} cy={NAVEL[1] + 4} r={1.5} />
        </g>
        <path d={`M${CX - 20},388 L${CX - 4},390 M${CX + 20},388 L${CX + 4},390`} />
      </g>

      {/* heart */}
      <path
        className={`heart${beat ? " beating" : ""}`}
        style={{ animationDuration: beat, transformOrigin: `${CX + 12}px 176px` }}
        d={`M${CX + 12},182 c-6,-4 -9,-7 -9,-10 a4,4 0 0 1 9,-2 a4,4 0 0 1 9,2 c0,3 -3,6 -9,10z`}
      />

      {/* interactive regions with leader lines to margin labels */}
      {regions.map((r) => {
        const a = ANCHORS[r.region];
        if (!a) return null;
        const lx = a.side === "l" ? 10 : 550;
        const elbowX = a.side === "l" ? 112 : 448;
        const has = r.value !== null;
        return (
          <a key={r.region} href={r.href} className={`hotspot${has ? "" : " nodata"}`} aria-label={`${r.label}: ${r.value ?? "no data"}`}>
            <title>{r.title ?? `${r.label}: ${r.value ?? "no data yet"}`}</title>
            <polyline className="leader" points={`${a.at[0]},${a.at[1]} ${elbowX},${a.y} ${a.side === "l" ? 104 : 456},${a.y}`} />
            <circle className="halo" cx={a.at[0]} cy={a.at[1]} r={10} />
            <circle className="marker" cx={a.at[0]} cy={a.at[1]} r={3.6} />
            <text className="label" x={lx} y={a.y - 4} textAnchor={a.side === "l" ? "start" : "end"}>
              {r.label.toUpperCase()}
            </text>
            <text className="value-label" x={lx} y={a.y + 11} textAnchor={a.side === "l" ? "start" : "end"} opacity={has ? 1 : 0.55}>
              {r.value ?? "—"}
            </text>
          </a>
        );
      })}
    </svg>
  );
}

/** Small emblem (circle, square and figure) used on the login screen and sidebar. */
export function VigorMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor">
      <circle cx="20" cy="21" r="17" strokeWidth="1.2" />
      <rect x="6" y="6" width="28" height="28" strokeWidth="1" opacity="0.6" />
      <circle cx="20" cy="11" r="2.6" strokeWidth="1.2" />
      <path d="M20 14v12M8 17h24M20 26l-6 10M20 26l6 10M20 17l-9-6M20 17l9-6" strokeWidth="1.1" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
