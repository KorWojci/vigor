import { describe, expect, it } from "vitest";
import { deleteExerciseMedia, findBestMatch, getExerciseMedia, listExerciseMedia, nameSimilarity, upsertExerciseMedia, type ExerciseDbEntry } from "@/lib/training/exercise-media";
import { testDb } from "./helpers";

function insertExercise(db: ReturnType<typeof testDb>, id: number, name: string) {
  db.prepare("INSERT INTO exercises (id, name, normalized_name, kind, kind_locked, created_at) VALUES (?, ?, ?, 'weighted', 0, ?)").run(id, name, name.toLowerCase(), Date.now());
}

const CATALOG: ExerciseDbEntry[] = [
  { externalId: "A1", name: "barbell bench press", bodyParts: ["chest"], targetMuscles: ["pectorals"], secondaryMuscles: ["triceps"], equipments: ["barbell"], gifUrl: "https://static.exercisedb.dev/media/A1.gif" },
  { externalId: "A2", name: "pull up", bodyParts: ["back"], targetMuscles: ["latissimus dorsi"], secondaryMuscles: ["biceps"], equipments: ["body weight"], gifUrl: "https://static.exercisedb.dev/media/A2.gif" },
  { externalId: "A3", name: "plank", bodyParts: ["waist"], targetMuscles: ["abdominals"], secondaryMuscles: [], equipments: ["body weight"], gifUrl: "https://static.exercisedb.dev/media/A3.gif" },
];

describe("nameSimilarity / findBestMatch", () => {
  it("scores identical token sets as 1 regardless of word order or parens", () => {
    expect(nameSimilarity("Bench Press (Barbell)", "barbell bench press")).toBe(1);
  });

  it("tolerates simple plurals", () => {
    expect(nameSimilarity("Pull Up", "pull ups")).toBeGreaterThan(0.9);
  });

  it("finds the exact match when one exists", () => {
    const result = findBestMatch("Pull Up", CATALOG);
    expect(result?.entry.externalId).toBe("A2");
    expect(result?.score).toBe(1);
  });

  it("falls back to the closest match when there's no exact hit", () => {
    const result = findBestMatch("Bench Press (Barbell)", CATALOG);
    expect(result?.entry.externalId).toBe("A1");
    expect(result?.score).toBe(1); // token sets match even though the catalog name is "barbell bench press"
  });

  it("returns null rather than a bad guess when nothing is close", () => {
    expect(findBestMatch("Nordic Hamstring Curl", CATALOG)).toBeNull();
  });

  it("rejects a match that only shares one incidental word between otherwise unrelated exercises", () => {
    // Real example found in production: "Bird Dog" (core stability) vs "upward facing dog" (a
    // stretch) share only the word "dog" — scores 0.4, well under the threshold.
    const catalog: ExerciseDbEntry[] = [{ externalId: "B1", name: "upward facing dog", bodyParts: [], targetMuscles: [], secondaryMuscles: [], equipments: [], gifUrl: "" }];
    expect(nameSimilarity("Bird Dog", "upward facing dog")).toBeLessThan(0.5);
    expect(findBestMatch("Bird Dog", catalog)).toBeNull();
  });
});

describe("exercise_media cache", () => {
  it("round-trips through the database, including JSON array columns", () => {
    const db = testDb();
    insertExercise(db, 1, "Bench Press (Barbell)");
    upsertExerciseMedia(db, {
      exerciseId: 1,
      externalId: "A1",
      matchedName: "barbell bench press",
      matchScore: 1,
      bodyParts: ["chest"],
      targetMuscles: ["pectorals"],
      secondaryMuscles: ["triceps"],
      equipments: ["barbell"],
      gifFile: "A1.gif",
    });
    const media = getExerciseMedia(db, 1);
    expect(media).toMatchObject({ exerciseId: 1, externalId: "A1", targetMuscles: ["pectorals"], gifFile: "A1.gif" });
    expect(getExerciseMedia(db, 999)).toBeNull();
  });

  it("upsert replaces the previous match for the same exercise", () => {
    const db = testDb();
    insertExercise(db, 1, "Bench Press (Barbell)");
    upsertExerciseMedia(db, { exerciseId: 1, externalId: "A1", matchedName: "x", matchScore: 0.4, bodyParts: [], targetMuscles: [], secondaryMuscles: [], equipments: [], gifFile: "A1.gif" });
    upsertExerciseMedia(db, { exerciseId: 1, externalId: "A2", matchedName: "y", matchScore: 1, bodyParts: [], targetMuscles: [], secondaryMuscles: [], equipments: [], gifFile: "A2.gif" });
    expect(getExerciseMedia(db, 1)).toMatchObject({ externalId: "A2", matchScore: 1 });
  });

  it("lists media for several exercises at once, keyed by exercise id", () => {
    const db = testDb();
    insertExercise(db, 1, "Bench Press (Barbell)");
    insertExercise(db, 2, "Pull Up");
    upsertExerciseMedia(db, { exerciseId: 1, externalId: "A1", matchedName: "x", matchScore: 1, bodyParts: [], targetMuscles: ["pectorals"], secondaryMuscles: [], equipments: [], gifFile: "A1.gif" });
    upsertExerciseMedia(db, { exerciseId: 2, externalId: "A2", matchedName: "y", matchScore: 1, bodyParts: [], targetMuscles: ["latissimus dorsi"], secondaryMuscles: [], equipments: [], gifFile: "A2.gif" });
    const map = listExerciseMedia(db, [1, 2, 3]);
    expect(map.size).toBe(2);
    expect(map.get(1)?.targetMuscles).toEqual(["pectorals"]);
    expect(map.has(3)).toBe(false);
  });

  it("deleteExerciseMedia removes a cached match (e.g. when a tightened threshold no longer accepts it)", () => {
    const db = testDb();
    insertExercise(db, 1, "Bird Dog");
    upsertExerciseMedia(db, { exerciseId: 1, externalId: "B1", matchedName: "upward facing dog", matchScore: 0.4, bodyParts: [], targetMuscles: [], secondaryMuscles: [], equipments: [], gifFile: "B1.gif" });
    deleteExerciseMedia(db, 1);
    expect(getExerciseMedia(db, 1)).toBeNull();
  });
});
