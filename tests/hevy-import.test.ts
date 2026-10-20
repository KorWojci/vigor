import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importHevyCsv, parseHevyTime } from "@/lib/training/hevy-import";
import { estimate1RM, inferKind, sessionStats } from "@/lib/training/calculations";
import { getExerciseHistory, listExercises, listWorkouts, mergeExercises } from "@/lib/training/repo";
import { testDb } from "./helpers";

const csv = fs.readFileSync(path.join(__dirname, "../samples/hevy-workouts-synthetic.csv"), "utf8");
const TZ = "Europe/Warsaw";

describe("Hevy CSV import", () => {
  it("imports workouts, exercises and sets", () => {
    const db = testDb();
    const res = importHevyCsv(db, csv, { tz: TZ });
    expect(res).toMatchObject({ workouts: 3, accepted: 3, updated: 0, skipped: 0, rejected: 0 });
    const exercises = listExercises(db);
    const byName = Object.fromEntries(exercises.map((e) => [e.name, e]));
    expect(byName["Bench Press (Barbell)"].kind).toBe("weighted");
    expect(byName["Pull Up"].kind).toBe("bodyweight");
    expect(byName["Plank"].kind).toBe("duration");
    expect(byName["Assisted Dip"].kind).toBe("assisted");
    expect(byName["Bench Press (Barbell)"].sessions).toBe(2);
  });

  it("does not duplicate workouts on re-import and detects changes", () => {
    const db = testDb();
    importHevyCsv(db, csv, { tz: TZ });
    const again = importHevyCsv(db, csv, { tz: TZ });
    expect(again).toMatchObject({ accepted: 0, skipped: 3 });
    const changed = csv.replace('"72.5","6"', '"72.5","7"');
    expect(importHevyCsv(db, changed, { tz: TZ })).toMatchObject({ updated: 1, skipped: 2 });
    expect(listWorkouts(db, 0, Date.now() * 2)).toHaveLength(3);
  });

  it("optionally removes workouts missing from a newer export", () => {
    const db = testDb();
    importHevyCsv(db, csv, { tz: TZ });
    const withoutUpperB = csv.split("\n").filter((l) => !l.includes("Upper B")).join("\n");
    expect(importHevyCsv(db, withoutUpperB, { tz: TZ, removeMissing: true }).deleted).toBe(1);
  });

  it("computes history, e1RM and personal records", () => {
    const db = testDb();
    importHevyCsv(db, csv, { tz: TZ });
    const bench = listExercises(db).find((e) => e.name === "Bench Press (Barbell)")!;
    const h = getExerciseHistory(db, bench.id)!;
    expect(h.sessions).toHaveLength(2);
    expect(h.sessions[0].stats.workingSets).toBe(2); // warm-up excluded
    expect(h.sessions[0].stats.volumeKg).toBe(70 * 8 + 70 * 7);
    const e1rm = h.records.find((r) => r.label === "Estimated 1RM")!;
    expect(e1rm.value).toBeCloseTo(72.5 * (1 + 8 / 30));
  });

  it("merges exercises and remembers the alias", () => {
    const db = testDb();
    importHevyCsv(db, csv, { tz: TZ });
    const ex = listExercises(db);
    const pull = ex.find((e) => e.name === "Pull Up")!;
    const bench = ex.find((e) => e.name === "Bench Press (Barbell)")!;
    mergeExercises(db, pull.id, bench.id);
    importHevyCsv(db, csv.replace(/Upper B/g, "Upper C"), { tz: TZ });
    expect(listExercises(db).find((e) => e.name === "Pull Up")).toBeUndefined();
  });

  it("rejects files that are not Hevy exports", () => {
    const db = testDb();
    expect(() => importHevyCsv(db, "a,b\n1,2", { tz: TZ })).toThrow(/Not a Hevy workout export/);
  });
});

describe("Hevy timestamps", () => {
  it("parses local wall time in the configured zone", () => {
    expect(parseHevyTime("20 Oct 2026, 07:05", "UTC")).toBe(Date.parse("2026-10-20T07:05:00Z"));
    expect(parseHevyTime("20 Oct 2026, 07:05", "Europe/Warsaw")).toBe(Date.parse("2026-10-20T05:05:00Z"));
    expect(parseHevyTime("Oct 20, 2026 7:05 PM", "UTC")).toBe(Date.parse("2026-10-20T19:05:00Z"));
    expect(parseHevyTime("2026-01-20 07:05:00", "Europe/Warsaw")).toBe(Date.parse("2026-01-20T06:05:00Z"));
    expect(parseHevyTime("nonsense", "UTC")).toBeNull();
  });
});

describe("training calculations", () => {
  it("estimates 1RM with Epley within the supported rep range", () => {
    expect(estimate1RM(100, 1)).toBe(100);
    expect(estimate1RM(100, 10)).toBeCloseTo(133.33, 1);
    expect(estimate1RM(100, 20)).toBeNull();
    expect(estimate1RM(null, 5)).toBeNull();
  });

  it("infers exercise kinds", () => {
    expect(inferKind("Pull Up (Weighted)", [{ setType: "normal", weightKg: 10, reps: 5, distanceM: null, durationS: null }])).toBe("weighted_bodyweight");
    expect(inferKind("Rowing", [{ setType: "normal", weightKg: null, reps: null, distanceM: 2000, durationS: 480 }])).toBe("distance");
  });

  it("uses reps and least assistance for assisted exercises", () => {
    const s = sessionStats("assisted", [
      { setType: "normal", weightKg: 30, reps: 8, distanceM: null, durationS: null },
      { setType: "normal", weightKg: 20, reps: 8, distanceM: null, durationS: null },
    ]);
    expect(s.minAssistanceKg).toBe(20);
    expect(s.volumeKg).toBe(0);
    expect(s.topSet?.weightKg).toBe(20);
  });
});
