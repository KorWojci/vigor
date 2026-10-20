/**
 * Database migrations. Each migration runs once, in order, inside a transaction.
 * Never edit a migration that has shipped — append a new one instead.
 *
 * Conventions:
 *  - timestamps are integer epoch milliseconds (UTC);
 *  - numeric values are stored in the metric's canonical unit (see src/lib/metrics/catalog.ts);
 *  - rows that came from a sync source are soft-deleted (deleted_at) so deletions are auditable
 *    and re-sends of a deleted sample can be recognised.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                -- sha256 of the session token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                 -- JSON
);

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,    -- sha256 of the token; the token itself is never stored
  token_prefix TEXT NOT NULL,         -- first characters, for identification in the UI
  scope TEXT NOT NULL DEFAULT 'health:import',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'health' | 'hevy'
  source TEXT NOT NULL,
  sync_id TEXT,
  payload_hash TEXT,
  status TEXT NOT NULL,               -- 'success' | 'partial' | 'failed' | 'rejected'
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  received INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  payload_bytes INTEGER,
  error TEXT,
  details TEXT,                       -- JSON (first rejections, client info)
  token_id INTEGER
);
CREATE INDEX idx_import_runs_kind_started ON import_runs(kind, started_at);
CREATE INDEX idx_import_runs_sync_id ON import_runs(sync_id);

CREATE TABLE health_samples (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL,
  category TEXT,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  source TEXT NOT NULL,               -- integration that delivered it (e.g. 'vigor-ios', 'apple-shortcuts')
  source_name TEXT,                   -- originating app / device (e.g. 'Apple Watch')
  source_bundle TEXT,
  device TEXT,
  external_id TEXT NOT NULL,          -- HealthKit UUID, or 'derived:<hash>' when the source has none
  external_id_derived INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  metadata TEXT,
  import_run_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (external_id)
);
CREATE INDEX idx_samples_type_start ON health_samples(type, start_ms);
CREATE INDEX idx_samples_source_type_start ON health_samples(source, type, start_ms);

CREATE TABLE sync_cursors (
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  cursor TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source, scope)
);

CREATE TABLE sync_client_status (
  source TEXT PRIMARY KEY,
  reported_at INTEGER NOT NULL,
  pending_samples INTEGER,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  details TEXT
);

CREATE TABLE workouts (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,               -- 'hevy' | integration id for Apple Health workouts
  external_id TEXT NOT NULL UNIQUE,
  title TEXT,
  activity_type TEXT,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER,
  duration_s REAL,
  energy_kcal REAL,
  distance_m REAL,
  avg_hr REAL,
  max_hr REAL,
  source_name TEXT,
  notes TEXT,
  metadata TEXT,
  content_hash TEXT NOT NULL,
  import_run_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_workouts_start ON workouts(start_ms);

CREATE TABLE exercises (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'weighted',   -- weighted | bodyweight | weighted_bodyweight | assisted | duration | distance
  kind_locked INTEGER NOT NULL DEFAULT 0,  -- 1 when the user chose the kind manually
  created_at INTEGER NOT NULL
);

CREATE TABLE exercise_aliases (
  alias_normalized TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE
);

CREATE TABLE workout_exercises (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_title TEXT NOT NULL,
  superset_id TEXT,
  notes TEXT
);
CREATE INDEX idx_workout_exercises_exercise ON workout_exercises(exercise_id);
CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id);

CREATE TABLE exercise_sets (
  id INTEGER PRIMARY KEY,
  workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_index INTEGER NOT NULL,
  set_type TEXT NOT NULL DEFAULT 'normal',  -- normal | warmup | failure | dropset
  weight_kg REAL,
  reps INTEGER,
  distance_m REAL,
  duration_s REAL,
  rpe REAL
);
CREATE INDEX idx_exercise_sets_we ON exercise_sets(workout_exercise_id);

CREATE TABLE measurement_types (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  dimension TEXT NOT NULL,            -- length | mass | percent
  region TEXT,                        -- figure region (see src/lib/body/regions.ts)
  builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL
);

CREATE TABLE body_measurements (
  id INTEGER PRIMARY KEY,
  type_key TEXT NOT NULL REFERENCES measurement_types(key) ON DELETE CASCADE,
  value REAL NOT NULL,                -- canonical unit: cm, kg or %
  measured_at INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_body_measurements_type_time ON body_measurements(type_key, measured_at);
`,
  },
];
