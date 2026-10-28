import { bodyOutline, CX } from "@/lib/figure/body-outline";
import { MUSCLE_ZONE_LABEL, type MuscleZone, type ZoneLoad } from "@/lib/training/muscles";

/**
 * Front and back views of the same body outline used by the dashboard's VitruvianFigure — same
 * paths, same "vitruvian" CSS classes (marker/leader/label), so this reads as the same figure
 * rather than a different drawing. No construction circle/square or ghost pose (those are the
 * dashboard figure's own Da Vinci conceit); just the body, a marker per muscle zone, and a
 * leader line out to a label, exactly like the dashboard's measurement regions.
 */
interface Anchor {
  zone: MuscleZone;
  at: [number, number];
  side: "l" | "r";
  y: number;
}

const FRONT_ANCHORS: Anchor[] = [
  { zone: "chest", at: [CX - 20, 172], side: "l", y: 104 },
  { zone: "biceps", at: [CX - 82, 159], side: "l", y: 144 },
  { zone: "forearms", at: [CX - 120, 160], side: "l", y: 184 },
  { zone: "abs", at: [CX, 210], side: "l", y: 224 },
  { zone: "adductors", at: [CX + 8, 300], side: "l", y: 264 },
  { zone: "shoulders", at: [CX + 38, 155], side: "r", y: 104 },
  { zone: "obliques", at: [CX + 20, 210], side: "r", y: 144 },
  { zone: "hip_flexors", at: [CX + 24, 258], side: "r", y: 184 },
  { zone: "quadriceps", at: [CX - 15, 298], side: "r", y: 224 },
];

const BACK_ANCHORS: Anchor[] = [
  { zone: "lats", at: [CX - 40, 180], side: "l", y: 104 },
  { zone: "triceps", at: [CX - 82, 159], side: "l", y: 144 },
  { zone: "forearms", at: [CX - 120, 160], side: "l", y: 184 },
  { zone: "lower_back", at: [CX, 228], side: "l", y: 224 },
  { zone: "hamstrings", at: [CX - 15, 298], side: "l", y: 264 },
  { zone: "shoulders", at: [CX + 38, 155], side: "r", y: 104 },
  { zone: "upper_back", at: [CX, 170], side: "r", y: 144 },
  { zone: "glutes", at: [CX + 24, 258], side: "r", y: 184 },
  { zone: "calves", at: [CX - 13, 352], side: "r", y: 224 },
];

function Figure({ title, anchors, intensities }: { title: string; anchors: Anchor[]; intensities: ZoneLoad }) {
  const b = bodyOutline();
  return (
    <svg className="vitruvian" viewBox="0 0 560 420" width="100%" style={{ display: "block" }} role="img" aria-labelledby={`${title}-title`}>
      <title id={`${title}-title`}>{title} view — muscle load</title>
      <g className="body" strokeWidth={1.3}>
        <ellipse cx={b.head.cx} cy={b.head.cy} rx={b.head.rx} ry={b.head.ry} />
        <path d={b.neck} />
        <path d={b.torso} />
        <path d={b.armLeft} />
        <path d={b.armRight} />
        <path d={b.legLeft} />
        <path d={b.legRight} />
        <path d={b.feet} />
      </g>

      {anchors.map((a) => {
        const v = intensities[a.zone] ?? 0;
        const has = v > 0;
        const lx = a.side === "l" ? 10 : 550;
        const elbowX = a.side === "l" ? 112 : 448;
        return (
          <g key={a.zone} className={`hotspot${has ? "" : " nodata"}`}>
            <title>{`${MUSCLE_ZONE_LABEL[a.zone]}: ${has ? `${Math.round(v * 100)}%` : "no load today"}`}</title>
            <polyline className="leader" points={`${a.at[0]},${a.at[1]} ${elbowX},${a.y} ${a.side === "l" ? 104 : 456},${a.y}`} />
            <circle className="halo" cx={a.at[0]} cy={a.at[1]} r={10} />
            <circle className="marker" cx={a.at[0]} cy={a.at[1]} r={has ? 3 + v * 3 : 3.6} fillOpacity={has ? 0.5 + v * 0.5 : 1} />
            <text className="label" x={lx} y={a.y - 4} textAnchor={a.side === "l" ? "start" : "end"}>
              {MUSCLE_ZONE_LABEL[a.zone].toUpperCase()}
            </text>
            <text className="value-label" x={lx} y={a.y + 11} textAnchor={a.side === "l" ? "start" : "end"} opacity={has ? 1 : 0.55}>
              {has ? `${Math.round(v * 100)}%` : "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function MuscleFigure({ intensities }: { intensities: ZoneLoad }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 360px", maxWidth: 440 }}>
        <Figure title="Front" anchors={FRONT_ANCHORS} intensities={intensities} />
      </div>
      <div style={{ flex: "1 1 360px", maxWidth: 440 }}>
        <Figure title="Back" anchors={BACK_ANCHORS} intensities={intensities} />
      </div>
    </div>
  );
}
