import { formatDateTime } from "@/lib/time";

/**
 * One night's sleep stages over time, styled after Apple Health's own sleep chart (resources/Sleep.png):
 * a row per stage (Awake at top, down to Deep), each occurrence of that stage drawn as a rounded
 * vertical bar sized to its actual duration and positioned at its actual clock time, with a faint
 * connecting line threading through consecutive segments so the night reads as one continuous path.
 * Hand-rolled SVG (no client JS), matching VitruvianFigure/RouteMap elsewhere in the app.
 */
export interface SleepSegment {
  category: string;
  startMs: number;
  endMs: number;
}

const STAGE_LABEL: Record<string, string> = { awake: "Awake", asleep_rem: "REM", asleep_core: "Core", asleep_deep: "Deep", asleep_unspecified: "Asleep" };
/** Top-to-bottom row order, matching the usual clinical hypnogram convention (lightest at top). */
const STAGE_ORDER = ["Awake", "REM", "Core", "Asleep", "Deep"];
const STAGE_COLOR: Record<string, string> = { Awake: "var(--chart-4)", REM: "var(--chart-3)", Core: "var(--chart-1)", Asleep: "var(--chart-5)", Deep: "var(--chart-2)" };

const ROW_H = 46;
const ROW_LABEL_W = 58;
const PAD_RIGHT = 10;
const PAD_TOP = 6;
const AXIS_H = 22;
const PILL_H_FRAC = 0.6;
const MIN_PILL_W = 4;

/** A "nice" hour step (1/2/3/4/6/12) that keeps roughly 4-6 ticks across the night. */
function hourStep(spanHours: number): number {
  const steps = [1, 2, 3, 4, 6, 12];
  return steps.find((s) => spanHours / s <= 5) ?? 12;
}

export function SleepHypnogram({ segments, startMs, endMs, tz, width = 760 }: { segments: SleepSegment[]; startMs: number; endMs: number; tz: string; width?: number }) {
  if (segments.length === 0) return <p className="muted small">No staged sleep data for this night.</p>;

  const rows = STAGE_ORDER.filter((label) => segments.some((s) => (STAGE_LABEL[s.category] ?? s.category) === label));
  const plotW = width - ROW_LABEL_W - PAD_RIGHT;
  const plotH = rows.length * ROW_H;
  const height = PAD_TOP + plotH + AXIS_H;
  const span = Math.max(1, endMs - startMs);
  const x = (ms: number) => ROW_LABEL_W + ((ms - startMs) / span) * plotW;
  const rowY = (label: string) => PAD_TOP + rows.indexOf(label) * ROW_H;
  const clock = (ms: number) => formatDateTime(ms, tz).split(", ")[1];

  const pills = segments.map((s) => {
    const label = STAGE_LABEL[s.category] ?? s.category;
    const x1 = x(s.startMs);
    const w = Math.max(MIN_PILL_W, x(s.endMs) - x1);
    const yTop = rowY(label) + (ROW_H * (1 - PILL_H_FRAC)) / 2;
    const h = ROW_H * PILL_H_FRAC;
    return { label, x1, w, yTop, h, yMid: yTop + h / 2, startMs: s.startMs, endMs: s.endMs };
  });

  // A faint path threading through every segment's midpoint, in time order, so the night reads as one track.
  const threadPoints = pills.flatMap((p) => [`${p.x1},${p.yMid}`, `${p.x1 + p.w},${p.yMid}`]).join(" ");

  // Round-hour gridlines.
  const spanHours = span / 3_600_000;
  const step = hourStep(spanHours);
  const ticks: number[] = [];
  const first = Math.ceil(startMs / (step * 3_600_000)) * step * 3_600_000;
  for (let t = first; t < endMs; t += step * 3_600_000) ticks.push(t);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block", overflow: "visible" }} role="img" aria-label="Sleep stages over the night">
      {rows.map((label, i) => (
        <g key={label}>
          <text x={0} y={PAD_TOP + i * ROW_H + ROW_H / 2} dy="0.35em" className="hypnogram-label">{label}</text>
          <line x1={0} y1={PAD_TOP + (i + 1) * ROW_H} x2={width - PAD_RIGHT} y2={PAD_TOP + (i + 1) * ROW_H} className="hypnogram-row-line" />
        </g>
      ))}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={PAD_TOP} x2={x(t)} y2={PAD_TOP + plotH} className="hypnogram-tick-line" />
          <text x={x(t)} y={PAD_TOP + plotH + 16} textAnchor="middle" className="hypnogram-tick-label">{clock(t)}</text>
        </g>
      ))}
      <polyline points={threadPoints} className="hypnogram-thread" fill="none" />
      {pills.map((p, i) => (
        <rect key={i} x={p.x1} y={p.yTop} width={p.w} height={p.h} rx={Math.min(p.w / 2, 9)} fill={STAGE_COLOR[p.label] ?? "var(--chart-1)"}>
          <title>{`${p.label}: ${clock(p.startMs)} – ${clock(p.endMs)}`}</title>
        </rect>
      ))}
    </svg>
  );
}
