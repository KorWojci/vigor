/**
 * One-time (re-runnable) sync: fetches the ExerciseDB free-tier catalog, matches it against your
 * own exercises by name — exact match, else the closest match by word overlap — and caches the
 * matched GIF and muscle data locally under <data>/exercise-media/. Vigor never calls this API
 * at request time (see the invariant on external network calls in AGENTS.md); this script is the
 * one deliberate, offline exception, run by hand whenever you want to (re)fill the cache.
 *
 * Usage: npm run sync:exercise-media [-- --force] [-- --refresh-catalog]
 *   --force            re-match and re-check every exercise, not just ones with no cached media yet
 *   --refresh-catalog   re-download the ~1,500-exercise catalog instead of using the cached copy
 *
 * Exercise media is from oss.exercisedb.dev (AscendAPI / ExerciseDB), free tier: non-commercial
 * use, attribution required (see ATTRIBUTION in src/lib/training/exercise-media.ts, shown in the UI).
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/lib/config";
import { openDatabase } from "../src/lib/db";
import { listExercises } from "../src/lib/training/repo";
import { deleteExerciseMedia, exerciseMediaDir, findBestMatch, getExerciseMedia, upsertExerciseMedia, type ExerciseDbEntry } from "../src/lib/training/exercise-media";

const API_BASE = "https://oss.exercisedb.dev";
const PAGE_LIMIT = 25;
const REQUEST_DELAY_MS = 300; // the API documents only "strict rate limits apply", with no numbers — stay conservative

const force = process.argv.includes("--force");
const refreshCatalog = process.argv.includes("--refresh-catalog");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string | URL, attempt = 1): Promise<Response> {
  const res = await fetch(url);
  if (res.status === 429 && attempt <= 5) {
    const wait = 1000 * attempt;
    console.log(`  rate limited, retrying in ${wait}ms…`);
    await sleep(wait);
    return fetchWithRetry(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

interface ApiExercise {
  exerciseId: string;
  name: string;
  bodyParts?: string[];
  equipments?: string[];
  targetMuscles?: string[];
  secondaryMuscles?: string[];
  gifUrl: string;
}

async function fetchCatalog(): Promise<ExerciseDbEntry[]> {
  const entries: ExerciseDbEntry[] = [];
  let after: string | undefined;
  for (;;) {
    const url = new URL("/api/v1/exercises", API_BASE);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (after) url.searchParams.set("after", after);
    const res = await fetchWithRetry(url);
    const body = (await res.json()) as { data: ApiExercise[]; meta: { total: number; hasNextPage: boolean; nextCursor: string | null } };
    for (const e of body.data) {
      entries.push({
        externalId: e.exerciseId,
        name: e.name,
        bodyParts: e.bodyParts ?? [],
        targetMuscles: e.targetMuscles ?? [],
        secondaryMuscles: e.secondaryMuscles ?? [],
        equipments: e.equipments ?? [],
        gifUrl: e.gifUrl,
      });
    }
    console.log(`Fetched ${entries.length} / ${body.meta.total} catalog exercises…`);
    if (!body.meta.hasNextPage || !body.meta.nextCursor) break;
    after = body.meta.nextCursor;
    await sleep(REQUEST_DELAY_MS);
  }
  return entries;
}

async function loadCatalog(catalogPath: string): Promise<ExerciseDbEntry[]> {
  if (!refreshCatalog && fs.existsSync(catalogPath)) {
    console.log(`Using cached catalog at ${catalogPath} (pass --refresh-catalog to re-fetch).`);
    return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  }
  const entries = await fetchCatalog();
  fs.writeFileSync(catalogPath, JSON.stringify(entries));
  return entries;
}

async function main() {
  const mediaDir = exerciseMediaDir();
  fs.mkdirSync(mediaDir, { recursive: true });
  const catalogPath = path.join(mediaDir, "catalog.json");

  const db = openDatabase(config.dbPath);
  const exercises = listExercises(db);
  const catalog = await loadCatalog(catalogPath);

  let matched = 0;
  let exact = 0;
  let skipped = 0;
  let removed = 0;
  const unmatched: string[] = [];
  const failed: string[] = [];

  for (const ex of exercises) {
    const existing = getExerciseMedia(db, ex.id);
    if (existing && !force) {
      skipped++;
      continue;
    }
    const result = findBestMatch(ex.name, catalog);
    if (!result) {
      if (existing) {
        deleteExerciseMedia(db, ex.id);
        removed++;
        console.log(`  removing stale match for "${ex.name}" (no longer clears the match threshold)`);
      }
      unmatched.push(ex.name);
      continue;
    }
    try {
      const fileName = `${result.entry.externalId}.gif`;
      const filePath = path.join(mediaDir, fileName);
      if (!fs.existsSync(filePath)) {
        const res = await fetchWithRetry(result.entry.gifUrl);
        fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
        await sleep(REQUEST_DELAY_MS);
      }
      upsertExerciseMedia(db, {
        exerciseId: ex.id,
        externalId: result.entry.externalId,
        matchedName: result.entry.name,
        matchScore: result.score,
        bodyParts: result.entry.bodyParts,
        targetMuscles: result.entry.targetMuscles,
        secondaryMuscles: result.entry.secondaryMuscles,
        equipments: result.entry.equipments,
        gifFile: fileName,
      });
      matched++;
      if (result.score === 1) exact++;
      else console.log(`  closest match (${Math.round(result.score * 100)}%): "${ex.name}" → "${result.entry.name}"`);
    } catch (err) {
      // One exercise's GIF asset being missing upstream (404) shouldn't abort the whole sync.
      failed.push(ex.name);
      console.log(`  skipping "${ex.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n${matched} matched (${exact} exact, ${matched - exact} closest-match), ${skipped} already cached, ${removed} stale matches removed, ${unmatched.length} with no reasonable match, ${failed.length} failed to download.`);
  if (unmatched.length) console.log("No match found for: " + unmatched.join(", "));
  if (failed.length) console.log("Download failed for: " + failed.join(", "));
  db.close();
}

main();
