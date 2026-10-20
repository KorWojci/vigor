/**
 * Dashboard layout: which widgets are shown, in which zone, in which order.
 * Pure functions only — shared by the server (validation, rendering) and the client editor.
 *
 * Zones: "left" and "right" flank the figure; "below" is the grid under it.
 * A widget that appears in no zone is hidden.
 */
export const ZONES = ["left", "right", "below"] as const;
export type Zone = (typeof ZONES)[number];
export type DashboardLayout = Record<Zone, string[]>;

export const ZONE_LABELS: Record<Zone | "hidden", string> = {
  left: "Left of the figure",
  right: "Right of the figure",
  below: "Below the figure",
  hidden: "Hidden",
};

export interface WidgetDef {
  key: string;
  label: string;
  /** tile = one metric card; panel = wider card with a chart or list */
  kind: "tile" | "panel";
  /** metric key for tile widgets */
  metric?: string;
}

export const WIDGETS: WidgetDef[] = [
  { key: "weight", label: "Body weight", kind: "tile", metric: "body_mass" },
  { key: "body_fat", label: "Body fat", kind: "tile", metric: "body_fat_percentage" },
  { key: "lean_mass", label: "Lean body mass", kind: "tile", metric: "lean_body_mass" },
  { key: "steps", label: "Steps", kind: "tile", metric: "step_count" },
  { key: "distance", label: "Walking + running distance", kind: "tile", metric: "distance_walking_running" },
  { key: "active_energy", label: "Active energy", kind: "tile", metric: "active_energy" },
  { key: "exercise", label: "Exercise minutes", kind: "tile", metric: "exercise_time" },
  { key: "sleep", label: "Sleep", kind: "tile", metric: "sleep_analysis" },
  { key: "resting_hr", label: "Resting heart rate", kind: "tile", metric: "resting_heart_rate" },
  { key: "hrv", label: "Heart rate variability", kind: "tile", metric: "heart_rate_variability" },
  { key: "vo2max", label: "VO₂ max", kind: "tile", metric: "vo2_max" },
  { key: "spo2", label: "Blood oxygen", kind: "tile", metric: "oxygen_saturation" },
  { key: "respiratory_rate", label: "Respiratory rate", kind: "tile", metric: "respiratory_rate" },
  { key: "calories_in", label: "Dietary energy", kind: "tile", metric: "dietary_energy" },
  { key: "water", label: "Water", kind: "tile", metric: "dietary_water" },
  { key: "training", label: "Training summary", kind: "panel" },
  { key: "weight_chart", label: "Body weight chart", kind: "panel" },
  { key: "sleep_chart", label: "Sleep chart", kind: "panel" },
  { key: "nutrition", label: "Nutrition summary", kind: "panel" },
];

const WIDGET_KEYS = new Set(WIDGETS.map((w) => w.key));

export function getWidget(key: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.key === key);
}

export const DEFAULT_LAYOUT: DashboardLayout = {
  left: ["weight", "steps", "sleep", "hrv"],
  right: ["body_fat", "active_energy", "resting_hr", "vo2max"],
  below: ["training", "weight_chart", "sleep_chart", "nutrition"],
};

/** Drops unknown keys and duplicates (first occurrence wins). Never throws. */
export function normalizeLayout(input: unknown): DashboardLayout {
  const seen = new Set<string>();
  const out: DashboardLayout = { left: [], right: [], below: [] };
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const zone of ZONES) {
    const list = Array.isArray(src[zone]) ? (src[zone] as unknown[]) : [];
    for (const k of list) {
      if (typeof k === "string" && WIDGET_KEYS.has(k) && !seen.has(k)) {
        seen.add(k);
        out[zone].push(k);
      }
    }
  }
  return out;
}

/**
 * Converts the pre-layout setting (an ordered list of visible tile keys) into a layout:
 * metric tiles alternate left/right around the figure (max 4 each), the rest go below.
 */
export function layoutFromLegacyTiles(tiles: string[]): DashboardLayout {
  const out: DashboardLayout = { left: [], right: [], below: [] };
  const metricTiles = tiles.filter((k) => getWidget(k)?.kind === "tile");
  metricTiles.forEach((k, i) => {
    if (i < 8) (i % 2 === 0 ? out.left : out.right).push(k);
    else out.below.push(k);
  });
  // Charts were always shown; the training and nutrition panels followed their checkbox.
  for (const k of ["training", "weight_chart", "sleep_chart", "nutrition"]) {
    if (k === "training" || k === "nutrition" ? tiles.includes(k) : true) out.below.push(k);
  }
  return normalizeLayout(out);
}

export function hiddenWidgets(layout: DashboardLayout): string[] {
  const shown = new Set(ZONES.flatMap((z) => layout[z]));
  return WIDGETS.filter((w) => !shown.has(w.key)).map((w) => w.key);
}

export function locate(layout: DashboardLayout, key: string): { zone: Zone; index: number } | null {
  for (const zone of ZONES) {
    const index = layout[zone].indexOf(key);
    if (index >= 0) return { zone, index };
  }
  return null;
}

/**
 * Moves `key` to `zone` at `index` (clamped; omitted = end). `zone: "hidden"` hides it.
 * Returns a new layout; the input is not modified.
 */
export function moveWidget(layout: DashboardLayout, key: string, zone: Zone | "hidden", index?: number): DashboardLayout {
  if (!WIDGET_KEYS.has(key)) return layout;
  const from = locate(layout, key);
  const next: DashboardLayout = { left: layout.left.filter((k) => k !== key), right: layout.right.filter((k) => k !== key), below: layout.below.filter((k) => k !== key) };
  if (zone === "hidden") return next;
  let at = index ?? next[zone].length;
  // Moving down within the same zone: the removal shifted later items up by one.
  if (from && from.zone === zone && index !== undefined && index > from.index) at -= 1;
  at = Math.max(0, Math.min(at, next[zone].length));
  next[zone].splice(at, 0, key);
  return next;
}

/** Moves a widget one step up/down within its zone, crossing into the neighbouring zone at the edges. */
export function nudgeWidget(layout: DashboardLayout, key: string, dir: -1 | 1): DashboardLayout {
  const pos = locate(layout, key);
  if (!pos) return layout;
  const target = pos.index + dir;
  if (target >= 0 && target < layout[pos.zone].length) return moveWidget(layout, key, pos.zone, dir === 1 ? target + 1 : target);
  const zi = ZONES.indexOf(pos.zone) + dir;
  if (zi < 0 || zi >= ZONES.length) return layout;
  const zone = ZONES[zi];
  return moveWidget(layout, key, zone, dir === 1 ? 0 : layout[zone].length);
}
