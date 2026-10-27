import type { RoutePoint } from "@/lib/training/route";

/**
 * Draws a workout's GPS route as a plain line — no street or satellite basemap, which would need
 * tile imagery from an external service (see CLAUDE.md: no external network calls). Just the
 * shape of where you went, to scale, with a start/finish marker and a distance scale bar.
 */
const LAT_METRES = 110_540;
const LON_METRES = 111_320;

export function RouteMap({ route, width = 560, height = 340 }: { route: RoutePoint[]; width?: number; height?: number }) {
  if (route.length < 2) return null;
  const lat0 = route[0].lat;
  const lon0 = route[0].lon;
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
  // Local planar projection in metres, centred on the first point; north is up, east is right.
  const pts = route.map((p) => ({ x: (p.lon - lon0) * LON_METRES * cosLat0, y: -(p.lat - lat0) * LAT_METRES }));

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 1);
  const spanY = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const pad = 30;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);

  const project = (p: { x: number; y: number }): [number, number] => [width / 2 + (p.x - cx) * scale, height / 2 + (p.y - cy) * scale];
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${project(p).map((n) => n.toFixed(1)).join(",")}`).join(" ");
  const [startX, startY] = project(pts[0]);
  const [endX, endY] = project(pts[pts.length - 1]);

  const span = Math.max(spanX, spanY);
  const barM = span > 4000 ? 1000 : span > 1500 ? 500 : span > 400 ? 200 : 100;
  const barPx = barM * scale;
  const barLabel = barM >= 1000 ? `${barM / 1000} km` : `${barM} m`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, display: "block", margin: "0 auto" }}>
      <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={startX} cy={startY} r={5} fill="var(--chart-3)"><title>Start</title></circle>
      <circle cx={endX} cy={endY} r={5} fill="var(--chart-4)"><title>Finish</title></circle>
      <g transform={`translate(${pad}, ${height - 14})`}>
        <line x1={0} y1={0} x2={barPx} y2={0} stroke="var(--ink-faint)" strokeWidth={1.5} />
        <line x1={0} y1={-4} x2={0} y2={4} stroke="var(--ink-faint)" strokeWidth={1.5} />
        <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke="var(--ink-faint)" strokeWidth={1.5} />
        <text x={barPx / 2} y={-8} textAnchor="middle" fontSize={10} fill="var(--ink-faint)">{barLabel}</text>
      </g>
    </svg>
  );
}
