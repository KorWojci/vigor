import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  hiddenWidgets,
  layoutFromLegacyTiles,
  moveWidget,
  normalizeLayout,
  nudgeWidget,
  WIDGETS,
} from "@/lib/dashboard-layout";
import { getDashboardLayout, setSetting } from "@/lib/settings";
import { testDb } from "./helpers";

describe("dashboard layout", () => {
  it("normalizes untrusted input", () => {
    expect(normalizeLayout({ left: ["steps", "nope", "steps", 3], right: ["steps", "hrv"], below: "x" })).toEqual({ left: ["steps"], right: ["hrv"], below: [] });
    expect(normalizeLayout(null)).toEqual({ left: [], right: [], below: [] });
  });

  it("moves within a zone, across zones and to hidden", () => {
    const l = { left: ["a", "steps", "sleep", "hrv"].filter((k) => k !== "a"), right: ["vo2max"], below: [] };
    expect(moveWidget(l, "steps", "left", 3).left).toEqual(["sleep", "hrv", "steps"]);
    expect(moveWidget(l, "hrv", "left", 0).left).toEqual(["hrv", "steps", "sleep"]);
    const across = moveWidget(l, "sleep", "right", 0);
    expect(across).toEqual({ left: ["steps", "hrv"], right: ["sleep", "vo2max"], below: [] });
    const hidden = moveWidget(l, "steps", "hidden");
    expect(hidden.left).toEqual(["sleep", "hrv"]);
    expect(hiddenWidgets(hidden)).toContain("steps");
    expect(moveWidget(l, "unknown", "left")).toBe(l);
  });

  it("nudges up/down and crosses zone boundaries", () => {
    const l = { left: ["steps", "sleep"], right: ["hrv"], below: [] as string[] };
    expect(nudgeWidget(l, "sleep", -1).left).toEqual(["sleep", "steps"]);
    expect(nudgeWidget(l, "sleep", 1)).toEqual({ left: ["steps"], right: ["sleep", "hrv"], below: [] });
    expect(nudgeWidget(l, "hrv", -1)).toEqual({ left: ["steps", "sleep", "hrv"], right: [], below: [] });
    expect(nudgeWidget(l, "steps", -1)).toEqual(l);
  });

  it("converts the legacy visible-tiles setting", () => {
    const l = layoutFromLegacyTiles(["weight", "steps", "sleep", "training"]);
    expect(l).toEqual({ left: ["weight", "sleep"], right: ["steps"], below: ["training", "weight_chart", "sleep_chart"] });
  });

  it("defaults reference only known widgets and hide the rest", () => {
    expect(normalizeLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
    expect(hiddenWidgets(DEFAULT_LAYOUT).length).toBe(WIDGETS.length - 12);
  });

  it("is stored in settings, falling back to the legacy setting", () => {
    const db = testDb();
    expect(getDashboardLayout(db)).toEqual(DEFAULT_LAYOUT);
    setSetting(db, "dashboardTiles", ["hrv"]);
    expect(getDashboardLayout(db).right).toEqual([]);
    expect(getDashboardLayout(db).left).toEqual(["hrv"]);
    setSetting(db, "dashboardLayout", { left: [], right: ["steps"], below: [] });
    expect(getDashboardLayout(db)).toEqual({ left: [], right: ["steps"], below: [] });
  });
});
