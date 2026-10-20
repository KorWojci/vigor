/**
 * Built-in body measurement definitions. Values are stored canonically:
 * length → cm, mass → kg, percent → %.
 * `region` links a measurement to an area of the Vitruvian figure (see components/VitruvianFigure).
 * `metric` links a measurement to the equivalent Apple Health metric so the two series merge.
 */
export type MeasurementDimension = "length" | "mass" | "percent";

export type FigureRegion =
  | "head"
  | "neck"
  | "shoulders"
  | "chest"
  | "arm_left"
  | "arm_right"
  | "forearm_left"
  | "forearm_right"
  | "waist"
  | "hips"
  | "thigh_left"
  | "thigh_right"
  | "calf_left"
  | "calf_right"
  | "body";

export interface MeasurementTypeDef {
  key: string;
  label: string;
  dimension: MeasurementDimension;
  region?: FigureRegion;
  metric?: string;
}

export const BUILTIN_MEASUREMENT_TYPES: MeasurementTypeDef[] = [
  { key: "weight", label: "Body weight", dimension: "mass", region: "body", metric: "body_mass" },
  { key: "height", label: "Height", dimension: "length", region: "body", metric: "height" },
  { key: "body_fat", label: "Body fat", dimension: "percent", region: "body", metric: "body_fat_percentage" },
  { key: "lean_mass", label: "Lean body mass", dimension: "mass", region: "body", metric: "lean_body_mass" },
  { key: "neck", label: "Neck", dimension: "length", region: "neck" },
  { key: "shoulders", label: "Shoulders", dimension: "length", region: "shoulders" },
  { key: "chest", label: "Chest", dimension: "length", region: "chest" },
  { key: "waist", label: "Waist", dimension: "length", region: "waist" },
  { key: "hips", label: "Hips", dimension: "length", region: "hips" },
  { key: "upper_arm_left", label: "Left upper arm", dimension: "length", region: "arm_left" },
  { key: "upper_arm_right", label: "Right upper arm", dimension: "length", region: "arm_right" },
  { key: "forearm_left", label: "Left forearm", dimension: "length", region: "forearm_left" },
  { key: "forearm_right", label: "Right forearm", dimension: "length", region: "forearm_right" },
  { key: "thigh_left", label: "Left thigh", dimension: "length", region: "thigh_left" },
  { key: "thigh_right", label: "Right thigh", dimension: "length", region: "thigh_right" },
  { key: "calf_left", label: "Left calf", dimension: "length", region: "calf_left" },
  { key: "calf_right", label: "Right calf", dimension: "length", region: "calf_right" },
];

export const MEASUREMENT_METRIC_LINKS: Record<string, string> = Object.fromEntries(
  BUILTIN_MEASUREMENT_TYPES.filter((t) => t.metric).map((t) => [t.key, t.metric!]),
);
