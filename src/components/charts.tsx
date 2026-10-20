"use client";

/**
 * Chart components (Recharts). All receive plain, already-aggregated data from server components.
 * Missing days are passed as `value: null` (or omitted) and rendered as gaps — never as zero.
 */
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartPoint {
  day: string;
  value: number | null;
  min?: number | null;
  max?: number | null;
  avg?: number | null;
}

const fmtDay = (d: string) => {
  const [, m, day] = d.split("-");
  return `${Number(day)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}`;
};

const fmt = (v: number | null | undefined, decimals: number) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });

function Tip({ active, payload, label, unit, decimals }: { active?: boolean; payload?: { name: string; value: number | number[]; color?: string; dataKey: string }[]; label?: string; unit: string; decimals: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tt">
      <div className="faint tiny">{label ? fmtDay(String(label)) : ""}</div>
      {payload
        .filter((p) => p.dataKey !== "range")
        .map((p) => (
          <div key={p.dataKey}>
            <span style={{ color: p.color }}>■</span> {p.name}: <strong className="num">{fmt(p.value as number, decimals)}</strong> {unit}
          </div>
        ))}
    </div>
  );
}

const axisProps = { stroke: "var(--line-strong)", tickLine: false, axisLine: false } as const;

/** Adds a trailing moving average computed over calendar days that have data. */
function withMovingAverage(data: ChartPoint[], days: number): ChartPoint[] {
  if (!days) return data;
  return data.map((p, i) => {
    const window = data.slice(Math.max(0, i - days + 1), i + 1).filter((x) => x.value !== null);
    return { ...p, avg: window.length >= Math.min(3, days) ? window.reduce((a, x) => a + (x.value ?? 0), 0) / window.length : null };
  });
}

export function TrendChart({
  data,
  unit,
  chart,
  decimals = 1,
  movingAverage = 0,
  showRange = false,
  height = 280,
  label = "Value",
}: {
  data: ChartPoint[];
  unit: string;
  chart: "bar" | "line";
  decimals?: number;
  movingAverage?: number;
  showRange?: boolean;
  height?: number;
  label?: string;
}) {
  const rows = withMovingAverage(data, movingAverage).map((d) => ({ ...d, range: d.min != null && d.max != null ? [d.min, d.max] : null }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="day" tickFormatter={fmtDay} {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} width={48} domain={chart === "bar" ? [0, "auto"] : ["auto", "auto"]} tickFormatter={(v) => fmt(v, decimals)} />
          <Tooltip content={<Tip unit={unit} decimals={decimals} />} cursor={{ fill: "var(--bronze-soft)" }} />
          {showRange && <Area dataKey="range" name="Range" stroke="none" fill="var(--chart-1)" fillOpacity={0.12} connectNulls isAnimationActive={false} />}
          {chart === "bar" ? (
            <Bar dataKey="value" name={label} fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          ) : (
            <Line dataKey="value" name={label} stroke="var(--chart-1)" strokeWidth={1.8} dot={rows.length < 60 ? { r: 2.5, fill: "var(--chart-1)" } : false} connectNulls isAnimationActive={false} />
          )}
          {movingAverage > 0 && (
            <Line dataKey="avg" name={`${movingAverage}-day average`} stroke="var(--chart-2)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ data, chart = "line" }: { data: { day: string; value: number | null }[]; chart?: "bar" | "line" }) {
  if (data.filter((d) => d.value !== null).length < 2) return <div className="spark" />;
  return (
    <div className="spark">
      <ResponsiveContainer>
        {chart === "bar" ? (
          <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <YAxis hide domain={[0, "auto"]} />
            <Bar dataKey="value" fill="var(--chart-1)" fillOpacity={0.55} radius={[1, 1, 0, 0]} isAnimationActive={false} />
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Line dataKey="value" stroke="var(--chart-1)" strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export interface SleepPoint {
  day: string;
  deep: number;
  core: number;
  rem: number;
  unspecified: number;
  awake: number;
}

export function SleepChart({ data, height = 280 }: { data: SleepPoint[]; height?: number }) {
  const hours = data.map((d) => ({ ...d, deep: d.deep / 60, core: d.core / 60, rem: d.rem / 60, unspecified: d.unspecified / 60, awake: d.awake / 60 }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={hours} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="day" tickFormatter={fmtDay} {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} width={40} tickFormatter={(v) => `${v}h`} />
          <Tooltip content={<Tip unit="h" decimals={1} />} cursor={{ fill: "var(--bronze-soft)" }} />
          <Bar dataKey="deep" name="Deep" stackId="s" fill="var(--chart-2)" isAnimationActive={false} />
          <Bar dataKey="core" name="Core" stackId="s" fill="var(--chart-1)" isAnimationActive={false} />
          <Bar dataKey="rem" name="REM" stackId="s" fill="var(--chart-3)" isAnimationActive={false} />
          <Bar dataKey="unspecified" name="Asleep (no stages)" stackId="s" fill="var(--chart-5)" isAnimationActive={false} />
          <Bar dataKey="awake" name="Awake" stackId="s" fill="var(--chart-4)" fillOpacity={0.5} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MultiLineChart({
  data,
  series,
  height = 280,
  decimals = 1,
  unit = "",
}: {
  data: Record<string, number | string | null>[];
  series: { key: string; label: string; color: string; axis?: "left" | "right"; dashed?: boolean }[];
  height?: number;
  decimals?: number;
  unit?: string;
}) {
  const hasRight = series.some((s) => s.axis === "right");
  return (
    <div style={{ width: "100%", height: height + 24 }}>
      <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="day" tickFormatter={fmtDay} {...axisProps} minTickGap={24} />
          <YAxis yAxisId="left" {...axisProps} width={48} domain={["auto", "auto"]} tickFormatter={(v) => fmt(v, decimals)} />
          {hasRight && <YAxis yAxisId="right" orientation="right" {...axisProps} width={48} domain={["auto", "auto"]} tickFormatter={(v) => fmt(v, decimals)} />}
          <Tooltip content={<Tip unit={unit} decimals={decimals} />} />
          {series.map((s) => (
            <Line
              key={s.key}
              yAxisId={s.axis ?? "left"}
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={1.8}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              dot={data.length < 40 ? { r: 2.5, fill: s.color } : false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      </div>
      <div className="legend" style={{ marginTop: 4 }}>
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
            {s.axis === "right" ? " (right axis)" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SimpleBars({ data, xKey, yKey, label, unit = "", height = 200, decimals = 0 }: { data: Record<string, string | number>[]; xKey: string; yKey: string; label: string; unit?: string; height?: number; decimals?: number }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={(v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDay(String(v)) : String(v))} {...axisProps} minTickGap={16} />
          <YAxis {...axisProps} width={36} allowDecimals={false} />
          <Tooltip content={<Tip unit={unit} decimals={decimals} />} cursor={{ fill: "var(--bronze-soft)" }} />
          <Bar dataKey={yKey} name={label} fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
