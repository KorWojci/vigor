import { describe, expect, it } from "vitest";
import { DEFAULT_TODAY_LAYOUT, moveTodayMetric, normalizeTodayLayout, nudgeTodayMetric, TODAY_SECTION_METRICS } from "@/lib/today-layout";
import { getTodayLayout, setSetting } from "@/lib/settings";
import { testDb } from "./helpers";

describe("today layout", () => {
  it("normalizes untrusted input, dropping unknown and cross-section keys and appending the rest to 'more'", () => {
    const out = normalizeTodayLayout({
      activity: { visible: ["step_count", "nope", "step_count"], more: ["dietary_water"] }, // cross-section key dropped
      nutrition: "not an object",
    });
    expect(out.activity.visible).toEqual(["step_count"]);
    // every other activity metric lands in "more", in catalog order
    expect(out.activity.more).toEqual(TODAY_SECTION_METRICS.activity.filter((k) => k !== "step_count"));
    expect(out.nutrition.visible).toEqual([]);
    expect(out.nutrition.more).toEqual(TODAY_SECTION_METRICS.nutrition);
  });

  it("moves a metric within a column, across columns, and is a no-op for an unknown key", () => {
    const l = normalizeTodayLayout({ activity: { visible: ["step_count", "active_energy"], more: ["exercise_time"] } });
    expect(moveTodayMetric(l, "activity", "active_energy", "visible", 0).activity.visible).toEqual(["active_energy", "step_count"]);
    const moved = moveTodayMetric(l, "activity", "exercise_time", "visible", 0);
    expect(moved.activity).toEqual({ visible: ["exercise_time", "step_count", "active_energy"], more: ["distance_walking_running", "basal_energy", "flights_climbed", "stand_hours"] });
    expect(moveTodayMetric(l, "activity", "dietary_water", "visible")).toBe(l); // not in this section's catalog
  });

  it("nudges up/down and crosses the visible/more boundary", () => {
    const l = normalizeTodayLayout({ activity: { visible: ["step_count", "active_energy"], more: ["exercise_time"] } });
    expect(nudgeTodayMetric(l, "activity", "active_energy", -1).activity.visible).toEqual(["active_energy", "step_count"]);
    const crossed = nudgeTodayMetric(l, "activity", "active_energy", 1);
    expect(crossed.activity).toEqual({
      visible: ["step_count"],
      more: ["active_energy", "exercise_time", "distance_walking_running", "basal_energy", "flights_climbed", "stand_hours"],
    });
    expect(nudgeTodayMetric(l, "activity", "step_count", -1)).toBe(l); // already first, nothing before "visible"
  });

  it("defaults reference only known per-section metrics and cover every one of them", () => {
    for (const section of Object.keys(DEFAULT_TODAY_LAYOUT) as (keyof typeof DEFAULT_TODAY_LAYOUT)[]) {
      const all = [...DEFAULT_TODAY_LAYOUT[section].visible, ...DEFAULT_TODAY_LAYOUT[section].more];
      expect(new Set(all)).toEqual(new Set(TODAY_SECTION_METRICS[section]));
    }
    expect(DEFAULT_TODAY_LAYOUT.activity.visible).toContain("distance_walking_running");
  });

  it("is stored in settings, falling back to the default", () => {
    const db = testDb();
    expect(getTodayLayout(db)).toEqual(DEFAULT_TODAY_LAYOUT);
    // The editor always submits the full current layout, so a save normally covers every section;
    // a section genuinely absent from the saved payload defaults conservatively to "nothing visible".
    setSetting(db, "todayLayout", normalizeTodayLayout({ activity: { visible: ["active_energy"], more: [] } }));
    expect(getTodayLayout(db).activity.visible).toEqual(["active_energy"]);
    expect(getTodayLayout(db).nutrition).toEqual({ visible: [], more: TODAY_SECTION_METRICS.nutrition });
  });
});
