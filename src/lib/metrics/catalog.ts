/**
 * Metric catalog — the single place where health metric types are defined.
 *
 * Adding a metric: append a definition here (and, for the iOS companion, a mapping in
 * ios/VigorSync/Sources/HealthTypes.swift). No schema change is needed: samples of any
 * catalogued type are stored in `health_samples`.
 *
 * aggregation
 *  - "sum":    cumulative quantities (steps, energy, nutrients). Daily value = total for the day.
 *  - "avg":    discrete measurements (heart rate, SpO₂). Daily value = mean (min/max kept too).
 *  - "latest": slowly changing measurements (weight, VO₂ max). Daily value = last reading.
 *  - "sleep":  category samples with sleep stages; see src/lib/aggregation/sleep.ts.
 *
 * overlap (only for "sum")
 *  - "max-source": several devices often record the same activity (iPhone + Apple Watch both count
 *    steps). Per hour, Vigor keeps the source with the largest total, then sums hours. This avoids
 *    double counting without needing HealthKit's private source-priority list.
 *  - "sum-all": every sample counts (nutrition logged from different apps for different meals).
 */
export type MetricGroup = "activity" | "cardio" | "sleep" | "body" | "nutrition" | "other";
export type Aggregation = "sum" | "avg" | "latest" | "sleep";

export interface MetricDef {
  key: string;
  label: string;
  group: MetricGroup;
  unit: string; // canonical unit
  aggregation: Aggregation;
  overlap?: "max-source" | "sum-all";
  chart: "bar" | "line";
  decimals: number;
  /** Desirable direction of change, used to colour trend arrows. */
  better?: "up" | "down";
  /** HealthKit type identifier, for documentation and the iOS companion. */
  healthKit?: string;
  description?: string;
}

const q = (d: Omit<MetricDef, "decimals"> & { decimals?: number }): MetricDef => ({ decimals: 1, ...d });

export const METRICS: MetricDef[] = [
  // Activity
  q({ key: "step_count", label: "Steps", group: "activity", unit: "count", aggregation: "sum", overlap: "max-source", chart: "bar", decimals: 0, better: "up", healthKit: "HKQuantityTypeIdentifierStepCount" }),
  q({ key: "distance_walking_running", label: "Walking + running distance", group: "activity", unit: "m", aggregation: "sum", overlap: "max-source", chart: "bar", decimals: 2, better: "up", healthKit: "HKQuantityTypeIdentifierDistanceWalkingRunning" }),
  q({ key: "active_energy", label: "Active energy", group: "activity", unit: "kcal", aggregation: "sum", overlap: "max-source", chart: "bar", decimals: 0, better: "up", healthKit: "HKQuantityTypeIdentifierActiveEnergyBurned" }),
  q({ key: "basal_energy", label: "Resting energy", group: "activity", unit: "kcal", aggregation: "sum", overlap: "max-source", chart: "bar", decimals: 0, healthKit: "HKQuantityTypeIdentifierBasalEnergyBurned" }),
  q({ key: "exercise_time", label: "Exercise minutes", group: "activity", unit: "min", aggregation: "sum", overlap: "max-source", chart: "bar", decimals: 0, better: "up", healthKit: "HKQuantityTypeIdentifierAppleExerciseTime" }),
  q({ key: "flights_climbed", label: "Flights climbed", group: "activity", unit: "count", aggregation: "sum", overlap: "max-source", chart: "bar", decimals: 0, better: "up", healthKit: "HKQuantityTypeIdentifierFlightsClimbed" }),
  q({ key: "stand_hours", label: "Stand hours", group: "activity", unit: "hr", aggregation: "sum", overlap: "max-source", chart: "bar", decimals: 0, better: "up", healthKit: "HKCategoryTypeIdentifierAppleStandHour", description: "Hours in which you stood and moved for at least a minute." }),

  // Cardiovascular
  q({ key: "heart_rate", label: "Heart rate", group: "cardio", unit: "bpm", aggregation: "avg", chart: "line", decimals: 0, healthKit: "HKQuantityTypeIdentifierHeartRate" }),
  q({ key: "resting_heart_rate", label: "Resting heart rate", group: "cardio", unit: "bpm", aggregation: "avg", chart: "line", decimals: 0, better: "down", healthKit: "HKQuantityTypeIdentifierRestingHeartRate" }),
  q({ key: "walking_heart_rate", label: "Walking heart rate average", group: "cardio", unit: "bpm", aggregation: "avg", chart: "line", decimals: 0, better: "down", healthKit: "HKQuantityTypeIdentifierWalkingHeartRateAverage" }),
  q({ key: "heart_rate_variability", label: "Heart rate variability (SDNN)", group: "cardio", unit: "ms", aggregation: "avg", chart: "line", decimals: 0, better: "up", healthKit: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN" }),
  q({ key: "heart_rate_recovery", label: "Heart rate recovery (1 min)", group: "cardio", unit: "bpm", aggregation: "avg", chart: "line", decimals: 0, better: "up", healthKit: "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute" }),
  q({ key: "oxygen_saturation", label: "Blood oxygen", group: "cardio", unit: "%", aggregation: "avg", chart: "line", decimals: 1, healthKit: "HKQuantityTypeIdentifierOxygenSaturation" }),
  q({ key: "respiratory_rate", label: "Respiratory rate", group: "cardio", unit: "breaths/min", aggregation: "avg", chart: "line", decimals: 1, healthKit: "HKQuantityTypeIdentifierRespiratoryRate" }),
  q({ key: "vo2_max", label: "VO₂ max", group: "cardio", unit: "ml/kg/min", aggregation: "latest", chart: "line", decimals: 1, better: "up", healthKit: "HKQuantityTypeIdentifierVO2Max" }),

  // Sleep
  q({ key: "sleep_analysis", label: "Sleep", group: "sleep", unit: "min", aggregation: "sleep", chart: "bar", decimals: 0, better: "up", healthKit: "HKCategoryTypeIdentifierSleepAnalysis", description: "Category samples; `category` is one of in_bed, awake, asleep_unspecified, asleep_core, asleep_deep, asleep_rem." }),

  // Body composition
  q({ key: "body_mass", label: "Body weight", group: "body", unit: "kg", aggregation: "latest", chart: "line", decimals: 1, healthKit: "HKQuantityTypeIdentifierBodyMass" }),
  q({ key: "height", label: "Height", group: "body", unit: "cm", aggregation: "latest", chart: "line", decimals: 1, healthKit: "HKQuantityTypeIdentifierHeight" }),
  q({ key: "body_fat_percentage", label: "Body fat", group: "body", unit: "%", aggregation: "latest", chart: "line", decimals: 1, better: "down", healthKit: "HKQuantityTypeIdentifierBodyFatPercentage" }),
  q({ key: "lean_body_mass", label: "Lean body mass", group: "body", unit: "kg", aggregation: "latest", chart: "line", decimals: 1, better: "up", healthKit: "HKQuantityTypeIdentifierLeanBodyMass" }),
  q({ key: "body_mass_index", label: "BMI", group: "body", unit: "kg/m²", aggregation: "latest", chart: "line", decimals: 1, healthKit: "HKQuantityTypeIdentifierBodyMassIndex" }),
  q({ key: "waist_circumference", label: "Waist circumference", group: "body", unit: "cm", aggregation: "latest", chart: "line", decimals: 1, better: "down", healthKit: "HKQuantityTypeIdentifierWaistCircumference" }),

  // Nutrition & hydration
  q({ key: "dietary_energy", label: "Dietary energy", group: "nutrition", unit: "kcal", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 0, healthKit: "HKQuantityTypeIdentifierDietaryEnergyConsumed" }),
  q({ key: "dietary_protein", label: "Protein", group: "nutrition", unit: "g", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 0, healthKit: "HKQuantityTypeIdentifierDietaryProtein" }),
  q({ key: "dietary_carbohydrates", label: "Carbohydrates", group: "nutrition", unit: "g", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 0, healthKit: "HKQuantityTypeIdentifierDietaryCarbohydrates" }),
  q({ key: "dietary_fat", label: "Fat", group: "nutrition", unit: "g", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 0, healthKit: "HKQuantityTypeIdentifierDietaryFatTotal" }),
  q({ key: "dietary_fiber", label: "Fibre", group: "nutrition", unit: "g", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 0, healthKit: "HKQuantityTypeIdentifierDietaryFiber" }),
  q({ key: "dietary_sugar", label: "Sugar", group: "nutrition", unit: "g", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 0, healthKit: "HKQuantityTypeIdentifierDietarySugar" }),
  q({ key: "dietary_sodium", label: "Sodium", group: "nutrition", unit: "g", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 2, healthKit: "HKQuantityTypeIdentifierDietarySodium" }),
  q({ key: "dietary_caffeine", label: "Caffeine", group: "nutrition", unit: "g", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 3, healthKit: "HKQuantityTypeIdentifierDietaryCaffeine" }),
  q({ key: "dietary_water", label: "Water", group: "nutrition", unit: "ml", aggregation: "sum", overlap: "sum-all", chart: "bar", decimals: 0, healthKit: "HKQuantityTypeIdentifierDietaryWater" }),

  // Other
  q({ key: "body_temperature", label: "Body temperature", group: "other", unit: "°c", aggregation: "avg", chart: "line", decimals: 1, healthKit: "HKQuantityTypeIdentifierBodyTemperature" }),
  q({ key: "blood_pressure_systolic", label: "Blood pressure (systolic)", group: "other", unit: "mmhg", aggregation: "avg", chart: "line", decimals: 0, better: "down", healthKit: "HKQuantityTypeIdentifierBloodPressureSystolic" }),
  q({ key: "blood_pressure_diastolic", label: "Blood pressure (diastolic)", group: "other", unit: "mmhg", aggregation: "avg", chart: "line", decimals: 0, better: "down", healthKit: "HKQuantityTypeIdentifierBloodPressureDiastolic" }),
  q({ key: "blood_glucose", label: "Blood glucose", group: "other", unit: "mg/dl", aggregation: "avg", chart: "line", decimals: 0, healthKit: "HKQuantityTypeIdentifierBloodGlucose" }),
];

export const METRIC_GROUPS: { key: MetricGroup; label: string }[] = [
  { key: "activity", label: "Activity" },
  { key: "cardio", label: "Cardiovascular" },
  { key: "sleep", label: "Sleep" },
  { key: "body", label: "Body composition" },
  { key: "nutrition", label: "Nutrition & hydration" },
  { key: "other", label: "Other measurements" },
];

const byKey = new Map(METRICS.map((m) => [m.key, m]));

export function getMetric(key: string): MetricDef | undefined {
  return byKey.get(key);
}

export function isKnownMetric(key: string): boolean {
  return byKey.has(key);
}

export const SLEEP_CATEGORIES = [
  "in_bed",
  "awake",
  "asleep_unspecified",
  "asleep_core",
  "asleep_deep",
  "asleep_rem",
] as const;
export type SleepCategory = (typeof SLEEP_CATEGORIES)[number];
