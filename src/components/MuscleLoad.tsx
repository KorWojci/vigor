import { MUSCLE_ZONE_LABEL, type MuscleZone } from "@/lib/training/muscles";

/** Muscle zones worked in a workout, ranked by estimated load. Plain bars, no body diagram. */
export function MuscleLoad({ intensities }: { intensities: Partial<Record<MuscleZone, number>> }) {
  const sorted = (Object.entries(intensities) as [MuscleZone, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ maxWidth: 360 }}>
      {sorted.map(([zone, v]) => (
        <div key={zone} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="small" style={{ width: 110, flexShrink: 0 }}>{MUSCLE_ZONE_LABEL[zone]}</span>
          <div style={{ flexGrow: 1, height: 8, background: "var(--ink-faint)", opacity: 0.15, borderRadius: 4 }}>
            <div style={{ height: 8, width: `${v * 100}%`, minWidth: v > 0 ? 2 : 0, background: "var(--chart-1)", borderRadius: 4 }} />
          </div>
          <span className="tiny faint num" style={{ width: 32, textAlign: "right" }}>{Math.round(v * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
